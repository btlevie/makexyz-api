/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
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
    }
    quotes: {
      store: typeof routes['projects.quotes.store']
    }
    projects: {
      captureEmail: typeof routes['projects.projects.capture_email']
    }
  }
}
