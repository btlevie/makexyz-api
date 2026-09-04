import env from '#start/env'
import { defineConfig, drivers } from '@adonisjs/queue'

export default defineConfig({
  default: env.get('QUEUE_DRIVER', 'database'),

  adapters: {
    database: drivers.database({
      // The generated default is 'primary', which is AdonisJS's stock
      // connection name - this app's connections are 'pg' and 'sqlite',
      // selected by DB_CONNECTION. Following the same env var keeps the queue
      // on whatever connection the app itself is using (pg in dev, sqlite in
      // tests) instead of a name Lucid has never registered.
      connectionName: env.get('DB_CONNECTION'),
    }),
    sync: drivers.sync(),
  },

  worker: {
    concurrency: 5,
    idleDelay: '2s',
  },

  locations: ['./app/jobs/**/*.{ts,js}'],
})
