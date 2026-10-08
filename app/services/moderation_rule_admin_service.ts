/**
 * Admin control over moderation rules: see every rule with its effective
 * mode and config, and switch a rule's mode or tune its thresholds. Changes
 * are runtime config (moderation_rule_configs), versioned - every rule hit
 * records the config version it ran under - and logged to
 * moderation_actions.
 */
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import ModerationRuleConfig from '#models/moderation_rule_config'
import { RULES } from '#services/moderation/rules/index'
import { clearRuleConfigCache } from '#services/moderation/rule_registry'
import type { ModerationRule, RuleMode } from '#services/moderation/types'
import { recordModerationAction } from '#services/moderation_action_service'

export class InvalidRuleConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRuleConfigError'
  }
}

export interface RuleView {
  id: string
  version: number
  description: string
  defaultMode: RuleMode
  mode: RuleMode
  defaultConfig: Record<string, unknown>
  config: Record<string, unknown>
  configVersion: number
}

export function findRule(ruleId: string): ModerationRule<any> | null {
  return RULES.find((rule) => rule.id === ruleId) ?? null
}

export async function listRules(): Promise<RuleView[]> {
  const rows = await ModerationRuleConfig.all()
  const byId = new Map(rows.map((row) => [row.ruleId, row]))
  return RULES.map((rule) => {
    const row = byId.get(rule.id)
    return {
      id: rule.id,
      version: rule.version,
      description: rule.description,
      defaultMode: rule.defaultMode,
      mode: row?.mode ?? rule.defaultMode,
      defaultConfig: rule.defaultConfig,
      config: { ...rule.defaultConfig, ...(row?.config ?? {}) },
      configVersion: row?.configVersion ?? 0,
    }
  })
}

/**
 * Config overrides may only set keys the rule defines, with the same type as
 * the default (a number stays a number, an enum-like string stays a string).
 */
function validateOverrides(rule: ModerationRule<any>, overrides: Record<string, unknown>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in rule.defaultConfig)) {
      throw new InvalidRuleConfigError(`${rule.id} has no setting "${key}"`)
    }
    if (typeof value !== typeof rule.defaultConfig[key]) {
      throw new InvalidRuleConfigError(
        `${rule.id} setting "${key}" must be a ${typeof rule.defaultConfig[key]}`
      )
    }
  }
}

export async function updateRule(
  rule: ModerationRule<any>,
  changes: { mode?: RuleMode; config?: Record<string, unknown> },
  admin: User,
  reason?: string
): Promise<RuleView> {
  if (changes.config) {
    validateOverrides(rule, changes.config)
  }

  await db.transaction(async (trx) => {
    const existing = await ModerationRuleConfig.query({ client: trx })
      .where('ruleId', rule.id)
      .forUpdate()
      .first()
    const before = {
      mode: existing?.mode ?? rule.defaultMode,
      config: existing?.config ?? {},
      configVersion: existing?.configVersion ?? 0,
    }
    const after = {
      mode: changes.mode ?? before.mode,
      config: changes.config ? { ...before.config, ...changes.config } : before.config,
      configVersion: before.configVersion + 1,
    }

    if (existing) {
      existing.useTransaction(trx)
      existing.merge({ ...after, updatedById: admin.id })
      await existing.save()
    } else {
      await ModerationRuleConfig.create(
        { ruleId: rule.id, ...after, updatedById: admin.id },
        { client: trx }
      )
    }

    await recordModerationAction(
      {
        actorUserId: admin.id,
        action: 'rule_config_change',
        targetType: 'rule',
        targetId: rule.id,
        reason,
        metadata: { before, after },
      },
      trx
    )
  })

  clearRuleConfigCache()
  const views = await listRules()
  return views.find((view) => view.id === rule.id)!
}
