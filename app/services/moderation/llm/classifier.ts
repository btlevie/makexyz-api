/**
 * The one call the moderation pipeline makes to an LLM: Claude Sonnet 5.5 on
 * Amazon Bedrock (D6, updated). Auth is the default AWS credential chain -
 * the ECS task role in production, AWS_PROFILE locally - so there's no new
 * secret. BEDROCK_REGION is separate from AWS_REGION because the model isn't
 * served in-region in us-west-1.
 *
 * Fails closed: an error, a refusal, a truncated or malformed reply all come
 * back as `ok: false`, which the caller turns into human review.
 */
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import type Anthropic from '@anthropic-ai/sdk'
import env from '#start/env'
import {
  buildUserContent,
  LLM_ACTIONS,
  LLM_CATEGORIES,
  SYSTEM_PROMPT,
  VERDICT_SCHEMA,
  type LlmAction,
  type LlmCategory,
  type PromptContext,
} from '#services/moderation/llm/prompt'

export const DEFAULT_BEDROCK_MODEL = 'anthropic.claude-sonnet-5-5'

/** Per-MTok prices for the cost metrics (Sonnet 5.5 list price; Bedrock bills via AWS). */
export const MODEL_PRICES = { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }

const MAX_TOKENS = 1024
const TIMEOUT_MS = 30_000

export interface LlmVerdict {
  categories: { category: LlmCategory; confidence: number }[]
  recommendedAction: LlmAction
  confidence: number
  rationale: string
  evidenceQuotes: string[]
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Estimated from MODEL_PRICES. */
  costUsd: number
}

export type ClassifierResult =
  | { ok: true; verdict: LlmVerdict; usage: LlmUsage; model: string; latencyMs: number }
  | {
      ok: false
      /** 'refusal', 'max_tokens', 'malformed', 'error', 'unavailable'. */
      failure: string
      detail: string | null
      usage: LlmUsage | null
      model: string
      latencyMs: number
    }

export interface ModerationClassifier {
  readonly model: string
  classify(context: PromptContext): Promise<ClassifierResult>
}

export function usageOf(usage: Anthropic.Usage | undefined): LlmUsage {
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0
  const costUsd =
    (inputTokens * MODEL_PRICES.input +
      outputTokens * MODEL_PRICES.output +
      cacheReadTokens * MODEL_PRICES.cacheRead +
      cacheWriteTokens * MODEL_PRICES.cacheWrite) /
    1_000_000
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd }
}

function clamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null
}

/**
 * Validates the model's JSON against what the pipeline relies on - the
 * schema constrains the shape, but enums, ranges and lengths are checked
 * here too. Null means malformed (fail closed).
 */
export function parseVerdict(text: string): LlmVerdict | null {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.categories)) return null
  if (!LLM_ACTIONS.includes(raw.recommended_action)) return null
  const confidence = clamp(raw.confidence)
  if (confidence === null || typeof raw.rationale !== 'string') return null

  const categories: LlmVerdict['categories'] = []
  for (const entry of raw.categories) {
    const entryConfidence = clamp(entry?.confidence)
    if (!LLM_CATEGORIES.includes(entry?.category) || entryConfidence === null) return null
    categories.push({ category: entry.category, confidence: entryConfidence })
  }
  if (categories.length === 0) return null

  return {
    categories,
    recommendedAction: raw.recommended_action,
    confidence,
    rationale: raw.rationale.slice(0, 300),
    evidenceQuotes: Array.isArray(raw.evidence_quotes)
      ? raw.evidence_quotes.filter((quote: unknown) => typeof quote === 'string').slice(0, 10)
      : [],
  }
}

export class BedrockModerationClassifier implements ModerationClassifier {
  readonly model: string
  private readonly client: AnthropicBedrockMantle

  constructor(
    region = env.get('BEDROCK_REGION'),
    model = env.get('BEDROCK_MODEL_ID', DEFAULT_BEDROCK_MODEL)
  ) {
    this.model = model
    // apiKey: null - IAM (SigV4) through the default credential chain only,
    // never a bearer token picked up from the environment.
    this.client = new AnthropicBedrockMantle({
      awsRegion: region,
      apiKey: null,
      timeout: TIMEOUT_MS,
      maxRetries: 2,
    })
  }

  async classify(context: PromptContext): Promise<ClassifierResult> {
    const startedAt = performance.now()
    const latency = () => Math.round(performance.now() - startedAt)
    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        // Static system prompt first, cached across calls.
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserContent(context) }],
        // Classification: adaptive thinking at low effort keeps it short.
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: VERDICT_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      })
    } catch (error) {
      return {
        ok: false,
        failure: 'error',
        detail: error instanceof Error ? error.message.slice(0, 300) : String(error),
        usage: null,
        model: this.model,
        latencyMs: latency(),
      }
    }

    const usage = usageOf(response.usage)
    if (response.stop_reason === 'refusal') {
      return {
        ok: false,
        failure: 'refusal',
        detail: response.stop_details?.category ?? null,
        usage,
        model: this.model,
        latencyMs: latency(),
      }
    }
    if (response.stop_reason === 'max_tokens') {
      return {
        ok: false,
        failure: 'max_tokens',
        detail: null,
        usage,
        model: this.model,
        latencyMs: latency(),
      }
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const verdict = parseVerdict(text)
    if (!verdict) {
      return {
        ok: false,
        failure: 'malformed',
        detail: text.slice(0, 300),
        usage,
        model: this.model,
        latencyMs: latency(),
      }
    }
    return { ok: true, verdict, usage, model: this.model, latencyMs: latency() }
  }
}

/** In-memory stand-in for tests: returns queued results, else an "allow". */
export class FakeModerationClassifier implements ModerationClassifier {
  readonly model = 'fake-classifier'
  readonly calls: PromptContext[] = []
  private readonly queued: ClassifierResult[] = []

  respond(result: ClassifierResult) {
    this.queued.push(result)
  }

  /** Queues a successful verdict. */
  verdict(action: LlmAction, confidence: number, categories: LlmVerdict['categories'] = []) {
    this.respond({
      ok: true,
      verdict: {
        categories: categories.length > 0 ? categories : [{ category: 'none', confidence }],
        recommendedAction: action,
        confidence,
        rationale: `fake ${action}`,
        evidenceQuotes: [],
      },
      usage: {
        inputTokens: 2000,
        outputTokens: 150,
        cacheReadTokens: 1200,
        cacheWriteTokens: 0,
        costUsd: 0.0057,
      },
      model: this.model,
      latencyMs: 5,
    })
  }

  async classify(context: PromptContext): Promise<ClassifierResult> {
    this.calls.push(context)
    const next = this.queued.shift()
    if (next) return next
    return {
      ok: true,
      verdict: {
        categories: [{ category: 'none', confidence: 0.9 }],
        recommendedAction: 'allow',
        confidence: 0.9,
        rationale: 'fake allow',
        evidenceQuotes: [],
      },
      usage: {
        inputTokens: 2000,
        outputTokens: 150,
        cacheReadTokens: 1200,
        cacheWriteTokens: 0,
        costUsd: 0.0057,
      },
      model: this.model,
      latencyMs: 5,
    }
  }

  reset() {
    this.calls.length = 0
    this.queued.length = 0
  }
}
