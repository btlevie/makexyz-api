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
  'vendor.vendor_orders.accept': {
    methods: ["PATCH"],
    pattern: '/v1/vendor/orders/:uuid/accept',
    tokens: [{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"v1","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"vendor","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"orders","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":1,"val":"uuid","end":""},{"old":"/v1/vendor/orders/:uuid/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['vendor.vendor_orders.accept']['types'],
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
