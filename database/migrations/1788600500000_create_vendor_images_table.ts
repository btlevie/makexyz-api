import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vendor_images'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('uuid').unique().notNullable()
      table
        .integer('vendor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('vendors')
        .onDelete('CASCADE')
      // One profile photo and up to 12 portfolio images (vendor_image_service.ts).
      table.enum('kind', ['profile', 'portfolio']).notNullable()
      // Uploads land in quarantine and are never served from there. Only an
      // approved image (malware-scanned, re-encoded without metadata, and
      // checked by Rekognition) is served, from storage_key / thumbnail_key.
      table.string('quarantine_key', 512).notNullable()
      table.string('storage_key', 512).nullable()
      table.string('thumbnail_key', 512).nullable()
      table.string('extname', 10).notNullable()
      table.integer('size_bytes').notNullable()
      table.integer('position').notNullable().defaultTo(0)
      // pending_upload: presigned URL issued. uploaded: queued for checks.
      // approved: public. rejected: failed a check (never served). review: a
      // person decides (no scanner verdict, or text in the image needs a look).
      table
        .enum('status', ['pending_upload', 'uploaded', 'approved', 'rejected', 'review'])
        .notNullable()
      table.string('reject_reason', 80).nullable()
      // Malware status, inspection findings, Rekognition labels, decoded text.
      table.json('moderation_details').nullable()
      table.timestamp('uploaded_at').nullable()
      table.timestamp('checked_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['vendor_id', 'kind', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
