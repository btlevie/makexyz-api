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
      store: typeof routes['projects.project_files.store']
      updateSlicingResult: typeof routes['projects.project_files.update_slicing_result']
    }
  }
}
