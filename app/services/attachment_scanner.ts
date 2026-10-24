/**
 * Malware scanning for message attachments. GuardDuty Malware Protection for
 * S3 scans every object written under the protected (quarantine) prefix and
 * tags it with the result; the worker reads that tag - no extra queue or
 * webhook to provision. See attachment_service.ts for when this is asked.
 *
 * Infra: enable Malware Protection for S3 on the bucket, scoped to
 * `${S3_FILE_STORAGE_KEY}/quarantine/`, with tagging on; the app's role needs
 * s3:GetObjectTagging there.
 */
import { GetObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3'
import env from '#start/env'

/**
 * clean / infected: a verdict. pending: no result yet. unsupported: the
 * scanner couldn't scan it (too big, encrypted, access denied, failed).
 * disabled: there is no scanner (local dev).
 */
export type MalwareScanStatus = 'clean' | 'infected' | 'pending' | 'unsupported' | 'disabled'

export interface MalwareScanner {
  status(key: string): Promise<MalwareScanStatus>
}

/** The tag GuardDuty writes, and its values. */
const RESULT_TAG = 'GuardDutyMalwareScanStatus'
const RESULTS: Record<string, MalwareScanStatus> = {
  NO_THREATS_FOUND: 'clean',
  THREATS_FOUND: 'infected',
  UNSUPPORTED: 'unsupported',
  ACCESS_DENIED: 'unsupported',
  FAILED: 'unsupported',
}

export class GuardDutyTagScanner implements MalwareScanner {
  private readonly client = new S3Client({ region: env.get('AWS_REGION') })

  async status(key: string): Promise<MalwareScanStatus> {
    const { TagSet } = await this.client.send(
      new GetObjectTaggingCommand({ Bucket: env.get('S3_BUCKET'), Key: key })
    )
    const value = TagSet?.find((tag) => tag.Key === RESULT_TAG)?.Value
    return value ? (RESULTS[value] ?? 'unsupported') : 'pending'
  }
}

export class DisabledScanner implements MalwareScanner {
  async status(): Promise<MalwareScanStatus> {
    return 'disabled'
  }
}

/** In-memory stand-in for tests: everything is clean unless marked. */
export class FakeMalwareScanner implements MalwareScanner {
  readonly results = new Map<string, MalwareScanStatus>()
  fallback: MalwareScanStatus = 'clean'

  async status(key: string): Promise<MalwareScanStatus> {
    return this.results.get(key) ?? this.fallback
  }

  reset() {
    this.results.clear()
    this.fallback = 'clean'
  }
}

export const fakeMalwareScanner = new FakeMalwareScanner()

let scanner: MalwareScanner | null = null

export function getMalwareScanner(): MalwareScanner {
  if (env.get('NODE_ENV') === 'test') {
    return fakeMalwareScanner
  }
  scanner ??=
    env.get('ATTACHMENT_SCANNER', 'disabled') === 'guardduty'
      ? new GuardDutyTagScanner()
      : new DisabledScanner()
  return scanner
}
