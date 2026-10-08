/**
 * Phrase matching for rules, plus the few vocabularies more than one rule
 * needs. A phrase list used by only one rule lives in that rule's file.
 */
import type { Evidence, TextViews, ViewName } from '#services/moderation/types'

const compiled = new Map<string, RegExp>()

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whole-word, case-insensitive matcher for a list of words/phrases. Spaces
 * inside a phrase match any run of whitespace. Cached per list.
 */
function matcherFor(terms: readonly string[]): RegExp {
  const key = terms.join('\u0000')
  let pattern = compiled.get(key)
  if (!pattern) {
    const alternatives = [...terms]
      .sort((a, b) => b.length - a.length)
      .map((term) => escapeRegExp(term).replace(/\\? /g, '\\s+'))
    pattern = new RegExp(`(?<![a-z0-9])(?:${alternatives.join('|')})(?![a-z0-9])`, 'gi')
    compiled.set(key, pattern)
  }
  pattern.lastIndex = 0
  return pattern
}

/** Every distinct term from `terms` found in `text`. */
export function findTerms(text: string, terms: readonly string[]): string[] {
  return [...new Set([...text.matchAll(matcherFor(terms))].map((match) => match[0].toLowerCase()))]
}

/**
 * Terms found in any of the given views, as evidence (the first view each
 * term appears in). Defaults to the views where obfuscation is undone.
 */
export function findInViews(
  views: TextViews,
  terms: readonly string[],
  viewNames: ViewName[] = ['deobfuscated', 'compact']
): Evidence[] {
  const evidence = new Map<string, Evidence>()
  for (const view of viewNames) {
    for (const match of findTerms(views[view], terms)) {
      if (!evidence.has(match)) evidence.set(match, { view, match })
    }
  }
  return [...evidence.values()]
}

/** Payment methods and rails outside MakeXYZ checkout. */
export const OFF_PLATFORM_PAYMENT_METHODS = [
  'paypal',
  'pay pal',
  'venmo',
  'cash app',
  'cashapp',
  'zelle',
  'wire transfer',
  'bank transfer',
  'direct deposit',
  'wise',
  'transferwise',
  'revolut',
  'western union',
  'moneygram',
  'apple pay',
  'google pay',
  'gpay',
  'bitcoin',
  'btc',
  'ethereum',
  'crypto',
  'usdt',
  'usdc',
  'tether',
  // Not bare "check"/"cash" - "check the file" would match constantly.
  'pay by check',
  'send a check',
  'mail a check',
  'cheque',
  'money order',
  'pay cash',
  'pay in cash',
  'cash payment',
] as const

/** Messaging apps and social networks people move conversations to. */
export const CHAT_PLATFORMS = [
  'discord',
  'telegram',
  'whatsapp',
  'whats app',
  'wechat',
  'skype',
  'instagram',
  'insta',
  'facebook',
  'messenger',
  'twitter',
  'linkedin',
  'snapchat',
  'tiktok',
  'viber',
  'kik',
  'threema',
  'signal app',
  'line app',
] as const

/** Hosts whose links are an invitation to talk elsewhere. */
export const CHAT_INVITE_HOSTS = [
  'discord.gg',
  'discord.com',
  'discordapp.com',
  't.me',
  'telegram.me',
  'telegram.org',
  'wa.me',
  'whatsapp.com',
  'signal.me',
  'signal.group',
  'm.me',
  'messenger.com',
  'instagram.com',
  'facebook.com',
  'fb.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'snapchat.com',
  'tiktok.com',
  'wechat.com',
  'weixin.qq.com',
  'skype.com',
  'join.skype.com',
  'viber.com',
] as const

/**
 * Words that show a message is about manufacturing work. Their absence is
 * what makes promotional language look like unrelated advertising.
 */
export const WORK_CONTEXT_TERMS = [
  'print',
  'printed',
  'printing',
  'part',
  'parts',
  'file',
  'files',
  'stl',
  'step',
  'cad',
  'model',
  'material',
  'pla',
  'petg',
  'abs',
  'nylon',
  'resin',
  'tpu',
  'infill',
  'layer',
  'tolerance',
  'quantity',
  'qty',
  'units',
  'pieces',
  'prototype',
  'order',
  'quote',
  'delivery',
  'shipping',
  'ship',
  'finish',
  'color',
  'colour',
  'size',
  'dimensions',
  'mm',
  'inch',
  'inches',
] as const
