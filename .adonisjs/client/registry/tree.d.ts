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
      configure: typeof routes['projects.quotes.configure']
      accept: typeof routes['projects.quotes.accept']
    }
    checkoutSessions: {
      store: typeof routes['projects.checkout_sessions.store']
      authorize: typeof routes['projects.checkout_sessions.authorize']
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
      accept: typeof routes['vendor.vendor_orders.accept']
    }
  }
}
