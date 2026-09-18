import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  tables: {
    ['users']: {
      columns: {
        ['role']: {
          tsType: "'admin' | 'customer' | 'vendor'",
        },
      },
    },
    ['addresses']: {
      columns: {
        ['owner_type']: {
          tsType: "'customer' | 'vendor'",
        },
      },
    },
    ['projects']: {
      columns: {
        ['status']: {
          tsType:
            "'draft' | 'quoted' | 'awaiting_checkout' | 'ordered' | 'fulfilled' | 'cancelled' | 'expired'",
        },
        ['source']: {
          tsType: "'instant_quote' | 'manual'",
        },
      },
    },
    ['project_files']: {
      columns: {
        ['status']: {
          tsType: "'pending' | 'processing' | 'completed' | 'failed'",
        },
        ['technology']: {
          tsType: "'fdm' | 'sla' | 'sls'",
        },
      },
    },
    ['materials']: {
      columns: {
        ['technology']: {
          tsType: "'fdm' | 'sla' | 'sls'",
        },
      },
    },
    ['project_file_slice_variants']: {
      columns: {
        ['variant']: {
          tsType: "'baseline' | 'infill_probe' | 'layer_height_probe' | 'support_probe'",
        },
      },
    },
    ['pricing_configs']: {
      columns: {
        ['technology']: {
          tsType: "'fdm' | 'sla' | 'sls'",
        },
      },
    },
    ['quotes']: {
      columns: {
        ['status']: {
          tsType: "'draft' | 'sent' | 'accepted' | 'rejected'",
        },
        ['generated_by']: {
          tsType: "'system' | 'user'",
        },
        ['rejection_reason']: {
          tsType: "'abandoned' | 'declined'",
        },
        ['shipping_method']: {
          tsType: "'free' | 'ups_2day' | 'ups_overnight' | 'international_expedited'",
        },
      },
    },
    ['orders']: {
      columns: {
        ['status']: {
          tsType:
            "'pending' | 'paid' | 'open' | 'accepted' | 'rejected' | 'in_progress' | 'ready_to_ship' | 'shipped' | 'delivered' | 'refunded' | 'cancelled'",
        },
      },
    },
    ['checkout_sessions']: {
      columns: {
        ['status']: {
          tsType: "'active' | 'expired' | 'completed' | 'failed'",
        },
      },
    },
    ['payments']: {
      columns: {
        ['status']: {
          tsType: "'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'cancelled'",
        },
      },
    },
    ['vendor_payouts']: {
      columns: {
        ['status']: {
          tsType: "'pending' | 'paid' | 'failed' | 'processing'",
        },
      },
    },
    ['shipments']: {
      columns: {
        ['status']: {
          tsType:
            "'pending' | 'label_created' | 'shipped' | 'in_transit' | 'delivered' | 'cancelled'",
        },
      },
    },
  },
} satisfies SchemaRules
