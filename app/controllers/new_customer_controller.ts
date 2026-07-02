import type { HttpContext } from '@adonisjs/core/http'
import { newCustomerValidator } from '#validators/new_customer'
import Customer from '#models/customer'
import User from '#models/user'
import CustomerTransformer from '#transformers/customer_transformer'
import hash from '@adonisjs/core/services/hash'
import string from '@adonisjs/core/helpers/string'

export default class NewCustomerController {
  async store({ request, serialize, auth }: HttpContext) {
    const { firstName, lastName, email, password } = await request.validateUsing(newCustomerValidator)

    const hashedPassword = await hash.make(password)

    const user = await User.create({ email, fullName: `${firstName} ${lastName}`, password: hashedPassword, role: 'customer', uuid: string.uuid() })

    const customer = await Customer.firstOrCreate({ userId: user.id }, { userId: user.id, firstName, lastName, uuid: string.uuid() })
    await auth.use('web').login(user)
    return serialize(CustomerTransformer.transform(customer))
  }
}
