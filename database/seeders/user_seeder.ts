import User from '#models/user'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import string from '@adonisjs/core/helpers/string'

export default class extends BaseSeeder {
  async run() {
    await User.updateOrCreateMany('email', [
      {
        email: 'ben@makexyz.com',
        password: 'password',
        fullName: 'Ben Levie',
        role: 'admin',
        uuid: string.uuid(),
      },
      {
        email: 'anson@makexyz.com',
        password: 'password',
        fullName: 'Anson Wing',
        role: 'admin',
        uuid: string.uuid(),
      },
    ])
  }
}
