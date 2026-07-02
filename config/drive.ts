import env from '#start/env'
import { defineConfig, services } from '@adonisjs/drive'
import type { InferDriveDisks } from '@adonisjs/drive/types'

const driveConfig = defineConfig({
  default: 's3',

  services: {
    s3: services.s3({
      region: env.get('AWS_REGION'),
      bucket: env.get('S3_BUCKET'),
      visibility: 'private',
    }),
  },
})

export default driveConfig

declare module '@adonisjs/drive/types' {
  export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
