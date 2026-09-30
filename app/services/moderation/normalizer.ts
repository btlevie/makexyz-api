import type { TextViews } from '#services/moderation/types'

/**
 * Zero-width and bidi control characters - invisible, and a classic way to
 * split "gmail.com" so a naive pattern misses it.
 */
const INVISIBLE_CHARACTERS = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g

/** `[.]`, `(.)`, `{.}`, `[dot]`, `(dot)`, `{dot}` - with optional spaces inside. */
const BRACKETED_DOT = /\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/g
/** `[at]`, `(at)`, `{at}`. */
const BRACKETED_AT = /\s*[[({]\s*(?:@|at)\s*[\])}]\s*/g
/** ` dot ` between two word characters: "gmail dot com". */
const SPACED_DOT = /(?<=\w)\s+dot\s+(?=\w)/g
/** hxxp / hxxps - the defanged-link convention. */
const DEFANGED_SCHEME = /\bhxxp(s?)(?=:\/\/|\[:\]\/\/)/g
const BRACKETED_COLON = /\[:\]/g
/**
 * A bare " at " directly before something domain-shaped ("jo at gmail.com").
 * Only applied to the loose view - "look at example.com" matches too, which
 * is why emails found only there are treated as less certain.
 */
const SPACED_AT = /(?<=[\w.+-])\s+at\s+(?=[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b)/g

export function buildViews(text: string): TextViews {
  const normalized = text.normalize('NFKC').replace(INVISIBLE_CHARACTERS, '').toLowerCase()

  const deobfuscated = normalized
    .replace(DEFANGED_SCHEME, 'http$1')
    .replace(BRACKETED_COLON, ':')
    .replace(BRACKETED_DOT, '.')
    .replace(BRACKETED_AT, '@')
    .replace(SPACED_DOT, '.')

  const deobfuscatedLoose = deobfuscated.replace(SPACED_AT, '@')

  return { raw: text, normalized, deobfuscated, deobfuscatedLoose }
}
