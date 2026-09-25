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
          tsType: "'draft' | 'sent' | 'accepted' | 'rejected' | 'needs_review'",
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
        ['shipping_method']: {
          tsType: "'free' | 'ups_2day' | 'ups_overnight' | 'international_expedited'",
        },
        ['routing_stage']: {
          tsType: "'preferred' | 'open' | 'unfulfillable'",
        },
      },
    },
    ['vendor_technology_capabilities']: {
      columns: {
        ['technology']: {
          tsType: "'fdm' | 'sla' | 'sls'",
        },
        ['status']: {
          tsType: "'requested' | 'approved' | 'rejected'",
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
        ['provider']: {
          tsType: "'stripe' | 'paypal'",
        },
        ['status']: {
          tsType: "'pending' | 'held' | 'processing' | 'paid' | 'failed' | 'cancelled'",
        },
        ['hold_reason']: {
          tsType: "'partial_refund' | 'open_dispute' | 'payout_method_invalid' | 'manual'",
        },
        ['failure_kind']: {
          tsType: "'recipient' | 'platform'",
        },
      },
    },
    ['vendors']: {
      columns: {
        ['payout_provider']: {
          tsType: "'stripe' | 'paypal'",
        },
        ['status']: {
          tsType: "'onboarding' | 'pending_review' | 'active' | 'suspended'",
        },
        ['tax_classification']: {
          tsType:
            "'individual' | 'sole_prop' | 'c_corp' | 's_corp' | 'partnership' | 'llc' | 'foreign_individual' | 'foreign_entity'",
        },
      },
    },
    ['invitations']: {
      columns: {
        ['role']: {
          tsType: "'admin' | 'vendor'",
        },
      },
    },
    ['vendor_tax_documents']: {
      columns: {
        ['form_type']: {
          tsType: "'w9' | 'w8ben' | 'w8bene'",
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
    ['shipping_labels']: {
      columns: {
        ['provider']: {
          tsType: "'easypost'",
        },
        ['refund_status']: {
          tsType: "'submitted' | 'refunded' | 'rejected'",
        },
      },
    },
    ['refunds']: {
      columns: {
        ['provider']: {
          tsType: "'stripe' | 'paypal'",
        },
        ['status']: {
          tsType: "'pending' | 'succeeded' | 'failed'",
        },
      },
    },
    ['webhook_events']: {
      columns: {
        ['provider']: {
          tsType: "'stripe' | 'paypal' | 'easypost'",
        },
      },
    },
  },
} satisfies SchemaRules
