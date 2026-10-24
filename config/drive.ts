import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, services } from '@adonisjs/drive'
import type { InferDriveDisks } from '@adonisjs/drive/types'

/**
 * drive.fake() in tests: the stock fake builds download URLs only; uploads
 * (message attachments) need one too. The fs driver calls
 * generateSignedUploadURL, though its option types don't list it.
 */
const fakeUrlBuilder = {
  async generateURL(key: string) {
    return `/drive/fakes/${key}`
  },
  async generateSignedURL(key: string) {
    return `/drive/fakes/signed/${key}`
  },
  async generateSignedUploadURL(key: string) {
    return `/drive/fakes/signed-upload/${key}`
  },
}

const driveConfig = defineConfig({
  default: 's3',

  services: {
    s3: services.s3({
      region: env.get('AWS_REGION'),
      bucket: env.get('S3_BUCKET'),
      visibility: 'private',
    }),
  },

  fakes: {
    // Same location the stock fake uses.
    location: app.tmpPath('drive-fakes'),
    urlBuilder: fakeUrlBuilder,
  },
})

export default driveConfig

declare module '@adonisjs/drive/types' {
  export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
