import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { dbAssertions } from '@adonisjs/lucid/plugins/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import type { Registry } from '../.adonisjs/client/registry/schema.d.ts'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */
declare module '@japa/api-client/types' {
  interface RoutesRegistry extends Registry {}
}

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  dbAssertions(app),
  apiClient(),
  sessionApiClient(app),
  authApiClient(app),
]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [
    /**
     * No test may ever reach SES. Signup sends a verification email, so any
     * spec that signs someone up would otherwise try a real send (and the
     * send is best-effort, so it wouldn't even fail loudly). Mail starts
     * faked, and `restore()` - which specs call in their own teardown - puts
     * a fresh fake back instead of the real mailer. Specs that assert on mail
     * still call `mail.fake()` themselves to get their own recorder.
     */
    async () => {
      const { default: mail } = await import('@adonisjs/mail/services/main')
      mail.fake()
      const restore = mail.restore.bind(mail)
      // fake() itself calls restore() first, so the re-fake must not re-enter.
      let restoring = false
      mail.restore = () => {
        if (restoring) {
          return restore()
        }
        restoring = true
        try {
          restore()
          mail.fake()
        } finally {
          restoring = false
        }
      }
    },
  ],
  teardown: [],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    suite.setup(() => testUtils.httpServer().start())
  }
}
