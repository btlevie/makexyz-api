import type { HttpContext } from '@adonisjs/core/http'
import { newCustomerValidator } from '#validators/new_customer'
import Customer from '#models/customer'
import User from '#models/user'
import CustomerTransformer from '#transformers/customer_transformer'
import string from '@adonisjs/core/helpers/string'

export default class NewCustomerController {
  async store({ request, serialize, auth }: HttpContext) {
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
    return serialize(CustomerTransformer.transform(customer))
  }
}
