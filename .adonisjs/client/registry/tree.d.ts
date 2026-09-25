/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  eventStream: typeof routes['event_stream']
  subscribe: typeof routes['subscribe']
  unsubscribe: typeof routes['unsubscribe']
  auth: {
    newAccount: {
      store: typeof routes['auth.new_account.store']
    }
    accessTokens: {
      store: typeof routes['auth.access_tokens.store']
    }
    newCustomer: {
      store: typeof routes['auth.new_customer.store']
    }
    invitations: {
      show: typeof routes['auth.invitations.show']
      accept: typeof routes['auth.invitations.accept']
    }
  }
  profile: {
    profile: {
      show: typeof routes['profile.profile.show']
    }
    accessTokens: {
      destroy: typeof routes['profile.access_tokens.destroy']
    }
    addresses: {
      index: typeof routes['profile.addresses.index']
      store: typeof routes['profile.addresses.store']
      show: typeof routes['profile.addresses.show']
      update: typeof routes['profile.addresses.update']
      destroy: typeof routes['profile.addresses.destroy']
    }
  }
  projects: {
    projectFiles: {
      storeInstantQuoteFiles: typeof routes['projects.project_files.store_instant_quote_files']
      updateTechnology: typeof routes['projects.project_files.update_technology']
      updateMaterial: typeof routes['projects.project_files.update_material']
      updateColor: typeof routes['projects.project_files.update_color']
      updateSlicingResult: typeof routes['projects.project_files.update_slicing_result']
      updateSlicingProgress: typeof routes['projects.project_files.update_slicing_progress']
      show: typeof routes['projects.project_files.show']
    }
    quotes: {
      store: typeof routes['projects.quotes.store']
      index: typeof routes['projects.quotes.index']
      configure: typeof routes['projects.quotes.configure']
      accept: typeof routes['projects.quotes.accept']
    }
    checkoutSessions: {
      store: typeof routes['projects.checkout_sessions.store']
      authorize: typeof routes['projects.checkout_sessions.authorize']
    }
    orders: {
      show: typeof routes['projects.orders.show']
    }
    projects: {
      captureEmail: typeof routes['projects.projects.capture_email']
    }
  }
  serviceableCountries: {
    index: typeof routes['serviceable_countries.index']
  }
  vendor: {
    vendorOrders: {
      index: typeof routes['vendor.vendor_orders.index']
      active: typeof routes['vendor.vendor_orders.active']
      accept: typeof routes['vendor.vendor_orders.accept']
      startProduction: typeof routes['vendor.vendor_orders.start_production']
      readyToShip: typeof routes['vendor.vendor_orders.ready_to_ship']
    }
    vendorShipments: {
      index: typeof routes['vendor.vendor_shipments.index']
      store: typeof routes['vendor.vendor_shipments.store']
      void: typeof routes['vendor.vendor_shipments.void']
    }
    vendorPayouts: {
      index: typeof routes['vendor.vendor_payouts.index']
    }
    vendorPayoutMethods: {
      show: typeof routes['vendor.vendor_payout_methods.show']
      startStripe: typeof routes['vendor.vendor_payout_methods.start_stripe']
      startPaypal: typeof routes['vendor.vendor_payout_methods.start_paypal']
      completePaypal: typeof routes['vendor.vendor_payout_methods.complete_paypal']
    }
    vendorAddresses: {
      index: typeof routes['vendor.vendor_addresses.index']
      store: typeof routes['vendor.vendor_addresses.store']
      show: typeof routes['vendor.vendor_addresses.show']
      update: typeof routes['vendor.vendor_addresses.update']
      destroy: typeof routes['vendor.vendor_addresses.destroy']
    }
    vendorOnboarding: {
      show: typeof routes['vendor.vendor_onboarding.show']
      updateProfile: typeof routes['vendor.vendor_onboarding.update_profile']
      setCapabilities: typeof routes['vendor.vendor_onboarding.set_capabilities']
      acceptAgreement: typeof routes['vendor.vendor_onboarding.accept_agreement']
      uploadTax: typeof routes['vendor.vendor_onboarding.upload_tax']
      submit: typeof routes['vendor.vendor_onboarding.submit']
    }
  }
  admin: {
    adminQuotes: {
      needsReview: typeof routes['admin.admin_quotes.needs_review']
      split: typeof routes['admin.admin_quotes.split']
    }
    adminVendorPayouts: {
      index: typeof routes['admin.admin_vendor_payouts.index']
      release: typeof routes['admin.admin_vendor_payouts.release']
      cancel: typeof routes['admin.admin_vendor_payouts.cancel']
      retry: typeof routes['admin.admin_vendor_payouts.retry']
      rates: typeof routes['admin.admin_vendor_payouts.rates']
      updateRates: typeof routes['admin.admin_vendor_payouts.update_rates']
      updateVendor: typeof routes['admin.admin_vendor_payouts.update_vendor']
    }
    adminInvitations: {
      index: typeof routes['admin.admin_invitations.index']
      store: typeof routes['admin.admin_invitations.store']
      resend: typeof routes['admin.admin_invitations.resend']
      revoke: typeof routes['admin.admin_invitations.revoke']
    }
    adminVendors: {
      index: typeof routes['admin.admin_vendors.index']
      show: typeof routes['admin.admin_vendors.show']
      reviewCapability: typeof routes['admin.admin_vendors.review_capability']
      taxDocument: typeof routes['admin.admin_vendors.tax_document']
      verifyTax: typeof routes['admin.admin_vendors.verify_tax']
      rejectTax: typeof routes['admin.admin_vendors.reject_tax']
      activate: typeof routes['admin.admin_vendors.activate']
      suspend: typeof routes['admin.admin_vendors.suspend']
      reinstate: typeof routes['admin.admin_vendors.reinstate']
    }
  }
  webhooks: {
    stripeWebhooks: typeof routes['webhooks.stripe_webhooks']
    paypalWebhooks: typeof routes['webhooks.paypal_webhooks']
    easypostWebhooks: typeof routes['webhooks.easypost_webhooks']
  }
}
