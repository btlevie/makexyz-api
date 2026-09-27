import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'

/**
 * Transactional mail only (account-claim links today). Campaign/marketing
 * email is a separate concern, deliberately not routed through here yet.
 */
const mailConfig = defineConfig({
  default: env.get('MAIL_MAILER'),

  from: {
    address: env.get('MAIL_FROM_ADDRESS'),
    name: env.get('MAIL_FROM_NAME'),
  },

  mailers: {
    /**
     * No credentials here on purpose: the SES client resolves them from the
     * default AWS chain (AWS_PROFILE locally, the ECS task role in
     * production), the same way the S3 and SQS clients do.
     */
    ses: transports.ses({
      region: env.get('AWS_REGION'),
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
