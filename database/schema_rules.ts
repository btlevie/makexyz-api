import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  tables: {
    ['users']: {
      columns: {
        ['role']: {
          tsType: "'admin' | 'customer' | 'vendor'"
        }
      }
    },
    ['addresses']: {
      columns: {
        ['ownerType']: {
          tsType: "'customer' | 'vendor'"
        }
      }
    },
    ['projects']: {
      columns: {
        ['status']: {
          tsType: "'draft' | 'quoted' | 'awaiting_checkout' | 'ordered' | 'fulfilled' | 'cancelled'"
        }
      }
    },
    ['quotes']: {
      columns: {
        ['status']: {
          tsType: "'draft' | 'sent' | 'accepted' | 'rejected'"
        },
        ['generatedBy']: {
          tsType: "'system' | 'user'"
        }
      }
    },
    ['orders']: {
      columns: {
        ['status']: {
          tsType: "'pending' | 'paid' | 'open' | 'accepted' | 'rejected' | 'in_progress' | 'ready_to_ship' | 'shipped' | 'delivered' | 'refunded' | 'cancelled'"
        }
      }
    },
    ['checkout_sessions']: {
      columns: {
        ['status']: {
          tsType: "'active' | 'expired' | 'completed' | 'failed'"
        }
      }
    },
    ['payments']: {
      columns: {
        ['status']: {
          tsType: "'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'cancelled'"
        }
      }
    },
    ['vendor_payouts']: {
      columns: {
        ['status']: {
          tsType: "'pending' | 'paid' | 'failed' | 'processing'"
        }
      }
    },
    ['shipments']: {
      columns: {
        ['status']: {
          tsType: "'pending' | 'label_created' | 'shipped' | 'in_transit' | 'delivered' | 'cancelled'"
        }
      }
    },
  }
} satisfies SchemaRules
