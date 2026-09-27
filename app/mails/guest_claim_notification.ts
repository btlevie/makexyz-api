import { BaseMail } from '@adonisjs/mail'

/**
 * Sent to a guest's email when an account is created with that same email -
 * the signed link is the proof that the account holder owns the address the
 * guest quotes/orders were placed under. See guest_claim_service.ts.
 */
export default class GuestClaimNotification extends BaseMail {
  subject = 'Link your past MakeXYZ quotes and orders to your account'

  constructor(
    private email: string,
    private claimUrl: string
  ) {
    super()
  }

  prepare() {
    this.message.to(this.email)
    this.message.text(
      [
        'You just created a MakeXYZ account with this email address.',
        '',
        'We found quotes or orders placed under this email before you had an account.',
        'To see them in your account, sign in and open this link within 24 hours:',
        '',
        this.claimUrl,
        '',
        "If you didn't create a MakeXYZ account, you can ignore this email - nothing is linked unless the link is opened while signed in to that account.",
      ].join('\n')
    )
    this.message.html(
      [
        '<p>You just created a MakeXYZ account with this email address.</p>',
        '<p>We found quotes or orders placed under this email before you had an account. To see them in your account, sign in and open this link within 24 hours:</p>',
        `<p><a href="${escapeHtml(this.claimUrl)}">Link my past quotes and orders</a></p>`,
        "<p>If you didn't create a MakeXYZ account, you can ignore this email - nothing is linked unless the link is opened while signed in to that account.</p>",
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
