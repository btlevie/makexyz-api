/**
 * What's actually inside an uploaded file, from its bytes - never from the
 * client's name or content type (docs/plans/messaging_moderation.md, D7):
 *
 * - The type must match the extension (a renamed .exe is rejected), and
 *   executables and archives are rejected whatever they're called.
 * - Images are decoded and re-encoded, which drops metadata (GPS EXIF) and
 *   anything smuggled after the image data. Any QR code is decoded - its
 *   text is moderated with the message, links and all.
 * - PDFs are parsed (pdf-lib reads compressed object streams too, so names
 *   can't hide there): JavaScript, launch actions, embedded files, forms
 *   that submit data and rich media are rejected; link targets are
 *   extracted for the URL pipeline.
 * - 3D/CAD files can't execute; they only need to be what they claim.
 */
import jsQRModule from 'jsqr'
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFStream,
  PDFString,
  type PDFObject,
} from 'pdf-lib'
import sharp from 'sharp'

// jsqr is CommonJS with the decoder on `.default`.
const jsQR = jsQRModule.default

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const
/** The project-file 3D/CAD allowlist (app/validators/project_file.ts) without zip - no archives. */
export const MODEL_EXTENSIONS = [
  'stl',
  'obj',
  'dxf',
  'off',
  'ply',
  '3ds',
  'wrl',
  'step',
  'stp',
  'igs',
  'iges',
] as const
export const ATTACHMENT_EXTENSIONS = [...IMAGE_EXTENSIONS, 'pdf', ...MODEL_EXTENSIONS] as const
export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number]

export interface InspectionResult {
  outcome: 'clean' | 'rejected' | 'review'
  /** Why it was rejected or needs review: 'type_mismatch', 'pdf_active_content'... */
  reason: string | null
  contentType: string
  /** Re-encoded bytes to store instead of the upload (images). */
  replacement: Buffer | null
  /** Text found inside the file - QR codes, PDF link targets - moderated with the message. */
  extractedText: string[]
  findings: string[]
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

function startsWith(bytes: Buffer, signature: number[] | string, offset = 0): boolean {
  const expected =
    typeof signature === 'string' ? Buffer.from(signature, 'latin1') : Buffer.from(signature)
  return (
    bytes.length >= offset + expected.length &&
    bytes.subarray(offset, offset + expected.length).equals(expected)
  )
}

/** Executables and archives, whatever the extension says. */
function forbiddenFormat(bytes: Buffer): string | null {
  if (startsWith(bytes, 'MZ')) return 'executable'
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'executable'
  if (
    [
      [0xfe, 0xed, 0xfa, 0xce],
      [0xfe, 0xed, 0xfa, 0xcf],
      [0xcf, 0xfa, 0xed, 0xfe],
      [0xce, 0xfa, 0xed, 0xfe],
      [0xca, 0xfe, 0xba, 0xbe],
    ].some((magic) => startsWith(bytes, magic))
  ) {
    return 'executable'
  }
  if (startsWith(bytes, '#!')) return 'script'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]))
    return 'archive'
  if (startsWith(bytes, 'Rar!') || startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    return 'archive'
  if (startsWith(bytes, [0x1f, 0x8b])) return 'archive'
  return null
}

/** Plain text: no NUL bytes in the first 8 KB. */
function isText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8192).includes(0)
}

function textStart(bytes: Buffer): string {
  const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  return bytes
    .subarray(start, start + 512)
    .toString('latin1')
    .trimStart()
}

/** Whether the bytes are the format the extension claims. */
export function matchesExtension(bytes: Buffer, extname: AttachmentExtension): boolean {
  switch (extname) {
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'jpg':
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'webp':
      return startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8)
    case 'pdf':
      return bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))
    case 'stl': {
      // Binary STL: 80-byte header, triangle count, 50 bytes per triangle.
      if (bytes.length >= 84 && bytes.length === 84 + bytes.readUInt32LE(80) * 50) return true
      return isText(bytes) && /^solid\b/i.test(textStart(bytes))
    }
    case 'step':
    case 'stp':
      return isText(bytes) && textStart(bytes).startsWith('ISO-10303-21')
    case 'ply':
      return textStart(bytes).startsWith('ply')
    case 'off':
      return isText(bytes) && /^[CN]?OFF\b/.test(textStart(bytes))
    case 'wrl':
      return isText(bytes) && textStart(bytes).startsWith('#VRML')
    case '3ds':
      return startsWith(bytes, [0x4d, 0x4d])
    case 'dxf':
      return isText(bytes) || startsWith(bytes, 'AutoCAD Binary DXF')
    case 'obj':
    case 'igs':
    case 'iges':
      return isText(bytes)
  }
}

/** Decodes a QR code from image bytes (one per image is enough to catch the trick). */
async function decodeQr(bytes: Buffer): Promise<string | null> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const code = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    info.width,
    info.height
  )
  return code?.data?.trim() || null
}

async function inspectImage(bytes: Buffer, extname: string): Promise<InspectionResult> {
  const contentType = CONTENT_TYPES[extname]
  let replacement: Buffer
  try {
    const image = sharp(bytes, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate()
    replacement =
      extname === 'png'
        ? await image.png().toBuffer()
        : extname === 'webp'
          ? await image.webp({ quality: 90 }).toBuffer()
          : await image.jpeg({ quality: 90 }).toBuffer()
  } catch {
    return {
      outcome: 'rejected',
      reason: 'image_undecodable',
      contentType,
      replacement: null,
      extractedText: [],
      findings: [],
    }
  }
  const qr = await decodeQr(replacement).catch(() => null)
  return {
    outcome: 'clean',
    reason: null,
    contentType,
    replacement,
    extractedText: qr ? [qr] : [],
    findings: qr ? ['qr_code'] : [],
  }
}

/** Dictionary keys that mean "run something" or "carry another file". */
const ACTIVE_KEYS = ['JS', 'JavaScript', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'XFA']
/** Action types (/S) that run code, open other files, or send data. */
const ACTIVE_ACTIONS = [
  'JavaScript',
  'Launch',
  'SubmitForm',
  'ImportData',
  'GoToE',
  'GoToR',
  'RichMediaExecute',
]

function textOf(value: PDFObject | undefined): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return null
}

/** Walks a PDF object graph's dictionaries for active content and link targets. */
function scanPdfObject(
  object: PDFObject,
  doc: PDFDocument,
  findings: Set<string>,
  links: Set<string>,
  seen: Set<PDFObject>,
  depth = 0
) {
  if (depth > 32 || seen.has(object)) return
  seen.add(object)

  const dict = object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : null
  if (dict) {
    for (const [key, value] of dict.entries()) {
      const name = key.decodeText()
      if (ACTIVE_KEYS.includes(name)) findings.add(name)
      if (name === 'S' && value instanceof PDFName && ACTIVE_ACTIONS.includes(value.decodeText())) {
        findings.add(value.decodeText())
      }
      if (name === 'URI') {
        const uri = textOf(value)
        if (uri) {
          if (/^\s*(?:javascript|data|file|vbscript):/i.test(uri)) findings.add('script_uri')
          else links.add(uri)
        }
      }
      // Indirect references are visited from the document's object list.
      if (value instanceof PDFDict || value instanceof PDFArray) {
        scanPdfObject(value, doc, findings, links, seen, depth + 1)
      }
    }
  } else if (object instanceof PDFArray) {
    for (const item of object.asArray()) {
      if (item instanceof PDFDict || item instanceof PDFArray) {
        scanPdfObject(item, doc, findings, links, seen, depth + 1)
      }
    }
  }
}

async function inspectPdf(bytes: Buffer): Promise<InspectionResult> {
  const contentType = CONTENT_TYPES.pdf
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: false,
    })
  } catch (error) {
    const reason = error instanceof EncryptedPDFError ? 'pdf_encrypted' : 'pdf_unparseable'
    return {
      outcome: 'review',
      reason,
      contentType,
      replacement: null,
      extractedText: [],
      findings: [reason],
    }
  }
  // pdf-lib is lenient: garbage after a %PDF- header "parses" as an empty document.
  let pages = 0
  try {
    pages = doc.getPageCount()
  } catch {
    pages = 0
  }
  if (pages === 0) {
    const reason = 'pdf_unparseable'
    return {
      outcome: 'review',
      reason,
      contentType,
      replacement: null,
      extractedText: [],
      findings: [reason],
    }
  }

  const findings = new Set<string>()
  const links = new Set<string>()
  const seen = new Set<PDFObject>()
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    scanPdfObject(object, doc, findings, links, seen)
  }
  // The catalog's own name tree for document-level scripts.
  scanPdfObject(doc.catalog, doc, findings, links, seen)

  return {
    outcome: findings.size > 0 ? 'rejected' : 'clean',
    reason: findings.size > 0 ? 'pdf_active_content' : null,
    contentType,
    replacement: null,
    extractedText: [...links],
    findings: [...findings],
  }
}

/** Inspects an upload's bytes. Malware scanning is separate (attachment_scanner.ts). */
export async function inspectAttachment(
  bytes: Buffer,
  extname: AttachmentExtension
): Promise<InspectionResult> {
  const contentType = CONTENT_TYPES[extname] ?? 'application/octet-stream'
  const forbidden = forbiddenFormat(bytes)
  if (forbidden) {
    return {
      outcome: 'rejected',
      reason: `forbidden_${forbidden}`,
      contentType,
      replacement: null,
      extractedText: [],
      findings: [forbidden],
    }
  }
  if (!matchesExtension(bytes, extname)) {
    return {
      outcome: 'rejected',
      reason: 'type_mismatch',
      contentType,
      replacement: null,
      extractedText: [],
      findings: [],
    }
  }
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extname)) {
    return inspectImage(bytes, extname)
  }
  if (extname === 'pdf') {
    return inspectPdf(bytes)
  }
  return {
    outcome: 'clean',
    reason: null,
    contentType,
    replacement: null,
    extractedText: [],
    findings: [],
  }
}
