import { remove as removeConfusables } from 'confusables'
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

/** Anything outside printable ASCII - the only characters handed to the confusables map. */
const NON_ASCII = /[^\x20-\x7e\n\r\t]/g

/**
 * Look-alike characters (Cyrillic "а" in "pаypal", script "𝓰") mapped to
 * Latin. NFKC runs first, so full-width digits are already real digits by
 * here - the confusables map would otherwise read "０" as the letter O. ASCII
 * is never touched.
 */
function foldConfusables(text: string): string {
  return text.replace(NON_ASCII, (character) => removeConfusables(character))
}

/** Leetspeak, for word-list matching only (it destroys real digits). */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '|': 'l',
}
const LEET_CHARACTERS = /[013457@$!|]/g

/**
 * Three or more single letters split by spaces or punctuation ("w h a t s a p
 * p", "t.e.l.e.g.r.a.m") - joined back into one word.
 */
const SPACED_LETTERS = /\b[a-z](?:[\s.\-_*/]+[a-z]\b){2,}/g

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
}
const NUMBER_WORD = /\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g
/** Separators between digit groups: "555 - 234 . 9876", "five five five, two..." */
const DIGIT_SEPARATORS = /(?<=\d)[\s.,\-()/]+(?=\d)/g

export function buildViews(text: string): TextViews {
  const normalized = foldConfusables(
    text.normalize('NFKC').replace(INVISIBLE_CHARACTERS, '')
  ).toLowerCase()

  const deobfuscated = normalized
    .replace(DEFANGED_SCHEME, 'http$1')
    .replace(BRACKETED_COLON, ':')
    .replace(BRACKETED_DOT, '.')
    .replace(BRACKETED_AT, '@')
    .replace(SPACED_DOT, '.')

  const deobfuscatedLoose = deobfuscated.replace(SPACED_AT, '@')

  const compact = deobfuscated
    .replace(LEET_CHARACTERS, (character) => LEET[character] ?? character)
    .replace(SPACED_LETTERS, (run) => run.replace(/[^a-z]/g, ''))

  const numeric = deobfuscated
    .replace(NUMBER_WORD, (word) => NUMBER_WORDS[word] ?? word)
    .replace(DIGIT_SEPARATORS, '')

  return { raw: text, normalized, deobfuscated, deobfuscatedLoose, compact, numeric }
}
