import { ModerationTermSchema } from '#database/schema'

/**
 * An admin change to the prohibited-item word lists - an addition, or an
 * override of a built-in term. See app/services/moderation/term_registry.ts.
 */
export default class ModerationTerm extends ModerationTermSchema {}
