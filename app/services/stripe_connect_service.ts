/**
 * Stripe Connect (Express) account onboarding for vendor payouts. The vendor
 * never supplies an account id - the server creates the account and stores
 * its `acct_...` id on the vendor (see vendor_payout_method_service.ts), so
 * a vendor can't point payouts at someone else's account.
 *
 * In test env this always resolves to the in-memory FakeStripeConnectClient,
 * same pattern as getPaymentGateway.
 */
import Stripe from 'stripe'
import env from '#start/env'

export class StripeConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripeConnectError'
  }
}

export interface StripeConnectClient {
  createExpressAccount(params: {
    email: string | null
    vendorUuid: string
  }): Promise<{ accountId: string }>
  /** A fresh, single-use onboarding link - Stripe's links are short-lived. */
  createOnboardingLink(accountId: string): Promise<string>
  retrieveAccount(accountId: string): Promise<{ payoutsEnabled: boolean }>
}

/** Real Stripe-backed client. Never exercised by tests. */
export class RealStripeConnectClient implements StripeConnectClient {
  private client: Stripe

  constructor() {
    const secretKey = env.get('STRIPE_SECRET_KEY')
    if (!secretKey) {
      throw new StripeConnectError('STRIPE_SECRET_KEY is not configured')
    }
    this.client = new Stripe(secretKey)
  }

  async createExpressAccount(params: {
    email: string | null
    vendorUuid: string
  }): Promise<{ accountId: string }> {
    const account = await this.client.accounts.create({
      type: 'express',
      country: 'US',
      email: params.email ?? undefined,
      capabilities: { transfers: { requested: true } },
      metadata: { vendorUuid: params.vendorUuid },
    })
    return { accountId: account.id }
  }

  async createOnboardingLink(accountId: string): Promise<string> {
    const returnUrl = env.get('VENDOR_PAYOUT_ONBOARDING_RETURN_URL')
    const refreshUrl = env.get('VENDOR_PAYOUT_ONBOARDING_REFRESH_URL')
    if (!returnUrl || !refreshUrl) {
      throw new StripeConnectError('Stripe onboarding return/refresh URLs are not configured')
    }
    const link = await this.client.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    })
    return link.url
  }

  async retrieveAccount(accountId: string): Promise<{ payoutsEnabled: boolean }> {
    const account = await this.client.accounts.retrieve(accountId)
    return { payoutsEnabled: account.payouts_enabled === true }
  }
}

/** In-memory stand-in used in test env. */
export class FakeStripeConnectClient implements StripeConnectClient {
  accounts = new Map<string, { payoutsEnabled: boolean; vendorUuid: string }>()
  private nextId = 1

  /** Test-only: clears all state between tests. */
  reset(): void {
    this.accounts.clear()
    this.nextId = 1
  }

  /** Test-only: simulates the vendor finishing onboarding (or Stripe restricting the account). */
  setPayoutsEnabled(accountId: string, payoutsEnabled: boolean): void {
    const account = this.accounts.get(accountId)
    if (!account) {
      throw new StripeConnectError(`Unknown account ${accountId}`)
    }
    account.payoutsEnabled = payoutsEnabled
  }

  async createExpressAccount(params: {
    email: string | null
    vendorUuid: string
  }): Promise<{ accountId: string }> {
    const accountId = `acct_fake_${this.nextId++}`
    this.accounts.set(accountId, { payoutsEnabled: false, vendorUuid: params.vendorUuid })
    return { accountId }
  }

  async createOnboardingLink(accountId: string): Promise<string> {
    if (!this.accounts.has(accountId)) {
      throw new StripeConnectError(`Unknown account ${accountId}`)
    }
    return `https://connect.stripe.test/onboarding/${accountId}`
  }

  async retrieveAccount(accountId: string): Promise<{ payoutsEnabled: boolean }> {
    const account = this.accounts.get(accountId)
    if (!account) {
      throw new StripeConnectError(`Unknown account ${accountId}`)
    }
    return { payoutsEnabled: account.payoutsEnabled }
  }
}

export const fakeStripeConnectClient = new FakeStripeConnectClient()

export function getStripeConnectClient(): StripeConnectClient {
  if (env.get('NODE_ENV') === 'test') {
    return fakeStripeConnectClient
  }
  return new RealStripeConnectClient()
}
