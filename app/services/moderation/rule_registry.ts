/**
 * Resolves each rule's runtime mode and config: a moderation_rule_configs row
 * if one exists, otherwise the rule's own defaults. Cached briefly so the
 * send path doesn't hit the table on every message; admin changes take effect
 * within CACHE_TTL_MS (or immediately via clearRuleConfigCache).
 */
import ModerationRuleConfig from '#models/moderation_rule_config'
import { RULES } from '#services/moderation/rules/index'
import type { ModerationRule, RuleMode } from '#services/moderation/types'

const CACHE_TTL_MS = 60_000

export interface ResolvedRule {
  rule: ModerationRule<any>
  mode: RuleMode
  config: Record<string, unknown>
  /** 0 when the rule is running on its code defaults (no config row). */
  configVersion: number
}

let cache: { expiresAt: number; rules: ResolvedRule[] } | null = null

export function clearRuleConfigCache() {
  cache = null
}

/** Every rule that isn't switched off, with its effective mode and config. */
export async function getActiveRules(): Promise<ResolvedRule[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.rules
  }

  const rows = await ModerationRuleConfig.query().whereIn(
    'ruleId',
    RULES.map((rule) => rule.id)
  )
  const byRuleId = new Map(rows.map((row) => [row.ruleId, row]))

  const rules = RULES.map((rule): ResolvedRule => {
    const row = byRuleId.get(rule.id)
    return {
      rule,
      mode: row?.mode ?? rule.defaultMode,
      config: { ...rule.defaultConfig, ...(row?.config ?? {}) },
      configVersion: row?.configVersion ?? 0,
    }
  }).filter((resolved) => resolved.mode !== 'off')

  cache = { expiresAt: Date.now() + CACHE_TTL_MS, rules }
  return rules
}
