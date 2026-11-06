/**
 * Vendor profile photos and portfolio images (docs/plans/manual_quotes.md,
 * 2d). Every one is public, so every one is checked before anyone sees it:
 *
 * 1. The browser PUTs to a presigned URL under the quarantine prefix, which
 *    is never served or presigned for download.
 * 2. ScanVendorImage waits for the malware verdict (GuardDuty, as for
 *    message attachments - attachment_scanner.ts).
 * 3. The bytes are inspected and re-encoded with sharp, which strips
 *    metadata (attachment_inspection.ts), then resized to a display copy and
 *    a thumbnail, both WebP.
 * 4. Rekognition DetectModerationLabels checks the image (image_moderator.ts),
 *    and any QR code in it goes through the text rules (contact details,
 *    links) like a message would.
 * 5. Only then is it approved and served, from `${S3_FILE_STORAGE_KEY}/public/`.
 *
 * Anything a check couldn't vouch for (no malware verdict, Rekognition
 * unavailable, text needing a look) goes to a person as a vendor_image case.
 */
import string from '@adonisjs/core/helpers/string'
import logger from '@adonisjs/core/services/logger'
import drive from '@adonisjs/drive/services/main'
import { DateTime } from 'luxon'
import sharp from 'sharp'
import env from '#start/env'
import ScanVendorImage from '#jobs/scan_vendor_image'
import ModerationCase from '#models/moderation_case'
import type Vendor from '#models/vendor'
import VendorImage from '#models/vendor_image'
import { getMalwareScanner } from '#services/attachment_scanner'
import { IMAGE_EXTENSIONS, inspectAttachment } from '#services/attachment_inspection'
import { moderateContent, supersedeOpenCases } from '#services/content_moderation_service'
import { getImageModerator } from '#services/image_moderator'

export const VENDOR_IMAGE_EXTENSIONS = IMAGE_EXTENSIONS
export type VendorImageExtension = (typeof VENDOR_IMAGE_EXTENSIONS)[number]
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_PORTFOLIO_IMAGES = 12
/** Uploads issued but never confirmed, per vendor. */
const MAX_PENDING_UPLOADS = 5
const UPLOAD_URL_EXPIRY = '15m'
/** Presigned GET lifetime when there's no public asset base URL. */
const VIEW_URL_EXPIRY = '1h'
const SCAN_POLL_DELAY = '20s'
const SCAN_WAIT_MINUTES = 15
const DISPLAY_MAX_PX = 2048
const THUMBNAIL_PX = 400
/** Rekognition takes up to 5 MB of bytes; it's sent a downscaled JPEG. */
const MODERATION_MAX_PX = 1600
const REVIEW_PRIORITY = 40

export class VendorImageError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 422 = 422
  ) {
    super(message)
    this.name = 'VendorImageError'
  }
}

export interface ImageUrls {
  uuid: string
  url: string
  thumbnailUrl: string | null
}

function root() {
  return env.get('S3_FILE_STORAGE_KEY')
}

function quarantineKeyFor(vendor: Vendor, uuid: string, extname: string) {
  return `${root()}/quarantine/vendors/${vendor.uuid}/images/${uuid}.${extname}`
}

function publicKeyFor(vendorUuid: string, uuid: string, variant: 'display' | 'thumb') {
  return `${root()}/public/vendors/${vendorUuid}/images/${uuid}${variant === 'thumb' ? '_thumb' : ''}.webp`
}

function extensionOf(fileName: string): VendorImageExtension | null {
  const extname = fileName.split('.').pop()?.toLowerCase() ?? ''
  return (VENDOR_IMAGE_EXTENSIONS as readonly string[]).includes(extname)
    ? (extname as VendorImageExtension)
    : null
}

/** A URL for a stored key: the public asset host when configured, else a short-lived presigned GET. */
async function urlFor(key: string): Promise<string> {
  const base = env.get('PUBLIC_ASSET_BASE_URL')
  if (base) return `${base.replace(/\/+$/, '')}/${key}`
  return drive
    .use('s3')
    .getSignedUrl(key, { expiresIn: VIEW_URL_EXPIRY, contentType: 'image/webp' })
}

/** Public URLs for an approved image; null for anything else, so nothing unchecked is ever linked. */
export async function imageUrls(image: VendorImage): Promise<ImageUrls | null> {
  if (image.status !== 'approved' || !image.storageKey) return null
  return {
    uuid: image.uuid,
    url: await urlFor(image.storageKey),
    thumbnailUrl: image.thumbnailKey ? await urlFor(image.thumbnailKey) : null,
  }
}

/** A presigned view of an image under review, for moderators only. */
export async function reviewUrl(image: VendorImage): Promise<string | null> {
  if (!image.storageKey || image.status === 'rejected') return null
  return drive
    .use('s3')
    .getSignedUrl(image.storageKey, { expiresIn: '5m', contentType: 'image/webp' })
}

/** Creates the image record and a presigned PUT into quarantine. */
export async function createImageUpload(
  vendor: Vendor,
  input: { kind: VendorImage['kind']; fileName: string; sizeBytes: number }
): Promise<{ image: VendorImage; uploadUrl: string }> {
  if (vendor.status === 'suspended') {
    throw new VendorImageError('Suspended vendors cannot change their public profile', 409)
  }
  const extname = extensionOf(input.fileName)
  if (!extname) {
    throw new VendorImageError(`Images must be one of: ${VENDOR_IMAGE_EXTENSIONS.join(', ')}.`)
  }
  if (input.sizeBytes > MAX_IMAGE_BYTES) {
    throw new VendorImageError('Images can be up to 10 MB.')
  }

  const existing = await VendorImage.query()
    .where('vendorId', vendor.id)
    .whereNot('status', 'rejected')
  if (existing.filter((image) => image.status === 'pending_upload').length >= MAX_PENDING_UPLOADS) {
    throw new VendorImageError('Finish or discard your pending uploads first.', 409)
  }
  const portfolio = existing.filter((image) => image.kind === 'portfolio')
  if (input.kind === 'portfolio' && portfolio.length >= MAX_PORTFOLIO_IMAGES) {
    throw new VendorImageError(`Up to ${MAX_PORTFOLIO_IMAGES} portfolio images.`, 409)
  }

  const uuid = string.uuid()
  const quarantineKey = quarantineKeyFor(vendor, uuid, extname)
  const image = await VendorImage.create({
    uuid,
    vendorId: vendor.id,
    kind: input.kind,
    quarantineKey,
    extname,
    sizeBytes: input.sizeBytes,
    position:
      input.kind === 'portfolio'
        ? Math.max(-1, ...portfolio.map((entry) => entry.position)) + 1
        : 0,
    status: 'pending_upload',
  })
  const uploadUrl = await drive.use('s3').getSignedUploadUrl(quarantineKey, {
    expiresIn: UPLOAD_URL_EXPIRY,
    ContentLength: input.sizeBytes,
  })
  return { image, uploadUrl }
}

/** The browser finished its PUT: check the object is there and queue the checks. */
export async function completeImageUpload(image: VendorImage): Promise<VendorImage> {
  if (image.status !== 'pending_upload') return image
  const disk = drive.use('s3')
  if (!(await disk.exists(image.quarantineKey))) {
    throw new VendorImageError('The image has not been uploaded yet.', 409)
  }
  const { contentLength } = await disk.getMetaData(image.quarantineKey)
  if (contentLength > MAX_IMAGE_BYTES || contentLength !== image.sizeBytes) {
    await disk.delete(image.quarantineKey)
    image.merge({ status: 'rejected', rejectReason: 'size_mismatch' })
    await image.save()
    throw new VendorImageError("The uploaded image doesn't match its declared size.")
  }
  image.merge({ status: 'uploaded', uploadedAt: DateTime.now() })
  await image.save()
  await ScanVendorImage.dispatch({ imageId: image.id }).run()
  return image
}

async function deleteStored(image: VendorImage) {
  const disk = drive.use('s3')
  for (const key of [image.storageKey, image.thumbnailKey]) {
    if (key) {
      await disk.delete(key).catch((error) => {
        logger.warn({ key, error: String(error) }, 'Could not delete a vendor image file')
      })
    }
  }
}

async function reject(
  image: VendorImage,
  reason: string,
  details: Record<string, unknown>
): Promise<void> {
  await drive
    .use('s3')
    .delete(image.quarantineKey)
    .catch(() => {})
  await deleteStored(image)
  image.merge({
    status: 'rejected',
    rejectReason: reason,
    storageKey: null,
    thumbnailKey: null,
    checkedAt: DateTime.now(),
    moderationDetails: { ...(image.moderationDetails ?? {}), ...details },
  })
  await image.save()
}

/** A new profile photo replaces the old one once it's approved. */
async function retireReplacedProfilePhotos(image: VendorImage) {
  if (image.kind !== 'profile') return
  const older = await VendorImage.query()
    .where('vendorId', image.vendorId)
    .where('kind', 'profile')
    .whereNot('id', image.id)
  for (const old of older) {
    await deleteStored(old)
    await supersedeOpenCases({ type: 'vendor_image', id: old.id })
    await old.delete()
  }
}

async function openReviewCase(image: VendorImage, reason: string) {
  await ModerationCase.create({
    uuid: string.uuid(),
    messageId: null,
    subjectType: 'vendor_image',
    subjectId: image.id,
    vendorId: image.vendorId,
    customerId: null,
    source: 'auto_hold',
    priority: REVIEW_PRIORITY,
    status: 'open',
    missedByAutomation: false,
    details: { subject: 'vendor_image', reason },
  })
}

/**
 * The ScanVendorImage job's work. Re-queues itself while the malware scanner
 * has no verdict; if none arrives within SCAN_WAIT_MINUTES a person decides.
 */
export async function checkVendorImage(imageId: number): Promise<void> {
  const image = await VendorImage.query().where('id', imageId).preload('vendor').first()
  if (!image || image.status !== 'uploaded') return
  const disk = drive.use('s3')

  const malware = await getMalwareScanner().status(image.quarantineKey)
  if (malware === 'pending') {
    const waited = DateTime.now().diff(image.uploadedAt ?? DateTime.now(), 'minutes').minutes
    if (waited < SCAN_WAIT_MINUTES) {
      await ScanVendorImage.dispatch({ imageId }).in(SCAN_POLL_DELAY).run()
      return
    }
  }
  if (malware === 'infected') {
    return reject(image, 'malware', { malware })
  }

  const bytes = Buffer.from(await disk.getBytes(image.quarantineKey))
  const inspection = await inspectAttachment(bytes, image.extname as VendorImageExtension)
  const details: Record<string, unknown> = {
    malware,
    findings: inspection.findings,
    extractedText: inspection.extractedText,
  }
  if (inspection.outcome === 'rejected' || !inspection.replacement) {
    return reject(image, inspection.reason ?? 'image_undecodable', details)
  }

  // Display copy and thumbnail, re-encoded from the metadata-free bytes.
  const clean = sharp(inspection.replacement, { limitInputPixels: 50_000_000 })
  const display = await clean
    .clone()
    .resize(DISPLAY_MAX_PX, DISPLAY_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()
  const thumbnail = await clean
    .clone()
    .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer()
  const forModeration = await clean
    .clone()
    .resize(MODERATION_MAX_PX, MODERATION_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  const verdict = await getImageModerator().check(forModeration)
  details.rekognition = { status: verdict.status, labels: verdict.labels }
  if (verdict.status === 'rejected') {
    return reject(image, verdict.reason, details)
  }

  // Text in the image (a QR code) is moderated like a message.
  let textStatus: 'approved' | 'pending_review' = 'approved'
  if (inspection.extractedText.length > 0) {
    const text = await moderateContent(
      { type: 'vendor_image', id: image.id, vendorId: image.vendorId },
      inspection.extractedText.join('\n'),
      { senderRole: 'vendor', supersede: false }
    )
    if (text.status === 'blocked') {
      return reject(image, 'text_blocked', { ...details, textReason: text.outcome.reasonCode })
    }
    textStatus = text.status
  }

  const storageKey = publicKeyFor(image.vendor.uuid, image.uuid, 'display')
  const thumbnailKey = publicKeyFor(image.vendor.uuid, image.uuid, 'thumb')
  await disk.put(storageKey, display, { contentType: 'image/webp' })
  await disk.put(thumbnailKey, thumbnail, { contentType: 'image/webp' })
  await disk.delete(image.quarantineKey)

  const unverifiedReason =
    malware !== 'clean'
      ? `malware_${malware}`
      : verdict.status === 'unavailable'
        ? 'image_moderation_unavailable'
        : inspection.outcome === 'review'
          ? (inspection.reason ?? 'inspection_review')
          : null
  const needsPerson = unverifiedReason !== null || textStatus === 'pending_review'

  image.merge({
    status: needsPerson ? 'review' : 'approved',
    rejectReason: needsPerson ? (unverifiedReason ?? 'text_review') : null,
    storageKey,
    thumbnailKey,
    sizeBytes: display.length,
    checkedAt: DateTime.now(),
    moderationDetails: details,
  })
  await image.save()

  if (needsPerson && textStatus !== 'pending_review') {
    // (A text review already opened its own case on this image.)
    await openReviewCase(image, unverifiedReason!)
  }
  if (!needsPerson) {
    await retireReplacedProfilePhotos(image)
  }
}

/** A moderator approved an image under review. */
export async function approveImage(image: VendorImage) {
  if (image.status !== 'review') return
  image.merge({ status: 'approved', rejectReason: null })
  await image.save()
  await retireReplacedProfilePhotos(image)
}

/** A moderator (or admin) rejected an image: its files go, and it's never served. */
export async function rejectImage(image: VendorImage, reason = 'moderator') {
  if (image.status === 'rejected') return
  await reject(image, reason, { rejectedBy: 'moderator' })
  await supersedeOpenCases({ type: 'vendor_image', id: image.id })
}

/** The vendor removes one of their images. */
export async function deleteImage(image: VendorImage) {
  await drive
    .use('s3')
    .delete(image.quarantineKey)
    .catch(() => {})
  await deleteStored(image)
  await supersedeOpenCases({ type: 'vendor_image', id: image.id })
  await image.delete()
}

/** Sets the portfolio order to `uuids` (every portfolio image, each once). */
export async function reorderPortfolio(vendor: Vendor, uuids: string[]): Promise<VendorImage[]> {
  const portfolio = await VendorImage.query()
    .where('vendorId', vendor.id)
    .where('kind', 'portfolio')
    .whereNot('status', 'rejected')
  const byUuid = new Map(portfolio.map((image) => [image.uuid, image]))
  if (uuids.length !== portfolio.length || uuids.some((uuid) => !byUuid.has(uuid))) {
    throw new VendorImageError('List every portfolio image exactly once.')
  }
  for (const [position, uuid] of uuids.entries()) {
    const image = byUuid.get(uuid)!
    if (image.position !== position) {
      image.position = position
      await image.save()
    }
  }
  return VendorImage.query()
    .where('vendorId', vendor.id)
    .where('kind', 'portfolio')
    .whereNot('status', 'rejected')
    .orderBy('position', 'asc')
}
