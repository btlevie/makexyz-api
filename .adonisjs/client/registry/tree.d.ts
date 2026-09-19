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
    vendorAddresses: {
      index: typeof routes['vendor.vendor_addresses.index']
      store: typeof routes['vendor.vendor_addresses.store']
      show: typeof routes['vendor.vendor_addresses.show']
      update: typeof routes['vendor.vendor_addresses.update']
      destroy: typeof routes['vendor.vendor_addresses.destroy']
    }
  }
  admin: {
    adminQuotes: {
      needsReview: typeof routes['admin.admin_quotes.needs_review']
      split: typeof routes['admin.admin_quotes.split']
    }
  }
  webhooks: {
    stripeWebhooks: typeof routes['webhooks.stripe_webhooks']
    paypalWebhooks: typeof routes['webhooks.paypal_webhooks']
  }
}
