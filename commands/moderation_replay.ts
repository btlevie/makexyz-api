import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { replay, sinceFrom } from '#services/moderation_replay_service'

/**
 * Runs a rule (or every rule) over stored past messages and reports how it
 * would have done against moderators' labels - recall on confirmed
 * violations, false positives on known-clean messages - before it's promoted
 * to enforce. Reads only; changes nothing.
 *
 *   node ace moderation:replay --rule spam.near_duplicate --since 90d
 *   node ace moderation:replay --rule behavior.velocity --config '{"hourReview":40}'
 */
export default class ModerationReplay extends BaseCommand {
  static commandName = 'moderation:replay'
  static description = 'Replay a moderation rule over stored messages and measure it against labels'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'The rule to replay (all rules when omitted)' })
  declare rule: string

  @flags.string({ description: 'How far back, e.g. 90d, 24h, 2w', default: '90d' })
  declare since: string

  @flags.string({ description: 'JSON config overrides for the rule' })
  declare config: string

  @flags.number({ description: 'Most messages to replay', default: 5000 })
  declare limit: number

  @flags.number({ description: 'Examples to print per outcome', default: 5 })
  declare examples: number

  async run() {
    let config: Record<string, unknown> | undefined
    if (this.config) {
      try {
        config = JSON.parse(this.config)
      } catch {
        this.logger.error('--config must be JSON')
        this.exitCode = 1
        return
      }
    }

    const report = await replay({
      ruleId: this.rule || undefined,
      config,
      since: sinceFrom(this.since),
      limit: this.limit,
      examples: this.examples,
    })
    const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)

    this.logger.info(
      `${report.ruleId ?? 'all rules'} over ${report.evaluated} messages since ${this.since}`
    )
    this.logger.info(`Fired on ${report.fired}`)
    this.logger.info(
      `Recall: ${report.violationsCaught}/${report.violations} confirmed violations (${pct(report.recall)})`
    )
    this.logger.info(
      `False positives: ${report.cleanHit}/${report.clean} known-clean messages (${pct(report.falsePositiveRate)})`
    )
    if (!report.ruleId) {
      this.logger.info(`Decisions that differ from the time: ${report.changedDecisions}`)
    }
    for (const [kind, rows] of Object.entries(report.examples)) {
      if (rows.length === 0) continue
      this.logger.info(`${kind}: ${rows.map((row) => row.messageUuid).join(', ')}`)
    }
  }
}
