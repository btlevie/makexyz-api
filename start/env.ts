/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_CONNECTION: Env.schema.enum(['pg', 'mysql', 'sqlite', 'mssql', 'libsql'] as const),
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring file storage (AWS S3)
  |----------------------------------------------------------
  */
  AWS_REGION: Env.schema.string(),
  S3_BUCKET: Env.schema.string(),
  S3_FILE_STORAGE_KEY: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the drive package
  |----------------------------------------------------------
  */
  DRIVE_DISK: Env.schema.enum(['s3'] as const),

  /*
  |----------------------------------------------------------
  | Variables for the slicing microservice integration
  |----------------------------------------------------------
  | SQS_SLICING_QUEUE_URL is optional for now because the queue/Lambda
  | infra hasn't been provisioned yet - the SQS service no-ops until it's set.
  */
  SQS_SLICING_QUEUE_URL: Env.schema.string.optional(),
  SLICER_CALLBACK_SECRET: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the limiter package
  |----------------------------------------------------------
  */
  LIMITER_STORE: Env.schema.enum(['database', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Instant-quote rate limiting
  |----------------------------------------------------------
  | The instant-quote upload is public and costs money per call (an S3 write
  | plus a slicing Lambda invocation), so it is throttled per IP. Optional
  | with defaults in start/limiter.ts so a missing value can't disable the
  | limit outright.
  */
  INSTANT_QUOTE_RATE_LIMIT_REQUESTS: Env.schema.number.optional(),
  INSTANT_QUOTE_RATE_LIMIT_WINDOW: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Anonymous instant-quote grants and abandoned-project cleanup
  |----------------------------------------------------------
  */
  ANONYMOUS_GRANT_TTL: Env.schema.string.optional(),
  ANONYMOUS_PROJECT_TTL_DAYS: Env.schema.number.optional(),
  PROJECT_PURGE_GRACE_DAYS: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring @adonisjs/queue
  |----------------------------------------------------------
  */
  QUEUE_DRIVER: Env.schema.enum(['redis', 'database', 'sync'] as const),

  /*
  |----------------------------------------------------------
  | Payment/tax provider credentials
  |----------------------------------------------------------
  | All optional for now - no real Stripe/PayPal credentials exist yet.
  | getPaymentGateway/getTaxCalculator always resolve to their in-memory Fake
  | in test env regardless of these, so tests never need them either.
  */
  STRIPE_SECRET_KEY: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),
  PAYPAL_CLIENT_ID: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),
  PAYPAL_CLIENT_SECRET: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),
  PAYPAL_API_BASE_URL: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),

  /*
  |----------------------------------------------------------
  | Payment-provider webhook verification
  |----------------------------------------------------------
  | Unlike the gateway/tax-calculator credentials above, STRIPE_WEBHOOK_SECRET
  | is genuinely exercised in test env (see stripe_webhook_service.ts) - Stripe
  | signature verification is a local HMAC check, so tests use a real secret
  | rather than a Fake. PAYPAL_WEBHOOK_ID is only read by the real PayPal
  | verifier, which test env never uses (see paypal_webhook_service.ts).
  */
  STRIPE_WEBHOOK_SECRET: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),
  PAYPAL_WEBHOOK_ID: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),

  /*
  |----------------------------------------------------------
  | EasyPost (instant-quote shipping labels)
  |----------------------------------------------------------
  | Labels are bought on MakeXYZ's own EasyPost account. getShippingLabelGateway
  | always resolves to its in-memory Fake in test env, so EASYPOST_API_KEY is
  | never needed there. EASYPOST_WEBHOOK_SECRET *is* exercised in tests -
  | like Stripe's, EasyPost's signature check is a local HMAC (see
  | easypost_webhook_service.ts).
  */
  EASYPOST_API_KEY: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),
  EASYPOST_WEBHOOK_SECRET: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),

  /*
  |----------------------------------------------------------
  | MakeXYZ ship-from / return address
  |----------------------------------------------------------
  | Every instant-quote label ships from (and returns to) MakeXYZ, never the
  | vendor's own address - see config/shipping.ts. UPS requires an origin
  | phone number.
  */
  MAKEXYZ_SHIP_FROM_NAME: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  MAKEXYZ_SHIP_FROM_COMPANY: Env.schema.string.optional(),
  MAKEXYZ_SHIP_FROM_LINE1: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  MAKEXYZ_SHIP_FROM_LINE2: Env.schema.string.optional(),
  MAKEXYZ_SHIP_FROM_CITY: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  MAKEXYZ_SHIP_FROM_STATE: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  MAKEXYZ_SHIP_FROM_POSTAL_CODE: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  MAKEXYZ_SHIP_FROM_COUNTRY: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  MAKEXYZ_SHIP_FROM_PHONE: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  MAKEXYZ_SHIP_FROM_EMAIL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Vendor payouts
  |----------------------------------------------------------
  | Payouts go out on Stripe Connect (reusing STRIPE_SECRET_KEY) or PayPal
  | Payouts (reusing the PAYPAL_* credentials). The URLs are where each
  | provider sends the vendor back after onboarding - frontend pages, which
  | then call the matching /v1/vendor/payout-method endpoint. Test env fakes
  | both providers, so none of these are needed there.
  */
  PAYOUT_DEFAULT_HOLD_DAYS: Env.schema.number.optional(),
  VENDOR_PAYOUT_ONBOARDING_RETURN_URL: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  VENDOR_PAYOUT_ONBOARDING_REFRESH_URL: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  PAYPAL_OAUTH_REDIRECT_URL: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
  // https://www.sandbox.paypal.com or https://www.paypal.com
  PAYPAL_AUTHORIZE_BASE_URL: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),

  /*
  |----------------------------------------------------------
  | Vendor onboarding (see docs/VENDOR_ONBOARDING.md)
  |----------------------------------------------------------
  | ACCOUNT_INVITE_URL is the frontend page that handles invitation links
  | (admins get `${ACCOUNT_INVITE_URL}?link=<signed API path>`).
  | VENDOR_AGREEMENT_VERSION is the vendor agreement currently in force -
  | bumping it requires every vendor to re-accept before accepting orders.
  */
  ACCOUNT_INVITE_URL: Env.schema.string.optionalWhen(() => process.env.NODE_ENV !== 'production'),
  VENDOR_AGREEMENT_VERSION: Env.schema.string.optionalWhen(
    () => process.env.NODE_ENV !== 'production'
  ),
})
