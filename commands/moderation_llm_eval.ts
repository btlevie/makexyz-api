import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile, writeFile } from 'node:fs/promises'
import { decide, redact } from '#services/llm_moderation_service'
import {
  BedrockModerationClassifier,
  type ClassifierResult,
} from '#services/moderation/llm/classifier'
import { PROMPT_VERSION, type PromptContext } from '#services/moderation/llm/prompt'

interface EvalCase {
  id: string
  expected: 'allow' | 'not_allow' | 'block'
  categories: string[]
  sender: 'customer' | 'vendor'
  kind: 'inquiry' | 'order'
  phase: string
  daysInPhase?: number
  senderBlocked30d?: number
  rulesFired: string[]
  links?: { domain: string; verdict: string; domainAgeDays: number | null }[]
  history: [string, string, string][]
  message: string
}

const FIXTURE = 'tests/fixtures/moderation/llm_eval.json'
/** Category confidence that counts as "named" when scoring categories. */
const CATEGORY_THRESHOLD = 0.5

function contextFor(entry: EvalCase): PromptContext {
  return {
    message: redact(entry.message),
    history: entry.history.map(([role, age, text]) => ({
      role: role as PromptContext['history'][number]['role'],
      age,
      text: redact(text),
    })),
    conversation: {
      kind: entry.kind,
      dealPhase: entry.phase,
      daysInPhase: entry.daysInPhase ?? 1,
      direction: entry.sender === 'vendor' ? 'vendor_to_customer' : 'customer_to_other',
      firstMessageOfInquiry: entry.kind === 'inquiry' && entry.history.length === 0,
      channel: 'web',
    },
    sender: {
      role: entry.sender,
      accountAgeDays: 30,
      trustTier: 'standard',
      deliveredMessages: 20,
      blockedMessages30d: entry.senderBlocked30d ?? 0,
      confirmedViolations30d: 0,
      reportsReceived30d: 0,
    },
    rulesFired: entry.rulesFired.map((rule) => {
      const [ruleId, mode] = rule.split(' ')
      return { ruleId, action: mode ? `escalate ${mode}` : 'escalate', reasonCode: ruleId }
    }),
    links: (entry.links ?? []).map((link) => ({
      ...link,
      list: 'none',
      flags: [],
      redirectsTo: null,
    })),
  }
}

/**
 * Runs the offline eval set against the real classifier on Bedrock and
 * reports what matters before LLM_MODERATION_MODE=enforce: the false-allow
 * rate (a violation the LLM would deliver), false blocks, per-category
 * precision/recall, latency and cost. Every run calls Bedrock and costs real
 * money - check the estimate with --dry-run first.
 */
export default class ModerationLlmEval extends BaseCommand {
  static commandName = 'moderation:llm-eval'
  static description = 'Run the LLM moderation eval set against Bedrock (costs money)'
  static options: CommandOptions = { startApp: true }

  @flags.boolean({ description: 'Print the cases and the cost estimate without calling Bedrock' })
  declare dryRun: boolean

  @flags.string({ description: 'Only run the case with this id' })
  declare only: string

  @flags.string({ description: 'Write the full results here as JSON' })
  declare out: string

  async run() {
    const fixture = JSON.parse(await readFile(FIXTURE, 'utf8')) as { cases: EvalCase[] }
    const cases = fixture.cases.filter((entry) => !this.only || entry.id === this.only)

    if (this.dryRun) {
      // ~2.5K input (1.2K of it the cached system prompt) + ~200 output tokens per call.
      const estimate = cases.length * 0.005
      this.logger.info(
        `${cases.length} cases, prompt ${PROMPT_VERSION}, roughly $${estimate.toFixed(2)} per run`
      )
      return
    }

    const classifier = new BedrockModerationClassifier()
    const rows: { entry: EvalCase; result: ClassifierResult; outcome: string }[] = []
    for (const entry of cases) {
      const result = await classifier.classify(contextFor(entry))
      const injection = entry.rulesFired.some((rule) => rule.startsWith('llm.injection_text'))
      const outcome = result.ok ? decide(result.verdict, injection) : 'review'
      rows.push({ entry, result, outcome })
      this.logger.info(
        `${entry.id.padEnd(28)} expected ${entry.expected.padEnd(9)} got ${outcome.padEnd(6)}${result.ok ? '' : ` (${result.failure})`}`
      )
    }

    const violations = rows.filter((row) => row.entry.expected !== 'allow')
    const legitimate = rows.filter((row) => row.entry.expected === 'allow')
    const falseAllows = violations.filter((row) => row.outcome === 'allow')
    const falseBlocks = legitimate.filter((row) => row.outcome === 'block')
    const autoAllowed = legitimate.filter((row) => row.outcome === 'allow')
    const missedBlocks = rows.filter(
      (row) => row.entry.expected === 'block' && row.outcome !== 'block'
    )

    const categories = new Map<string, { tp: number; fp: number; fn: number }>()
    for (const row of rows) {
      const named = new Set(
        row.result.ok
          ? row.result.verdict.categories
              .filter((entry) => entry.confidence >= CATEGORY_THRESHOLD)
              .map((entry) => entry.category as string)
          : []
      )
      const expected = new Set(row.entry.categories)
      for (const category of new Set([...named, ...expected])) {
        const counts = categories.get(category) ?? { tp: 0, fp: 0, fn: 0 }
        if (named.has(category) && expected.has(category)) counts.tp++
        else if (named.has(category)) counts.fp++
        else counts.fn++
        categories.set(category, counts)
      }
    }

    const costUsd = rows.reduce((sum, row) => sum + (row.result.usage?.costUsd ?? 0), 0)
    const latencies = rows.map((row) => row.result.latencyMs).sort((a, b) => a - b)
    const pct = (part: number, whole: number) =>
      whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`

    this.logger.info('')
    this.logger.info(
      `False-allow rate (violations delivered): ${falseAllows.length}/${violations.length} = ${pct(falseAllows.length, violations.length)}`
    )
    this.logger.info(
      `False blocks (ordinary messages blocked): ${falseBlocks.length}/${legitimate.length}`
    )
    this.logger.info(
      `Ordinary messages auto-allowed (saved a review): ${pct(autoAllowed.length, legitimate.length)}`
    )
    this.logger.info(
      `Clear violations auto-blocked: ${pct(rows.filter((r) => r.entry.expected === 'block').length - missedBlocks.length, rows.filter((r) => r.entry.expected === 'block').length)}`
    )
    this.logger.info(
      `Failures (refusal/error/malformed): ${rows.filter((row) => !row.result.ok).length}`
    )
    for (const [category, { tp, fp, fn }] of [...categories].sort()) {
      this.logger.info(
        `  ${category.padEnd(22)} precision ${pct(tp, tp + fp).padStart(6)}  recall ${pct(tp, tp + fn).padStart(6)}`
      )
    }
    this.logger.info(
      `Latency p50 ${latencies[Math.floor(latencies.length / 2)] ?? 0}ms, p95 ${latencies[Math.floor(latencies.length * 0.95)] ?? 0}ms`
    )
    this.logger.info(
      `Cost $${costUsd.toFixed(4)} for ${rows.length} calls (prompt ${PROMPT_VERSION}, ${classifier.model})`
    )
    if (falseAllows.length > 0) {
      this.logger.warning(`False allows: ${falseAllows.map((row) => row.entry.id).join(', ')}`)
    }

    if (this.out) {
      await writeFile(
        this.out,
        JSON.stringify({ promptVersion: PROMPT_VERSION, model: classifier.model, rows }, null, 2)
      )
      this.logger.info(`Results written to ${this.out}`)
    }
  }
}
