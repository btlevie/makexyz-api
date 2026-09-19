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
import transmit from '@adonisjs/transmit/services/main'
import { controllers } from '#generated/controllers'
import { instantQuoteThrottle } from '#start/limiter'

router.get('/', () => {
  return { hello: 'world' }
})

// __transmit/subscribe and __transmit/unsubscribe stay public - channel
// authorization (start/transmit.ts) does the real access check per-channel,
// the same grant/customer/staff pattern as the rest of this flow, so there's
// no additional route-level middleware to add here.
transmit.registerRoutes()

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

        // The customer's own saved-address book (personal/business/etc,
        // selectable during quote configuration - see QuotesController#configure).
        router.get('addresses', [controllers.Addresses, 'index'])
        router.post('addresses', [controllers.Addresses, 'store'])
        router.get('addresses/:uuid', [controllers.Addresses, 'show'])
        router.patch('addresses/:uuid', [controllers.Addresses, 'update'])
        router.delete('addresses/:uuid', [controllers.Addresses, 'destroy'])
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
        // Best-effort progress pings from the slicer, same auth as the
        // terminal slicing-result callback above.
        router
          .patch('files/:uuid/slicing-progress', [controllers.ProjectFiles, 'updateSlicingProgress'])
          .use(middleware.slicerCallbackAuth())
        // Public, same grant/customer/staff authorization as the other
        // project-file endpoints - lets a client recover current
        // status/progress with a plain GET after reconnecting. Not throttled:
        // unlike the mutation endpoints above, a read here costs no S3 write
        // or Lambda invocation.
        router.get('files/:uuid', [controllers.ProjectFiles, 'show'])
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
        // Public, same grant/customer/staff authorization as the quote
        // endpoints above. Throttled: authorize calls out to a payment
        // provider.
        router
          .post(':projectUuid/quotes/:uuid/checkout', [controllers.CheckoutSessions, 'store'])
          .use(instantQuoteThrottle)
        router
          .patch(':projectUuid/checkout-sessions/:uuid/authorize', [
            controllers.CheckoutSessions,
            'authorize',
          ])
          .use(instantQuoteThrottle)
        // Public, same grant/customer/staff authorization as the other
        // project endpoints - a receipt/status check after checkout. Not
        // throttled: a read costs no S3 write or Lambda invocation.
        router.get(':projectUuid/order', [controllers.Orders, 'show'])
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

    // Vendor-authenticated - middleware.auth() resolves the user, the
    // controller does the role/Vendor-record check (no policy/ability
    // convention exists yet in this codebase, see CLAUDE.md).
    router
      .group(() => {
        router.get('orders', [controllers.VendorOrders, 'index'])
        router.patch('orders/:uuid/accept', [controllers.VendorOrders, 'accept'])

        // The vendor's own saved-address book (e.g. return/pickup addresses).
        router.get('addresses', [controllers.VendorAddresses, 'index'])
        router.post('addresses', [controllers.VendorAddresses, 'store'])
        router.get('addresses/:uuid', [controllers.VendorAddresses, 'show'])
        router.patch('addresses/:uuid', [controllers.VendorAddresses, 'update'])
        router.delete('addresses/:uuid', [controllers.VendorAddresses, 'destroy'])
      })
      .prefix('vendor')
      .as('vendor')
      .use(middleware.auth())

    // Payment-provider webhooks - verified entirely by provider signature
    // (see stripe_webhook_service.ts / paypal_webhook_service.ts), not the
    // grant/customer/staff authorization used everywhere else in this file.
    // Not throttled: invalid-signature requests are cheap to reject, and
    // delivery volume is provider-controlled.
    router
      .group(() => {
        router.post('stripe', [controllers.StripeWebhooks, 'handle'])
        router.post('paypal', [controllers.PaypalWebhooks, 'handle'])
      })
      .prefix('webhooks')
      .as('webhooks')
  })
  .prefix('/v1')
