/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import { instantQuoteThrottle } from '#start/limiter'

router.get('/', () => {
  return { hello: 'world' }
})

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
        router.post('new-customer', [controllers.NewCustomer, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())

    router
      .group(() => {
        // Public instant-quote entry point: upload -> price, no account needed.
        // Throttled because every call writes to S3 and invokes the slicing
        // Lambda. Anonymous callers receive a signed grant in the response,
        // which authorizes their follow-up requests.
        //
        // The manual-project flow will live at POST ':projectUuid/files'.
        router
          .post('files', [controllers.ProjectFiles, 'storeInstantQuoteFiles'])
          .use(instantQuoteThrottle)
        // Public: instant-quote customers are anonymous and authorize with their
        // project grant. Throttled because a technology change re-enqueues a
        // slicing job, so each call costs a Lambda invocation.
        router
          .patch('files/:uuid/technology', [controllers.ProjectFiles, 'updateTechnology'])
          .use(instantQuoteThrottle)
        // Public, same authorization as technology - no re-slice, so no extra
        // Lambda cost, but still throttled for consistency with the other
        // project-file mutation endpoints.
        router
          .patch('files/:uuid/material', [controllers.ProjectFiles, 'updateMaterial'])
          .use(instantQuoteThrottle)
        // Public, no pricing-lock check - color doesn't affect grams or price,
        // so it stays changeable any time before the order is placed.
        router
          .patch('files/:uuid/color', [controllers.ProjectFiles, 'updateColor'])
          .use(instantQuoteThrottle)
        router
          .patch('files/:uuid/slicing-result', [controllers.ProjectFiles, 'updateSlicingResult'])
          .use(middleware.slicerCallbackAuth())
        router.post(':projectUuid/quotes', [controllers.Quotes, 'store']).use(middleware.auth())
        // Public: instant-quote customers are anonymous and authorize with
        // their project grant, same as the file-mutation endpoints above.
        // Throttled since it calls out to the tax calculator.
        router
          .patch(':projectUuid/quotes/:uuid/configure', [controllers.Quotes, 'configure'])
          .use(instantQuoteThrottle)
        router
          .patch(':projectUuid/quotes/:uuid/accept', [controllers.Quotes, 'accept'])
          .use(instantQuoteThrottle)
        // Optional lead capture, offered after the price is shown. Public and
        // authorized by the project grant, so it is throttled too.
        router
          .post(':projectUuid/email', [controllers.Projects, 'captureEmail'])
          .use(instantQuoteThrottle)
      })
      .prefix('projects')
      .as('projects')

    // Public: feeds the checkout/quote-configuration address form's country
    // dropdown. Not project-scoped, so it lives outside the projects group.
    router.get('serviceable-countries', [controllers.ServiceableCountries, 'index'])
  })
  .prefix('/v1')
