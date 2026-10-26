import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { writeFile } from 'node:fs/promises'
import { exportCorpus } from '#services/corpus_export_service'
import { sinceFrom } from '#services/moderation_replay_service'

/**
 * Exports labelled messages as anonymized fixtures for rule tests and the
 * regression corpus (corpus_export_service.ts). Review the file before
 * committing it - free-text names in a message can't be detected reliably.
 *
 *   node ace moderation:export-corpus --since 30d --out tmp/corpus.json
 */
export default class ModerationExportCorpus extends BaseCommand {
  static commandName = 'moderation:export-corpus'
  static description = 'Export labelled messages as anonymized moderation fixtures'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'How far back, e.g. 90d, 24h, 2w', default: '90d' })
  declare since: string

  @flags.string({ description: 'Where to write the JSON', default: 'tmp/moderation-corpus.json' })
  declare out: string

  @flags.boolean({
    description: 'Only messages a moderator looked at (skip unreviewed clean deliveries)',
    default: true,
  })
  declare labelledOnly: boolean

  async run() {
    const entries = await exportCorpus({
      since: sinceFrom(this.since),
      labelledOnly: this.labelledOnly,
    })
    await writeFile(
      this.out,
      JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)
    )
    const violations = entries.filter((entry) => entry.label === 'violation').length
    this.logger.info(
      `${entries.length} entries (${violations} violations) written to ${this.out} - review before committing`
    )
  }
}
