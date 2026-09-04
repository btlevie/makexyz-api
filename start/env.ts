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
  QUEUE_DRIVER: Env.schema.enum(['redis', 'database', 'sync'] as const)
})
