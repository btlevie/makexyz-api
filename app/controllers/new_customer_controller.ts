import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { newCustomerValidator } from '#validators/new_customer'
import Customer from '#models/customer'
import Project from '#models/project'
import User from '#models/user'
import CustomerTransformer from '#transformers/customer_transformer'
import string from '@adonisjs/core/helpers/string'
import { readGrant } from '#services/project_grant_service'
import { claimProject, GuestClaimNotAllowedError } from '#services/customer_claim_service'
import { sendGuestClaimEmail } from '#services/guest_claim_service'

export default class NewCustomerController {
  /**
   * Creates a customer account and logs it in on the web guard.
   *
   * Guest work follows the new account two ways (see
   * customer_claim_service.ts): the instant-quote project whose grant this
   * request carries (x-project-grant - same browser) is attached right away,
   * and if earlier guest quotes/orders exist under this email, a signed link
   * to claim them is emailed to it. Neither can fail the signup.
   */
  async store(ctx: HttpContext) {
    const { request, serialize, auth } = ctx
    const { firstName, lastName, email, password } =
      await request.validateUsing(newCustomerValidator)

    const user = await User.create({
      email,
      fullName: `${firstName} ${lastName}`,
      password: password,
      role: 'customer',
      uuid: string.uuid(),
    })

    const customer = await Customer.firstOrCreate(
      { userId: user.id },
      { userId: user.id, firstName, lastName, uuid: string.uuid() }
    )
    await auth.use('web').login(user)

    await this.claimGrantedProject(ctx, customer)
    await sendGuestClaimEmail(user)

    return serialize(CustomerTransformer.transform(customer))
  }

  private async claimGrantedProject(ctx: HttpContext, customer: Customer) {
    const projectUuid = readGrant(ctx)
    if (!projectUuid) {
      return
    }

    const project = await Project.findBy('uuid', projectUuid)
    if (!project) {
      return
    }

    try {
      await db.transaction((trx) => claimProject(project, customer, trx))
    } catch (error) {
      // Another account's project - the grant proves the browser, not the
      // account, so it never moves an owned project. Signup still succeeds.
      if (error instanceof GuestClaimNotAllowedError) {
        logger.warn(
          { projectUuid, customerUuid: customer.uuid },
          'Signup grant named a project owned by another account'
        )
        return
      }
      throw error
    }
  }
}
