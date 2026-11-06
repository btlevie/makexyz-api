/**
 * Content checks for public vendor images: Rekognition DetectModerationLabels
 * (explicit, violent, disturbing, hate symbols, drugs/weapons imagery). Every
 * profile and portfolio image is public, so every one is checked
 * (docs/plans/manual_quotes.md, 2d). Auth is the default AWS credential
 * chain - the task role needs rekognition:DetectModerationLabels.
 *
 * IMAGE_MODERATION=disabled (local dev) answers 'unavailable', which sends
 * the image to a person rather than approving it unchecked.
 */
import { DetectModerationLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition'
import env from '#start/env'

/** Labels at or above this confidence reject the image. */
export const MIN_CONFIDENCE = 80

/**
 * Top-level Rekognition moderation categories that reject a public image.
 * Weapons and drugs are here because a profile photo of either is a
 * prohibited-items signal, not product photography we want to show.
 */
const REJECTED_CATEGORIES = [
  'Explicit',
  'Explicit Nudity',
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Violence',
  'Visually Disturbing',
  'Hate Symbols',
  'Drugs & Tobacco',
  'Drugs',
  'Weapons',
  'Rude Gestures',
]

export interface ModerationLabel {
  name: string
  parent: string | null
  confidence: number
}

export type ImageModerationResult =
  | { status: 'clean'; labels: ModerationLabel[] }
  | { status: 'rejected'; labels: ModerationLabel[]; reason: string }
  | { status: 'unavailable'; labels: [] }

export interface ImageModerator {
  check(image: Buffer): Promise<ImageModerationResult>
}

/** Whether a label (or its top-level category) rejects the image. */
export function rejects(label: ModerationLabel): boolean {
  if (label.confidence < MIN_CONFIDENCE) return false
  return [label.name, label.parent].some(
    (name) => name !== null && REJECTED_CATEGORIES.includes(name)
  )
}

export function classify(labels: ModerationLabel[]): ImageModerationResult {
  const hit = labels.find(rejects)
  return hit
    ? {
        status: 'rejected',
        labels,
        reason: `image_${(hit.parent ?? hit.name).toLowerCase().replace(/[^a-z]+/g, '_')}`,
      }
    : { status: 'clean', labels }
}

export class RekognitionImageModerator implements ImageModerator {
  private readonly client = new RekognitionClient({ region: env.get('AWS_REGION') })

  async check(image: Buffer): Promise<ImageModerationResult> {
    const response = await this.client.send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: image },
        // Low floor so moderators see near-misses in the details; rejection uses MIN_CONFIDENCE.
        MinConfidence: 50,
      })
    )
    return classify(
      (response.ModerationLabels ?? []).map((label) => ({
        name: label.Name ?? 'unknown',
        parent: label.ParentName || null,
        confidence: label.Confidence ?? 0,
      }))
    )
  }
}

export class DisabledImageModerator implements ImageModerator {
  async check(): Promise<ImageModerationResult> {
    return { status: 'unavailable', labels: [] }
  }
}

/** In-memory stand-in for tests: clean unless labels are queued. */
export class FakeImageModerator implements ImageModerator {
  nextLabels: ModerationLabel[] = []
  available = true
  calls = 0

  async check(): Promise<ImageModerationResult> {
    this.calls++
    if (!this.available) return { status: 'unavailable', labels: [] }
    const labels = this.nextLabels
    this.nextLabels = []
    return classify(labels)
  }

  reset() {
    this.nextLabels = []
    this.available = true
    this.calls = 0
  }
}

export const fakeImageModerator = new FakeImageModerator()

let moderator: ImageModerator | null = null

export function getImageModerator(): ImageModerator {
  if (env.get('NODE_ENV') === 'test') {
    return fakeImageModerator
  }
  moderator ??=
    env.get('IMAGE_MODERATION', 'disabled') === 'rekognition'
      ? new RekognitionImageModerator()
      : new DisabledImageModerator()
  return moderator
}
