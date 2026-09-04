/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
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
  'projects.quotes.store': {
    methods: ["POST"],
    pattern: '/v1/projects/:projectUuid/quotes',
    tokens: [{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/quotes","type":0,"val":"quotes","end":""}],
    types: placeholder as Registry['projects.quotes.store']['types'],
  },
  'projects.projects.capture_email': {
    methods: ["POST"],
    pattern: '/v1/projects/:projectUuid/email',
    tokens: [{"old":"/v1/projects/:projectUuid/email","type":0,"val":"v1","end":""},{"old":"/v1/projects/:projectUuid/email","type":0,"val":"projects","end":""},{"old":"/v1/projects/:projectUuid/email","type":1,"val":"projectUuid","end":""},{"old":"/v1/projects/:projectUuid/email","type":0,"val":"email","end":""}],
    types: placeholder as Registry['projects.projects.capture_email']['types'],
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
