/*
|--------------------------------------------------------------------------
| Define HTTP limiters
|--------------------------------------------------------------------------
|
| The "limiter.define" method creates an HTTP middleware to apply rate
| limits on a route or a group of routes. Feel free to define as many
| throttle middleware as needed.
|
*/

import limiter from '@adonisjs/limiter/services/main'
import env from '#start/env'

export const throttle = limiter.define('global', () => {
  return limiter.allowRequests(10).every('1 minute')
})

/**
 * The instant-quote upload is unauthenticated and costs real money on every
 * call - it writes the model to S3 and invokes the slicing Lambda. Without a
 * cap it is a trivial cost-amplification vector, so this is what makes opening
 * the route safe. Keyed per IP.
 *
 * Defaults are applied here rather than in the env schema so that an unset or
 * removed variable can never silently disable the limit.
 */
/**
 * Resending a verification email sends real mail through SES, so it's capped
 * per account (not per IP - the route is authenticated).
 */
export const emailVerificationThrottle = limiter.define('emailVerification', (ctx) => {
  return limiter
    .allowRequests(3)
    .every('1 hour')
    .usingKey(`user_${ctx.auth.user?.id ?? ctx.request.ip()}`)
})

/**
 * Sending messages and starting inquiries, per account. A floor against
 * floods - the per-day inquiry caps and moderation do the real work (see
 * conversation_service.ts).
 */
export const messagingThrottle = limiter.define('messaging', (ctx) => {
  return limiter
    .allowRequests(20)
    .every('1 minute')
    .usingKey(`user_${ctx.auth.user?.id ?? ctx.request.ip()}`)
})

/**
 * The public link interstitial, per IP. A click can trigger a live
 * reputation check (Web Risk, redirect following) when the cached verdict has
 * expired, so it's capped like any other call that costs an outbound request.
 */
export const linkThrottle = limiter.define('links', (ctx) => {
  return limiter.allowRequests(60).every('1 minute').usingKey(`ip_${ctx.request.ip()}`)
})

/**
 * Attachment uploads, per account: each issues a presigned S3 upload and
 * queues a scan.
 */
export const attachmentThrottle = limiter.define('attachments', (ctx) => {
  return limiter
    .allowRequests(30)
    .every('10 minutes')
    .usingKey(`user_${ctx.auth.user?.id ?? ctx.request.ip()}`)
})

export const instantQuoteThrottle = limiter.define('instantQuote', () => {
  return limiter
    .allowRequests(env.get('INSTANT_QUOTE_RATE_LIMIT_REQUESTS', 10))
    .every(env.get('INSTANT_QUOTE_RATE_LIMIT_WINDOW', '1 hour'))
})
