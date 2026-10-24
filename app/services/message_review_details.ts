/**
 * What a moderator needs alongside a message: its rule hits, its links with
 * their reputation (verdict, threats, where redirects ended), and its
 * attachments with what the checks found. Set on each message's $extras for
 * AdminMessageTransformer.
 */
import type Message from '#models/message'
import MessageAttachment from '#models/message_attachment'
import MessageUrl from '#models/message_url'
import ModerationRuleHit from '#models/moderation_rule_hit'
import UrlScan from '#models/url_scan'

export async function loadReviewDetails(messages: Message[]) {
  const ids = messages.map((message) => message.id)
  if (ids.length === 0) return

  const [hits, urls, attachments] = await Promise.all([
    ModerationRuleHit.query().whereIn('messageId', ids),
    MessageUrl.query().whereIn('messageId', ids),
    MessageAttachment.query().whereIn('messageId', ids),
  ])
  const scans = await UrlScan.query().whereIn(
    'urlHash',
    urls.map((url) => url.urlHash)
  )

  for (const message of messages) {
    message.$extras.ruleHits = hits
      .filter((hit) => hit.messageId === message.id)
      .map((hit) => ({
        ruleId: hit.ruleId,
        ruleVersion: hit.ruleVersion,
        action: hit.action,
        shadow: hit.shadow,
        evidence: hit.evidence,
      }))
    message.$extras.links = urls
      .filter((url) => url.messageId === message.id)
      .map((url) => {
        const scan = scans.find((row) => row.urlHash === url.urlHash)
        return {
          url: url.normalizedUrl,
          domain: url.domain,
          source: url.source,
          scan: scan
            ? {
                verdict: scan.verdict,
                threatTypes: scan.threatTypes ?? [],
                finalUrl: scan.finalUrl,
                redirectChain: scan.redirectChain ?? [],
                details: scan.details,
                checkedAt: scan.checkedAt,
                expiresAt: scan.expiresAt,
              }
            : null,
        }
      })
    message.$extras.attachments = attachments
      .filter((file) => file.messageId === message.id)
      .map((file) => ({
        uuid: file.uuid,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        contentType: file.contentType,
        status: file.status,
        rejectReason: file.rejectReason,
        scanDetails: file.scanDetails,
      }))
  }
}
