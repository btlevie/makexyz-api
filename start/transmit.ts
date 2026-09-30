/*
|--------------------------------------------------------------------------
| Transmit channel authorization
|--------------------------------------------------------------------------
|
| Private channels (see config/transmit.ts) go through the callbacks
| registered here before a client's subscribe request is accepted.
|
*/

import type { HttpContext } from '@adonisjs/core/http'
import transmit from '@adonisjs/transmit/services/main'
import { isStaff, resolveProject } from '#services/project_grant_service'
import { resolveConversation } from '#services/conversation_access_service'

/**
 * Slicing progress for a project's files. Uses the same three-way access
 * check as the rest of the anonymous instant-quote flow (grant header /
 * authenticated customer / staff) rather than requiring an account - forcing
 * one here would break the no-account-needed guest flow this system is built
 * on. `ctx.auth.user` is populated without needing this subscribe route
 * behind `middleware.auth()`, since SilentAuthMiddleware resolves it globally.
 */
transmit.authorize<{ projectUuid: string }>(
  'projects/:projectUuid/progress',
  async (ctx: HttpContext, { projectUuid }) => {
    if (await isStaff(ctx)) {
      return true
    }

    return (await resolveProject(ctx, projectUuid)) !== null
  }
)

/**
 * New/removed message events for a conversation (payload: event, message uuid
 * and seq only - clients fetch the message itself through the API, which
 * applies per-viewer visibility). Same participant check as the REST
 * endpoints (conversation_access_service.ts); admins may watch any thread.
 */
transmit.authorize<{ conversationUuid: string }>(
  'conversations/:conversationUuid',
  async (ctx: HttpContext, { conversationUuid }) => {
    return (await resolveConversation(ctx, conversationUuid)) !== null
  }
)
