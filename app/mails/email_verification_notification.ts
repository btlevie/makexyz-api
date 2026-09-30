import { BaseMail } from '@adonisjs/mail'

/**
 * Sent after signup (and on request) so the account holder can prove they own
 * the address - see email_verification_service.ts. A verified email is
 * required before a customer can message vendors.
 */
export default class EmailVerificationNotification extends BaseMail {
  subject = 'Confirm your MakeXYZ email address'

  constructor(
    private email: string,
    private verifyUrl: string
  ) {
    super()
  }

  prepare() {
    this.message.to(this.email)
    this.message.text(
      [
        'Please confirm this is your email address for MakeXYZ.',
        '',
        'Sign in and open this link within 24 hours:',
        '',
        this.verifyUrl,
        '',
        "If you didn't create a MakeXYZ account, you can ignore this email.",
      ].join('\n')
    )
    this.message.html(
      [
        '<p>Please confirm this is your email address for MakeXYZ.</p>',
        '<p>Sign in and open this link within 24 hours:</p>',
        `<p><a href="${escapeHtml(this.verifyUrl)}">Confirm my email address</a></p>`,
        "<p>If you didn't create a MakeXYZ account, you can ignore this email.</p>",
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
