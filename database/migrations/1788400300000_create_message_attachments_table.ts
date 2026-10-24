import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'message_attachments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table
        .integer('conversation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('conversations')
        .onDelete('CASCADE')
      table
        .integer('uploaded_by_participant_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('conversation_participants')
        .onDelete('CASCADE')
      // Null until the file is sent with a message.
      table
        .integer('message_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('messages')
        .onDelete('CASCADE')
      table.string('file_name', 255).notNullable()
      table.string('extname', 10).notNullable()
      // Sniffed from the file's bytes, never taken from the client.
      table.string('content_type', 100).nullable()
      table.integer('size_bytes').notNullable()
      // Uploads land in a quarantine prefix the app never serves from; a file
      // is copied to storage_key only once it's clean.
      table.string('quarantine_key', 512).notNullable()
      table.string('storage_key', 512).nullable()
      // pending_upload: presigned URL issued. uploaded: client confirmed,
      // queued for scanning. clean: promoted, downloadable. rejected: failed
      // a check (never served). review: couldn't be checked automatically
      // (no scanner result) - a person decides.
      table
        .enum('status', ['pending_upload', 'uploaded', 'clean', 'rejected', 'review'])
        .notNullable()
      table.string('reject_reason', 80).nullable()
      // What the checks found: malware scan status, PDF findings, decoded
      // QR/PDF links (which go through the URL pipeline).
      table.json('scan_details').nullable()
      table.timestamp('uploaded_at').nullable()
      table.timestamp('scanned_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['message_id'])
      table.index(['conversation_id', 'uploaded_by_participant_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
