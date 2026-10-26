import { BaseMail } from '@adonisjs/mail'

/**
 * A moderator's warning to a customer or vendor about their messages - sent
 * privately, since a system message in the thread would be seen by the other
 * participant too. See moderation_case_service.ts#warnCaseSubject.
 */
export default class ModerationWarningNotification extends BaseMail {
  subject = 'A note about your MakeXYZ messages'

  constructor(
    private email: string,
    private warning: string
  ) {
    super()
  }

  prepare() {
    this.message.to(this.email)
    this.message.text(
      [
        'Our moderation team reviewed a message you sent on MakeXYZ.',
        '',
        this.warning,
        '',
        'Messages on MakeXYZ must stay on the platform: no contact details, no payment outside MakeXYZ, no advertising, and nothing abusive. Repeated problems can limit your messaging.',
        '',
        'If you think this is a mistake, reply to MakeXYZ support.',
      ].join('\n')
    )
    this.message.html(
      [
        '<p>Our moderation team reviewed a message you sent on MakeXYZ.</p>',
        `<p>${escapeHtml(this.warning).replaceAll('\n', '<br>')}</p>`,
        '<p>Messages on MakeXYZ must stay on the platform: no contact details, no payment outside MakeXYZ, no advertising, and nothing abusive. Repeated problems can limit your messaging.</p>',
        '<p>If you think this is a mistake, reply to MakeXYZ support.</p>',
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
