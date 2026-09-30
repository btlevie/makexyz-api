import { BaseMail } from '@adonisjs/mail'

export interface NotificationPreview {
  from: string
  body: string
}

/**
 * "You have new messages" - one debounced digest per recipient (see
 * message_notification_service.ts). Message text is only included when every
 * message in it is delivered, unflagged and from an established sender;
 * otherwise it's a plain nudge with a link, so nothing that might later be
 * removed ever sits in an inbox. Guests (no account yet) are told to create
 * or claim one to read and reply.
 */
export default class NewMessageNotification extends BaseMail {
  constructor(
    private email: string,
    private options: {
      conversationTitle: string
      messageCount: number
      conversationUrl: string | null
      previews: NotificationPreview[] | null
      recipientIsGuest: boolean
    }
  ) {
    super()
    this.subject = `New message: ${options.conversationTitle}`
  }

  prepare() {
    const { conversationTitle, messageCount, conversationUrl, previews, recipientIsGuest } =
      this.options
    const headline =
      messageCount === 1
        ? `You have a new message about "${conversationTitle}".`
        : `You have ${messageCount} new messages about "${conversationTitle}".`
    const action = recipientIsGuest
      ? 'Create or sign in to your MakeXYZ account with this email address to read and reply:'
      : 'Read and reply on MakeXYZ:'

    this.message.to(this.email)
    this.message.header('Auto-Submitted', 'auto-generated')

    this.message.text(
      [
        headline,
        ...(previews ?? []).flatMap((preview) => ['', `${preview.from}:`, preview.body]),
        '',
        action,
        conversationUrl ?? '',
        '',
        "Please don't reply to this email - replies aren't delivered.",
      ].join('\n')
    )
    this.message.html(
      [
        `<p>${escapeHtml(headline)}</p>`,
        ...(previews ?? []).map(
          (preview) =>
            `<p><strong>${escapeHtml(preview.from)}:</strong><br>${escapeHtml(preview.body).replaceAll('\n', '<br>')}</p>`
        ),
        conversationUrl
          ? `<p>${escapeHtml(action)} <a href="${escapeHtml(conversationUrl)}">Open the conversation</a></p>`
          : `<p>${escapeHtml(action)}</p>`,
        "<p>Please don't reply to this email - replies aren't delivered.</p>",
      ].join('\n')
    )
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
