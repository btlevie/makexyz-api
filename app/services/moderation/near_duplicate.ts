/**
 * Near-duplicate detection: the same pitch sent around with a word or two
 * changed, to slip past the exact-duplicate check. Texts are compared as
 * sets of word pairs (Jaccard resemblance). Measured on real-sized messages,
 * a one-word edit scores ~0.9, three edits ~0.65, two different quote
 * requests for similar parts ~0.4, unrelated text ~0 - so the threshold sits
 * between edits and genuinely separate messages.
 */

/** Messages shorter than this are too generic to compare ("thanks, sounds good"). */
export const NEAR_DUPLICATE_MIN_WORDS = 8

export const NEAR_DUPLICATE_THRESHOLD = 0.6

/** Word pairs of already-normalized text, or null when it's too short to compare. */
export function shingles(normalized: string): Set<string> | null {
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length < NEAR_DUPLICATE_MIN_WORDS) {
    return null
  }
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < words.length; i++) {
    pairs.add(`${words[i]} ${words[i + 1]}`)
  }
  return pairs
}

/** Jaccard resemblance of two shingle sets: 1 identical, 0 nothing shared. */
export function resemblance(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const pair of a) {
    if (b.has(pair)) shared++
  }
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}
