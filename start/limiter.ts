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
export const instantQuoteThrottle = limiter.define('instantQuote', () => {
  return limiter
    .allowRequests(env.get('INSTANT_QUOTE_RATE_LIMIT_REQUESTS', 10))
    .every(env.get('INSTANT_QUOTE_RATE_LIMIT_WINDOW', '1 hour'))
})
