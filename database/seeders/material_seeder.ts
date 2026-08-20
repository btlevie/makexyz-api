import Material from '#models/material'
import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class extends BaseSeeder {
  async run() {
    await Material.updateOrCreateMany('name', [{ name: 'PLA' }])
  }
}
