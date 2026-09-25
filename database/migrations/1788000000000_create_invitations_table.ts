import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'invitations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      // Stored trimmed + lowercased so lookups are case-insensitive.
      table.string('email', 254).notNullable().index()
      // The role the accepted user is created with - always taken from here,
      // never from the accept request.
      table.enum('role', ['admin', 'vendor']).notNullable()
      table
        .integer('invited_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // Status (pending/accepted/revoked/expired) is derived from these rather
      // than stored - see invitation_service.ts.
      table.timestamp('expires_at').notNullable()
      table.timestamp('accepted_at').nullable()
      table
        .integer('accepted_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('revoked_at').nullable()
      table.timestamp('last_sent_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
