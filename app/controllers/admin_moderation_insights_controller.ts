import type { HttpContext } from '@adonisjs/core/http'
import ModerationPatternReport from '#models/moderation_pattern_report'
import { statsWindowValidator } from '#validators/messaging'
import { isAdmin } from '#services/project_grant_service'
import { ruleStats } from '#services/rule_stats_service'

const REPORTS_LISTED = 52

/**
 * What the moderation loop has learned: how precise each rule is against
 * moderators' decisions (rule_stats_service.ts), and the weekly
 * pattern-discovery reports (abuse_pattern_service.ts). Read-only.
 */
export default class AdminModerationInsightsController {
  /** Per-rule hits, precision and recall over the last `days` (default 30). */
  async ruleStats(ctx: HttpContext) {
    const { request, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const { days } = await request.validateUsing(statsWindowValidator)
    return await serialize({ days: days ?? 30, rules: await ruleStats(days ?? 30) })
  }

  /** The weekly reports, newest first, without their cluster detail. */
  async patternReports(ctx: HttpContext) {
    const { response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const reports = await ModerationPatternReport.query()
      .orderBy('id', 'desc')
      .limit(REPORTS_LISTED)
    return await serialize({
      reports: reports.map((report) => ({
        uuid: report.uuid,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        violations: report.violations,
        missedByAutomation: report.missedByAutomation,
        clusters: report.clusters?.length ?? 0,
        createdAt: report.createdAt,
      })),
    })
  }

  async patternReport(ctx: HttpContext) {
    const { params, response, serialize } = ctx
    if (!isAdmin(ctx)) {
      return response.forbidden({ error: 'Admin access required' })
    }
    const report = await ModerationPatternReport.findBy('uuid', params.uuid)
    if (!report) {
      return response.notFound({ error: 'Report not found' })
    }
    return await serialize({
      uuid: report.uuid,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      violations: report.violations,
      missedByAutomation: report.missedByAutomation,
      clusters: report.clusters ?? [],
      summaries: report.summaries ?? [],
      createdAt: report.createdAt,
    })
  }
}
