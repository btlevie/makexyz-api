import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'message_reports'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table
        .integer('message_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('messages')
        .onDelete('CASCADE')
      table
        .integer('reporter_participant_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('conversation_participants')
        .onDelete('CASCADE')
      table
        .enum('reason', [
          'contact_sharing',
          'payment',
          'spam_ad',
          'scam',
          'harassment',
          'prohibited_item',
          'other',
        ])
        .notNullable()
      table.text('note').nullable()
      // The review case this report feeds - several reports on one message
      // share one open case.
      table
        .integer('case_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('moderation_cases')
        .onDelete('SET NULL')

      table.timestamp('created_at')

      // One report per message per participant.
      table.unique(['message_id', 'reporter_participant_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
