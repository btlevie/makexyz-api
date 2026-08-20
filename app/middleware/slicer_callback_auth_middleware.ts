import { createHmac, timingSafeEqual } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'

/**
 * Authenticates callback requests from the slicer microservice. It isn't a
 * user session, so this checks an HMAC of the raw body against a shared
 * secret instead of going through the auth guards.
 */
export default class SlicerCallbackAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const signature = ctx.request.header('x-slicer-signature')
    const rawBody = ctx.request.raw() ?? ''

    if (!signature) {
      return ctx.response.unauthorized({ error: 'Missing signature' })
    }

    const expectedSignature = createHmac('sha256', env.get('SLICER_CALLBACK_SECRET'))
      .update(rawBody)
      .digest('hex')

    const signatureBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)

    const isValid =
      signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer)

    if (!isValid) {
      return ctx.response.unauthorized({ error: 'Invalid signature' })
    }

    return next()
  }
}
