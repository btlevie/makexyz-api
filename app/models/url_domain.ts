import { UrlDomainSchema } from '#database/schema'

/**
 * A domain (or more specific host) seen in messages: its moderator list
 * override, RDAP age and how widely it's been seen. See
 * app/services/moderation/url/domain_lists.ts for how lists resolve.
 */
export default class UrlDomain extends UrlDomainSchema {}
