/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'event_stream': {
    methods: ["GET","HEAD"],
    pattern: '/__transmit/events',
    tokens: [{"old":"/__transmit/events","type":0,"val":"__transmit","end":""},{"old":"/__transmit/events","type":0,"val":"events","end":""}],
    types: placeholder as Registry['event_stream']['types'],
  },
  'subscribe': {
    methods: ["POST"],
    pattern: '/__transmit/subscribe',
    tokens: [{"old":"/__transmit/subscribe","type":0,"val":"__transmit","end":""},{"old":"/__transmit/subscribe","type":0,"val":"subscribe","end":""}],
    types: placeholder as Registry['subscribe']['types'],
  },
  'unsubscribe': {
    methods: ["POST"],
    pattern: '/__transmit/unsubscribe',
    tokens: [{"old":"/__transmit/unsubscribe","type":0,"val":"__transmit","end":""},{"old":"/__transmit/unsubscribe","type":0,"val":"unsubscribe","end":""}],
    types: placeholder as Registry['unsubscribe']['types'],
  },
  'auth.new_account.store': {
    methods: ["POST"],
    pattern: '/v1/auth/signup',
    tokens: [{"old":"/v1/auth/signup","type":0,"val":"v1","end":""},{"old":"/v1/auth/signup","type":0,"val":"auth","end":""},{"old":"/v1/auth/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['auth.new_account.store']['types'],
  },
  'auth.access_tokens.store': {
    methods: ["POST"],
    pattern: '/v1/auth/login',
    tokens: [{"old":"/v1/auth/login","type":0,"val":"v1","end":""},{"old":"/v1/auth/login","type":0,"val":"auth","end":""},{"old":"/v1/auth/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['auth.access_tokens.store']['types'],
  },
  'auth.new_customer.store': {
    methods: ["POST"],
    pattern: '/v1/auth/new-customer',
    tokens: [{"old":"/v1/auth/new-customer","type":0,"val":"v1","end":""},{"old":"/v1/auth/new-customer","type":0,"val":"auth","end":""},{"old":"/v1/auth/new-customer","type":0,"val":"new-customer","end":""}],
    types: placeholder as Registry['auth.new_customer.store']['types'],
  },
  'auth.invitations.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/auth/invitations/:uuid',
    tokens: [{"old":"/v1/auth/invitations/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/auth/invitations/:uuid","type":0,"val":"auth","end":""},{"old":"/v1/auth/invitations/:uuid","type":0,"val":"invitations","end":""},{"old":"/v1/auth/invitations/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['auth.invitations.show']['types'],
  },
  'auth.invitations.accept': {
    methods: ["POST"],
    pattern: '/v1/auth/invitations/:uuid/accept',
    tokens: [{"old":"/v1/auth/invitations/:uuid/accept","type":0,"val":"v1","end":""},{"old":"/v1/auth/invitations/:uuid/accept","type":0,"val":"auth","end":""},{"old":"/v1/auth/invitations/:uuid/accept","type":0,"val":"invitations","end":""},{"old":"/v1/auth/invitations/:uuid/accept","type":1,"val":"uuid","end":""},{"old":"/v1/auth/invitations/:uuid/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['auth.invitations.accept']['types'],
  },
  'profile.profile.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/account/profile',
    tokens: [{"old":"/v1/account/profile","type":0,"val":"v1","end":""},{"old":"/v1/account/profile","type":0,"val":"account","end":""},{"old":"/v1/account/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['profile.profile.show']['types'],
  },
  'profile.access_tokens.destroy': {
    methods: ["POST"],
    pattern: '/v1/account/logout',
    tokens: [{"old":"/v1/account/logout","type":0,"val":"v1","end":""},{"old":"/v1/account/logout","type":0,"val":"account","end":""},{"old":"/v1/account/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['profile.access_tokens.destroy']['types'],
  },
  'profile.addresses.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/account/addresses',
    tokens: [{"old":"/v1/account/addresses","type":0,"val":"v1","end":""},{"old":"/v1/account/addresses","type":0,"val":"account","end":""},{"old":"/v1/account/addresses","type":0,"val":"addresses","end":""}],
    types: placeholder as Registry['profile.addresses.index']['types'],
  },
  'profile.addresses.store': {
    methods: ["POST"],
    pattern: '/v1/account/addresses',
    tokens: [{"old":"/v1/account/addresses","type":0,"val":"v1","end":""},{"old":"/v1/account/addresses","type":0,"val":"account","end":""},{"old":"/v1/account/addresses","type":0,"val":"addresses","end":""}],
    types: placeholder as Registry['profile.addresses.store']['types'],
  },
  'profile.addresses.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/account/addresses/:uuid',
    tokens: [{"old":"/v1/account/addresses/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/account/addresses/:uuid","type":0,"val":"account","end":""},{"old":"/v1/account/addresses/:uuid","type":0,"val":"addresses","end":""},{"old":"/v1/account/addresses/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['profile.addresses.show']['types'],
  },
  'profile.addresses.update': {
    methods: ["PATCH"],
    pattern: '/v1/account/addresses/:uuid',
    tokens: [{"old":"/v1/account/addresses/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/account/addresses/:uuid","type":0,"val":"account","end":""},{"old":"/v1/account/addresses/:uuid","type":0,"val":"addresses","end":""},{"old":"/v1/account/addresses/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['profile.addresses.update']['types'],
  },
  'profile.addresses.destroy': {
    methods: ["DELETE"],
    pattern: '/v1/account/addresses/:uuid',
    tokens: [{"old":"/v1/account/addresses/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/account/addresses/:uuid","type":0,"val":"account","end":""},{"old":"/v1/account/addresses/:uuid","type":0,"val":"addresses","end":""},{"old":"/v1/account/addresses/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['profile.addresses.destroy']['types'],
  },
  'projects.project_files.store_instant_quote_files': {
    methods: ["POST"],
    pattern: '/v1/projects/files',
    tokens: [{"old":"/v1/projects/files","type":0,"val":"v1","end":""},{"old":"/v1/projects/files","type":0,"val":"projects","end":""},{"old":"/v1/projects/files","type":0,"val":"files","end":""}],
    types: placeholder as Registry['projects.project_files.store_instant_quote_files']['types'],
  },
  'projects.project_files.update_technology': {
    methods: ["PATCH"],
    pattern: '/v1/projects/files/:uuid/technology',
    tokens: [{"old":"/v1/projects/files/:uuid/technology","type":0,"val":"v1","end":""},{"old":"/v1/projects/files/:uuid/technology","type":0,"val":"projects","end":""},{"old":"/v1/projects/files/:uuid/technology","type":0,"val":"files","end":""},{"old":"/v1/projects/files/:uuid/technology","type":1,"val":"uuid","end":""},{"old":"/v1/projects/files/:uuid/technology","type":0,"val":"technology","end":""}],
    types: placeholder as Registry['projects.project_files.update_technology']['types'],
  },
  'projects.project_files.update_material': {
    methods: ["PATCH"],
    pattern: '/v1/projects/files/:uuid/material',
    tokens: [{"old":"/v1/projects/files/:uuid/material","type":0,"val":"v1","end":""},{"old":"/v1/projects/files/:uuid/material","type":0,"val":"projects","end":""},{"old":"/v1/projects/files/:uuid/material","type":0,"val":"files","end":""},{"old":"/v1/projects/files/:uuid/material","type":1,"val":"uuid","end":""},{"old":"/v1/projects/files/:uuid/material","type":0,"val":"material","end":""}],
    types: placeholder as Registry['projects.project_files.update_material']['types'],
  },
  'projects.project_files.update_color': {
    methods: ["PATCH"],
    pattern: '/v1/projects/files/:uuid/color',
    tokens: [{"old":"/v1/projects/files/:uuid/color","type":0,"val":"v1","end":""},{"old":"/v1/projects/files/:uuid/color","type":0,"val":"projects","end":""},{"old":"/v1/projects/files/:uuid/color","type":0,"val":"files","end":""},{"old":"/v1/projects/files/:uuid/color","type":1,"val":"uuid","end":""},{"old":"/v1/projects/files/:uuid/color","type":0,"val":"color","end":""}],
    types: placeholder as Registry['projects.project_files.update_color']['types'],
  },
  'projects.project_files.update_slicing_result': {
    methods: ["PATCH"],
    pattern: '/v1/projects/files/:uuid/slicing-result',
    tokens: [{"old":"/v1/projects/files/:uuid/slicing-result","type":0,"val":"v1","end":""},{"old":"/v1/projects/files/:uuid/slicing-result","type":0,"val":"projects","end":""},{"old":"/v1/projects/files/:uuid/slicing-result","type":0,"val":"files","end":""},{"old":"/v1/projects/files/:uuid/slicing-result","type":1,"val":"uuid","end":""},{"old":"/v1/projects/files/:uuid/slicing-result","type":0,"val":"slicing-result","end":""}],
    types: placeholder as Registry['projects.project_files.update_slicing_result']['types'],
  },
  'projects.project_files.update_slicing_progress': {
    methods: ["PATCH"],
    pattern: '/v1/projects/files/:uuid/slicing-progress',
    tokens: [{"old":"/v1/projects/files/:uuid/slicing-progress","type":0,"val":"v1","end":""},{"old":"/v1/projects/files/:uuid/slicing-progress","type":0,"val":"projects","end":""},{"old":"/v1/projects/files/:uuid/slicing-progress","type":0,"val":"files","end":""},{"old":"/v1/projects/files/:uuid/slicing-progress","type":1,"val":"uuid","end":""},{"old":"/v1/projects/files/:uuid/slicing-progress","type":0,"val":"slicing-progress","end":""}],
    types: placeholder as Registry['projects.project_files.update_slicing_progress']['types'],
  },
  'projects.project_files.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/projects/files/:uuid',
    tokens: [{"old":"/v1/projects/files/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/projects/files/:uuid","type":0,"val":"projects","end":""},{"old":"/v1/projects/files/:uuid","type":0,"val":"files","end":""},{"old":"/v1/projects/files/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['projects.project_files.show']['types'],
  },
  'projects.quotes.store': {
    methods: ["POST"],
    pattern: '/v1/projects/:projectUuid/quotes',
    tokens: [{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"quotes","end":""}],
    types: placeholder as Registry['projects.quotes.store']['types'],
  },
  'projects.quotes.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/projects/:projectUuid/quotes',
    tokens: [{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"quotes","end":""}],
    types: placeholder as Registry['projects.quotes.index']['types'],
  },
  'projects.quotes.configure': {
    methods: ["PATCH"],
    pattern: '/v1/projects/:projectUuid/quotes/:uuid/configure',
    tokens: [{"old":"/v1/projects/:projectUuid/quotes/:uuid/configure","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/configure","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/configure","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/configure","type":0,"val":"quotes","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/configure","type":1,"val":"uuid","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/configure","type":0,"val":"configure","end":""}],
    types: placeholder as Registry['projects.quotes.configure']['types'],
  },
  'projects.quotes.accept': {
    methods: ["PATCH"],
    pattern: '/v1/projects/:projectUuid/quotes/:uuid/accept',
    tokens: [{"old":"/v1/projects/:projectUuid/quotes/:uuid/accept","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/accept","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/accept","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/accept","type":0,"val":"quotes","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/accept","type":1,"val":"uuid","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['projects.quotes.accept']['types'],
  },
  'projects.checkout_sessions.store': {
    methods: ["POST"],
    pattern: '/v1/projects/:projectUuid/quotes/:uuid/checkout',
    tokens: [{"old":"/v1/projects/:projectUuid/quotes/:uuid/checkout","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/checkout","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/checkout","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/checkout","type":0,"val":"quotes","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/checkout","type":1,"val":"uuid","end":""},{"old":"/v1/projects/:projectUuid/quotes/:uuid/checkout","type":0,"val":"checkout","end":""}],
    types: placeholder as Registry['projects.checkout_sessions.store']['types'],
  },
  'projects.checkout_sessions.authorize': {
    methods: ["PATCH"],
    pattern: '/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize',
    tokens: [{"old":"/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize","type":0,"val":"checkout-sessions","end":""},{"old":"/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize","type":1,"val":"uuid","end":""},{"old":"/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize","type":0,"val":"authorize","end":""}],
    types: placeholder as Registry['projects.checkout_sessions.authorize']['types'],
  },
  'projects.orders.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/projects/:projectUuid/order',
    tokens: [{"old":"/v1/projects/:projectUuid/order","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/order","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/order","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/order","type":0,"val":"order","end":""}],
    types: placeholder as Registry['projects.orders.show']['types'],
  },
  'projects.projects.capture_email': {
    methods: ["POST"],
    pattern: '/v1/projects/:projectUuid/email',
    tokens: [{"old":"/v1/projects/:projectUuid/email","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/email","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/email","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/email","type":0,"val":"email","end":""}],
    types: placeholder as Registry['projects.projects.capture_email']['types'],
  },
  'serviceable_countries.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/serviceable-countries',
    tokens: [{"old":"/v1/serviceable-countries","type":0,"val":"v1","end":""},{"old":"/v1/serviceable-countries","type":0,"val":"serviceable-countries","end":""}],
    types: placeholder as Registry['serviceable_countries.index']['types'],
  },
  'vendor.vendor_orders.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/orders',
    tokens: [{"old":"/v1/vendor/orders","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders","type":0,"val":"orders","end":""}],
    types: placeholder as Registry['vendor.vendor_orders.index']['types'],
  },
  'vendor.vendor_orders.active': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/orders/active',
    tokens: [{"old":"/v1/vendor/orders/active","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/active","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/active","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/active","type":0,"val":"active","end":""}],
    types: placeholder as Registry['vendor.vendor_orders.active']['types'],
  },
  'vendor.vendor_orders.accept': {
    methods: ["PATCH"],
    pattern: '/v1/vendor/orders/:uuid/accept',
    tokens: [{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":1,"val":"uuid","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['vendor.vendor_orders.accept']['types'],
  },
  'vendor.vendor_orders.start_production': {
    methods: ["PATCH"],
    pattern: '/v1/vendor/orders/:uuid/start-production',
    tokens: [{"old":"/v1/vendor/orders/:uuid/start-production","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/:uuid/start-production","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/:uuid/start-production","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/:uuid/start-production","type":1,"val":"uuid","end":""},{"old":"/v1/vendor/orders/:uuid/start-production","type":0,"val":"start-production","end":""}],
    types: placeholder as Registry['vendor.vendor_orders.start_production']['types'],
  },
  'vendor.vendor_orders.ready_to_ship': {
    methods: ["PATCH"],
    pattern: '/v1/vendor/orders/:uuid/ready-to-ship',
    tokens: [{"old":"/v1/vendor/orders/:uuid/ready-to-ship","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/:uuid/ready-to-ship","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/:uuid/ready-to-ship","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/:uuid/ready-to-ship","type":1,"val":"uuid","end":""},{"old":"/v1/vendor/orders/:uuid/ready-to-ship","type":0,"val":"ready-to-ship","end":""}],
    types: placeholder as Registry['vendor.vendor_orders.ready_to_ship']['types'],
  },
  'vendor.vendor_shipments.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/orders/:uuid/shipments',
    tokens: [{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":1,"val":"uuid","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"shipments","end":""}],
    types: placeholder as Registry['vendor.vendor_shipments.index']['types'],
  },
  'vendor.vendor_shipments.store': {
    methods: ["POST"],
    pattern: '/v1/vendor/orders/:uuid/shipments',
    tokens: [{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":1,"val":"uuid","end":""},{"old":"/v1/vendor/orders/:uuid/shipments","type":0,"val":"shipments","end":""}],
    types: placeholder as Registry['vendor.vendor_shipments.store']['types'],
  },
  'vendor.vendor_shipments.void': {
    methods: ["POST"],
    pattern: '/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void',
    tokens: [{"old":"/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void","type":1,"val":"uuid","end":""},{"old":"/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void","type":0,"val":"shipments","end":""},{"old":"/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void","type":1,"val":"shipmentUuid","end":""},{"old":"/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void","type":0,"val":"void","end":""}],
    types: placeholder as Registry['vendor.vendor_shipments.void']['types'],
  },
  'vendor.vendor_payouts.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/payouts',
    tokens: [{"old":"/v1/vendor/payouts","type":0,"val":"v1","end":""},{"old":"/v1/vendor/payouts","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/payouts","type":0,"val":"payouts","end":""}],
    types: placeholder as Registry['vendor.vendor_payouts.index']['types'],
  },
  'vendor.vendor_payout_methods.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/payout-method',
    tokens: [{"old":"/v1/vendor/payout-method","type":0,"val":"v1","end":""},{"old":"/v1/vendor/payout-method","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/payout-method","type":0,"val":"payout-method","end":""}],
    types: placeholder as Registry['vendor.vendor_payout_methods.show']['types'],
  },
  'vendor.vendor_payout_methods.start_stripe': {
    methods: ["POST"],
    pattern: '/v1/vendor/payout-method/stripe/onboarding',
    tokens: [{"old":"/v1/vendor/payout-method/stripe/onboarding","type":0,"val":"v1","end":""},{"old":"/v1/vendor/payout-method/stripe/onboarding","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/payout-method/stripe/onboarding","type":0,"val":"payout-method","end":""},{"old":"/v1/vendor/payout-method/stripe/onboarding","type":0,"val":"stripe","end":""},{"old":"/v1/vendor/payout-method/stripe/onboarding","type":0,"val":"onboarding","end":""}],
    types: placeholder as Registry['vendor.vendor_payout_methods.start_stripe']['types'],
  },
  'vendor.vendor_payout_methods.start_paypal': {
    methods: ["POST"],
    pattern: '/v1/vendor/payout-method/paypal/connect',
    tokens: [{"old":"/v1/vendor/payout-method/paypal/connect","type":0,"val":"v1","end":""},{"old":"/v1/vendor/payout-method/paypal/connect","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/payout-method/paypal/connect","type":0,"val":"payout-method","end":""},{"old":"/v1/vendor/payout-method/paypal/connect","type":0,"val":"paypal","end":""},{"old":"/v1/vendor/payout-method/paypal/connect","type":0,"val":"connect","end":""}],
    types: placeholder as Registry['vendor.vendor_payout_methods.start_paypal']['types'],
  },
  'vendor.vendor_payout_methods.complete_paypal': {
    methods: ["POST"],
    pattern: '/v1/vendor/payout-method/paypal/callback',
    tokens: [{"old":"/v1/vendor/payout-method/paypal/callback","type":0,"val":"v1","end":""},{"old":"/v1/vendor/payout-method/paypal/callback","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/payout-method/paypal/callback","type":0,"val":"payout-method","end":""},{"old":"/v1/vendor/payout-method/paypal/callback","type":0,"val":"paypal","end":""},{"old":"/v1/vendor/payout-method/paypal/callback","type":0,"val":"callback","end":""}],
    types: placeholder as Registry['vendor.vendor_payout_methods.complete_paypal']['types'],
  },
  'vendor.vendor_addresses.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/addresses',
    tokens: [{"old":"/v1/vendor/addresses","type":0,"val":"v1","end":""},{"old":"/v1/vendor/addresses","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/addresses","type":0,"val":"addresses","end":""}],
    types: placeholder as Registry['vendor.vendor_addresses.index']['types'],
  },
  'vendor.vendor_addresses.store': {
    methods: ["POST"],
    pattern: '/v1/vendor/addresses',
    tokens: [{"old":"/v1/vendor/addresses","type":0,"val":"v1","end":""},{"old":"/v1/vendor/addresses","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/addresses","type":0,"val":"addresses","end":""}],
    types: placeholder as Registry['vendor.vendor_addresses.store']['types'],
  },
  'vendor.vendor_addresses.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/addresses/:uuid',
    tokens: [{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"addresses","end":""},{"old":"/v1/vendor/addresses/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['vendor.vendor_addresses.show']['types'],
  },
  'vendor.vendor_addresses.update': {
    methods: ["PATCH"],
    pattern: '/v1/vendor/addresses/:uuid',
    tokens: [{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"addresses","end":""},{"old":"/v1/vendor/addresses/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['vendor.vendor_addresses.update']['types'],
  },
  'vendor.vendor_addresses.destroy': {
    methods: ["DELETE"],
    pattern: '/v1/vendor/addresses/:uuid',
    tokens: [{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/addresses/:uuid","type":0,"val":"addresses","end":""},{"old":"/v1/vendor/addresses/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['vendor.vendor_addresses.destroy']['types'],
  },
  'vendor.vendor_onboarding.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/vendor/onboarding',
    tokens: [{"old":"/v1/vendor/onboarding","type":0,"val":"v1","end":""},{"old":"/v1/vendor/onboarding","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/onboarding","type":0,"val":"onboarding","end":""}],
    types: placeholder as Registry['vendor.vendor_onboarding.show']['types'],
  },
  'vendor.vendor_onboarding.update_profile': {
    methods: ["PATCH"],
    pattern: '/v1/vendor/onboarding/profile',
    tokens: [{"old":"/v1/vendor/onboarding/profile","type":0,"val":"v1","end":""},{"old":"/v1/vendor/onboarding/profile","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/onboarding/profile","type":0,"val":"onboarding","end":""},{"old":"/v1/vendor/onboarding/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['vendor.vendor_onboarding.update_profile']['types'],
  },
  'vendor.vendor_onboarding.set_capabilities': {
    methods: ["PUT"],
    pattern: '/v1/vendor/onboarding/capabilities',
    tokens: [{"old":"/v1/vendor/onboarding/capabilities","type":0,"val":"v1","end":""},{"old":"/v1/vendor/onboarding/capabilities","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/onboarding/capabilities","type":0,"val":"onboarding","end":""},{"old":"/v1/vendor/onboarding/capabilities","type":0,"val":"capabilities","end":""}],
    types: placeholder as Registry['vendor.vendor_onboarding.set_capabilities']['types'],
  },
  'vendor.vendor_onboarding.accept_agreement': {
    methods: ["POST"],
    pattern: '/v1/vendor/onboarding/agreement',
    tokens: [{"old":"/v1/vendor/onboarding/agreement","type":0,"val":"v1","end":""},{"old":"/v1/vendor/onboarding/agreement","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/onboarding/agreement","type":0,"val":"onboarding","end":""},{"old":"/v1/vendor/onboarding/agreement","type":0,"val":"agreement","end":""}],
    types: placeholder as Registry['vendor.vendor_onboarding.accept_agreement']['types'],
  },
  'vendor.vendor_onboarding.upload_tax': {
    methods: ["PUT"],
    pattern: '/v1/vendor/onboarding/tax',
    tokens: [{"old":"/v1/vendor/onboarding/tax","type":0,"val":"v1","end":""},{"old":"/v1/vendor/onboarding/tax","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/onboarding/tax","type":0,"val":"onboarding","end":""},{"old":"/v1/vendor/onboarding/tax","type":0,"val":"tax","end":""}],
    types: placeholder as Registry['vendor.vendor_onboarding.upload_tax']['types'],
  },
  'vendor.vendor_onboarding.submit': {
    methods: ["POST"],
    pattern: '/v1/vendor/onboarding/submit',
    tokens: [{"old":"/v1/vendor/onboarding/submit","type":0,"val":"v1","end":""},{"old":"/v1/vendor/onboarding/submit","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/onboarding/submit","type":0,"val":"onboarding","end":""},{"old":"/v1/vendor/onboarding/submit","type":0,"val":"submit","end":""}],
    types: placeholder as Registry['vendor.vendor_onboarding.submit']['types'],
  },
  'admin.admin_quotes.needs_review': {
    methods: ["GET","HEAD"],
    pattern: '/v1/admin/quotes/needs-review',
    tokens: [{"old":"/v1/admin/quotes/needs-review","type":0,"val":"v1","end":""},{"old":"/v1/admin/quotes/needs-review","type":0,"val":"admin","end":""},{"old":"/v1/admin/quotes/needs-review","type":0,"val":"quotes","end":""},{"old":"/v1/admin/quotes/needs-review","type":0,"val":"needs-review","end":""}],
    types: placeholder as Registry['admin.admin_quotes.needs_review']['types'],
  },
  'admin.admin_quotes.split': {
    methods: ["POST"],
    pattern: '/v1/admin/quotes/:uuid/split',
    tokens: [{"old":"/v1/admin/quotes/:uuid/split","type":0,"val":"v1","end":""},{"old":"/v1/admin/quotes/:uuid/split","type":0,"val":"admin","end":""},{"old":"/v1/admin/quotes/:uuid/split","type":0,"val":"quotes","end":""},{"old":"/v1/admin/quotes/:uuid/split","type":1,"val":"uuid","end":""},{"old":"/v1/admin/quotes/:uuid/split","type":0,"val":"split","end":""}],
    types: placeholder as Registry['admin.admin_quotes.split']['types'],
  },
  'admin.admin_vendor_payouts.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/admin/payouts',
    tokens: [{"old":"/v1/admin/payouts","type":0,"val":"v1","end":""},{"old":"/v1/admin/payouts","type":0,"val":"admin","end":""},{"old":"/v1/admin/payouts","type":0,"val":"payouts","end":""}],
    types: placeholder as Registry['admin.admin_vendor_payouts.index']['types'],
  },
  'admin.admin_vendor_payouts.release': {
    methods: ["POST"],
    pattern: '/v1/admin/payouts/:uuid/release',
    tokens: [{"old":"/v1/admin/payouts/:uuid/release","type":0,"val":"v1","end":""},{"old":"/v1/admin/payouts/:uuid/release","type":0,"val":"admin","end":""},{"old":"/v1/admin/payouts/:uuid/release","type":0,"val":"payouts","end":""},{"old":"/v1/admin/payouts/:uuid/release","type":1,"val":"uuid","end":""},{"old":"/v1/admin/payouts/:uuid/release","type":0,"val":"release","end":""}],
    types: placeholder as Registry['admin.admin_vendor_payouts.release']['types'],
  },
  'admin.admin_vendor_payouts.cancel': {
    methods: ["POST"],
    pattern: '/v1/admin/payouts/:uuid/cancel',
    tokens: [{"old":"/v1/admin/payouts/:uuid/cancel","type":0,"val":"v1","end":""},{"old":"/v1/admin/payouts/:uuid/cancel","type":0,"val":"admin","end":""},{"old":"/v1/admin/payouts/:uuid/cancel","type":0,"val":"payouts","end":""},{"old":"/v1/admin/payouts/:uuid/cancel","type":1,"val":"uuid","end":""},{"old":"/v1/admin/payouts/:uuid/cancel","type":0,"val":"cancel","end":""}],
    types: placeholder as Registry['admin.admin_vendor_payouts.cancel']['types'],
  },
  'admin.admin_vendor_payouts.retry': {
    methods: ["POST"],
    pattern: '/v1/admin/payouts/:uuid/retry',
    tokens: [{"old":"/v1/admin/payouts/:uuid/retry","type":0,"val":"v1","end":""},{"old":"/v1/admin/payouts/:uuid/retry","type":0,"val":"admin","end":""},{"old":"/v1/admin/payouts/:uuid/retry","type":0,"val":"payouts","end":""},{"old":"/v1/admin/payouts/:uuid/retry","type":1,"val":"uuid","end":""},{"old":"/v1/admin/payouts/:uuid/retry","type":0,"val":"retry","end":""}],
    types: placeholder as Registry['admin.admin_vendor_payouts.retry']['types'],
  },
  'admin.admin_vendor_payouts.rates': {
    methods: ["GET","HEAD"],
    pattern: '/v1/admin/vendors/:uuid/payout-rates',
    tokens: [{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"payout-rates","end":""}],
    types: placeholder as Registry['admin.admin_vendor_payouts.rates']['types'],
  },
  'admin.admin_vendor_payouts.update_rates': {
    methods: ["PUT"],
    pattern: '/v1/admin/vendors/:uuid/payout-rates',
    tokens: [{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/payout-rates","type":0,"val":"payout-rates","end":""}],
    types: placeholder as Registry['admin.admin_vendor_payouts.update_rates']['types'],
  },
  'admin.admin_vendor_payouts.update_vendor': {
    methods: ["PATCH"],
    pattern: '/v1/admin/vendors/:uuid',
    tokens: [{"old":"/v1/admin/vendors/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['admin.admin_vendor_payouts.update_vendor']['types'],
  },
  'admin.admin_invitations.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/admin/invitations',
    tokens: [{"old":"/v1/admin/invitations","type":0,"val":"v1","end":""},{"old":"/v1/admin/invitations","type":0,"val":"admin","end":""},{"old":"/v1/admin/invitations","type":0,"val":"invitations","end":""}],
    types: placeholder as Registry['admin.admin_invitations.index']['types'],
  },
  'admin.admin_invitations.store': {
    methods: ["POST"],
    pattern: '/v1/admin/invitations',
    tokens: [{"old":"/v1/admin/invitations","type":0,"val":"v1","end":""},{"old":"/v1/admin/invitations","type":0,"val":"admin","end":""},{"old":"/v1/admin/invitations","type":0,"val":"invitations","end":""}],
    types: placeholder as Registry['admin.admin_invitations.store']['types'],
  },
  'admin.admin_invitations.resend': {
    methods: ["POST"],
    pattern: '/v1/admin/invitations/:uuid/resend',
    tokens: [{"old":"/v1/admin/invitations/:uuid/resend","type":0,"val":"v1","end":""},{"old":"/v1/admin/invitations/:uuid/resend","type":0,"val":"admin","end":""},{"old":"/v1/admin/invitations/:uuid/resend","type":0,"val":"invitations","end":""},{"old":"/v1/admin/invitations/:uuid/resend","type":1,"val":"uuid","end":""},{"old":"/v1/admin/invitations/:uuid/resend","type":0,"val":"resend","end":""}],
    types: placeholder as Registry['admin.admin_invitations.resend']['types'],
  },
  'admin.admin_invitations.revoke': {
    methods: ["POST"],
    pattern: '/v1/admin/invitations/:uuid/revoke',
    tokens: [{"old":"/v1/admin/invitations/:uuid/revoke","type":0,"val":"v1","end":""},{"old":"/v1/admin/invitations/:uuid/revoke","type":0,"val":"admin","end":""},{"old":"/v1/admin/invitations/:uuid/revoke","type":0,"val":"invitations","end":""},{"old":"/v1/admin/invitations/:uuid/revoke","type":1,"val":"uuid","end":""},{"old":"/v1/admin/invitations/:uuid/revoke","type":0,"val":"revoke","end":""}],
    types: placeholder as Registry['admin.admin_invitations.revoke']['types'],
  },
  'admin.admin_vendors.index': {
    methods: ["GET","HEAD"],
    pattern: '/v1/admin/vendors',
    tokens: [{"old":"/v1/admin/vendors","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors","type":0,"val":"vendors","end":""}],
    types: placeholder as Registry['admin.admin_vendors.index']['types'],
  },
  'admin.admin_vendors.show': {
    methods: ["GET","HEAD"],
    pattern: '/v1/admin/vendors/:uuid',
    tokens: [{"old":"/v1/admin/vendors/:uuid","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid","type":1,"val":"uuid","end":""}],
    types: placeholder as Registry['admin.admin_vendors.show']['types'],
  },
  'admin.admin_vendors.review_capability': {
    methods: ["PATCH"],
    pattern: '/v1/admin/vendors/:uuid/capabilities/:technology',
    tokens: [{"old":"/v1/admin/vendors/:uuid/capabilities/:technology","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/capabilities/:technology","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/capabilities/:technology","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/capabilities/:technology","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/capabilities/:technology","type":0,"val":"capabilities","end":""},{"old":"/v1/admin/vendors/:uuid/capabilities/:technology","type":1,"val":"technology","end":""}],
    types: placeholder as Registry['admin.admin_vendors.review_capability']['types'],
  },
  'admin.admin_vendors.tax_document': {
    methods: ["GET","HEAD"],
    pattern: '/v1/admin/vendors/:uuid/tax/document',
    tokens: [{"old":"/v1/admin/vendors/:uuid/tax/document","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/tax/document","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/tax/document","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/tax/document","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/tax/document","type":0,"val":"tax","end":""},{"old":"/v1/admin/vendors/:uuid/tax/document","type":0,"val":"document","end":""}],
    types: placeholder as Registry['admin.admin_vendors.tax_document']['types'],
  },
  'admin.admin_vendors.verify_tax': {
    methods: ["POST"],
    pattern: '/v1/admin/vendors/:uuid/tax/verify',
    tokens: [{"old":"/v1/admin/vendors/:uuid/tax/verify","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/tax/verify","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/tax/verify","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/tax/verify","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/tax/verify","type":0,"val":"tax","end":""},{"old":"/v1/admin/vendors/:uuid/tax/verify","type":0,"val":"verify","end":""}],
    types: placeholder as Registry['admin.admin_vendors.verify_tax']['types'],
  },
  'admin.admin_vendors.reject_tax': {
    methods: ["POST"],
    pattern: '/v1/admin/vendors/:uuid/tax/reject',
    tokens: [{"old":"/v1/admin/vendors/:uuid/tax/reject","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/tax/reject","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/tax/reject","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/tax/reject","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/tax/reject","type":0,"val":"tax","end":""},{"old":"/v1/admin/vendors/:uuid/tax/reject","type":0,"val":"reject","end":""}],
    types: placeholder as Registry['admin.admin_vendors.reject_tax']['types'],
  },
  'admin.admin_vendors.activate': {
    methods: ["POST"],
    pattern: '/v1/admin/vendors/:uuid/activate',
    tokens: [{"old":"/v1/admin/vendors/:uuid/activate","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/activate","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/activate","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/activate","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/activate","type":0,"val":"activate","end":""}],
    types: placeholder as Registry['admin.admin_vendors.activate']['types'],
  },
  'admin.admin_vendors.suspend': {
    methods: ["POST"],
    pattern: '/v1/admin/vendors/:uuid/suspend',
    tokens: [{"old":"/v1/admin/vendors/:uuid/suspend","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/suspend","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/suspend","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/suspend","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/suspend","type":0,"val":"suspend","end":""}],
    types: placeholder as Registry['admin.admin_vendors.suspend']['types'],
  },
  'admin.admin_vendors.reinstate': {
    methods: ["POST"],
    pattern: '/v1/admin/vendors/:uuid/reinstate',
    tokens: [{"old":"/v1/admin/vendors/:uuid/reinstate","type":0,"val":"v1","end":""},{"old":"/v1/admin/vendors/:uuid/reinstate","type":0,"val":"admin","end":""},{"old":"/v1/admin/vendors/:uuid/reinstate","type":0,"val":"vendors","end":""},{"old":"/v1/admin/vendors/:uuid/reinstate","type":1,"val":"uuid","end":""},{"old":"/v1/admin/vendors/:uuid/reinstate","type":0,"val":"reinstate","end":""}],
    types: placeholder as Registry['admin.admin_vendors.reinstate']['types'],
  },
  'webhooks.stripe_webhooks': {
    methods: ["POST"],
    pattern: '/v1/webhooks/stripe',
    tokens: [{"old":"/v1/webhooks/stripe","type":0,"val":"v1","end":""},{"old":"/v1/webhooks/stripe","type":0,"val":"webhooks","end":""},{"old":"/v1/webhooks/stripe","type":0,"val":"stripe","end":""}],
    types: placeholder as Registry['webhooks.stripe_webhooks']['types'],
  },
  'webhooks.paypal_webhooks': {
    methods: ["POST"],
    pattern: '/v1/webhooks/paypal',
    tokens: [{"old":"/v1/webhooks/paypal","type":0,"val":"v1","end":""},{"old":"/v1/webhooks/paypal","type":0,"val":"webhooks","end":""},{"old":"/v1/webhooks/paypal","type":0,"val":"paypal","end":""}],
    types: placeholder as Registry['webhooks.paypal_webhooks']['types'],
  },
  'webhooks.easypost_webhooks': {
    methods: ["POST"],
    pattern: '/v1/webhooks/easypost',
    tokens: [{"old":"/v1/webhooks/easypost","type":0,"val":"v1","end":""},{"old":"/v1/webhooks/easypost","type":0,"val":"webhooks","end":""},{"old":"/v1/webhooks/easypost","type":0,"val":"easypost","end":""}],
    types: placeholder as Registry['webhooks.easypost_webhooks']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
