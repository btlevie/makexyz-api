/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'event_stream': {
    methods: ["GET","HEAD"]
    pattern: '/__transmit/events'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subscribe': {
    methods: ["POST"]
    pattern: '/__transmit/subscribe'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'unsubscribe': {
    methods: ["POST"]
    pattern: '/__transmit/unsubscribe'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'auth.new_account.store': {
    methods: ["POST"]
    pattern: '/v1/auth/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.access_tokens.store': {
    methods: ["POST"]
    pattern: '/v1/auth/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.new_customer.store': {
    methods: ["POST"]
    pattern: '/v1/auth/new-customer'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/new_customer').newCustomerValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/new_customer').newCustomerValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_customer_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_customer_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.invitations.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/auth/invitations/:uuid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['show']>>>
    }
  }
  'auth.invitations.accept': {
    methods: ["POST"]
    pattern: '/v1/auth/invitations/:uuid/accept'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitation').acceptInvitationValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invitation').acceptInvitationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['accept']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'profile.profile.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/account/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
    }
  }
  'profile.access_tokens.destroy': {
    methods: ["POST"]
    pattern: '/v1/account/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
    }
  }
  'profile.addresses.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/account/addresses'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['index']>>>
    }
  }
  'profile.addresses.store': {
    methods: ["POST"]
    pattern: '/v1/account/addresses'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/address').createAddressValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/address').createAddressValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'profile.addresses.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/account/addresses/:uuid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['show']>>>
    }
  }
  'profile.addresses.update': {
    methods: ["PATCH"]
    pattern: '/v1/account/addresses/:uuid'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/address').updateAddressValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/address').updateAddressValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'profile.addresses.destroy': {
    methods: ["DELETE"]
    pattern: '/v1/account/addresses/:uuid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/addresses_controller').default['destroy']>>>
    }
  }
  'projects.project_files.store_instant_quote_files': {
    methods: ["POST"]
    pattern: '/v1/projects/files'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_file').uploadProjectFileValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/project_file').uploadProjectFileValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['storeInstantQuoteFiles']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['storeInstantQuoteFiles']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_files.update_technology': {
    methods: ["PATCH"]
    pattern: '/v1/projects/files/:uuid/technology'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_file').updateProjectFileTechnologyValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_file').updateProjectFileTechnologyValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateTechnology']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateTechnology']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_files.update_material': {
    methods: ["PATCH"]
    pattern: '/v1/projects/files/:uuid/material'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_file').updateProjectFileMaterialValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_file').updateProjectFileMaterialValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateMaterial']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateMaterial']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_files.update_color': {
    methods: ["PATCH"]
    pattern: '/v1/projects/files/:uuid/color'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_file').updateProjectFileColorValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_file').updateProjectFileColorValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateColor']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateColor']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_files.update_slicing_result': {
    methods: ["PATCH"]
    pattern: '/v1/projects/files/:uuid/slicing-result'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_file').sliceResultValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_file').sliceResultValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateSlicingResult']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateSlicingResult']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_files.update_slicing_progress': {
    methods: ["PATCH"]
    pattern: '/v1/projects/files/:uuid/slicing-progress'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_file').slicingProgressValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_file').slicingProgressValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateSlicingProgress']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['updateSlicingProgress']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_files.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/projects/files/:uuid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_files_controller').default['show']>>>
    }
  }
  'projects.quotes.store': {
    methods: ["POST"]
    pattern: '/v1/projects/:projectUuid/quotes'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/quote').createQuoteValidator)>>
      paramsTuple: [ParamValue]
      params: { projectUuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/quote').createQuoteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.quotes.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/projects/:projectUuid/quotes'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { projectUuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['index']>>>
    }
  }
  'projects.quotes.configure': {
    methods: ["PATCH"]
    pattern: '/v1/projects/:projectUuid/quotes/:uuid/configure'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/quote').configureQuoteValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { projectUuid: ParamValue; uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/quote').configureQuoteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['configure']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['configure']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.quotes.accept': {
    methods: ["PATCH"]
    pattern: '/v1/projects/:projectUuid/quotes/:uuid/accept'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { projectUuid: ParamValue; uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['accept']>>>
    }
  }
  'projects.checkout_sessions.store': {
    methods: ["POST"]
    pattern: '/v1/projects/:projectUuid/quotes/:uuid/checkout'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/checkout').createCheckoutSessionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { projectUuid: ParamValue; uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/checkout').createCheckoutSessionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/checkout_sessions_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/checkout_sessions_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.checkout_sessions.authorize': {
    methods: ["PATCH"]
    pattern: '/v1/projects/:projectUuid/checkout-sessions/:uuid/authorize'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/checkout').authorizeCheckoutSessionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { projectUuid: ParamValue; uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/checkout').authorizeCheckoutSessionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/checkout_sessions_controller').default['authorize']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/checkout_sessions_controller').default['authorize']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.orders.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/projects/:projectUuid/order'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { projectUuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/orders_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/orders_controller').default['show']>>>
    }
  }
  'projects.projects.capture_email': {
    methods: ["POST"]
    pattern: '/v1/projects/:projectUuid/email'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project').captureProjectEmailValidator)>>
      paramsTuple: [ParamValue]
      params: { projectUuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project').captureProjectEmailValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['captureEmail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['captureEmail']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'serviceable_countries.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/serviceable-countries'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/serviceable_countries_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/serviceable_countries_controller').default['index']>>>
    }
  }
  'vendor.vendor_orders.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/orders'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['index']>>>
    }
  }
  'vendor.vendor_orders.active': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/orders/active'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['active']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['active']>>>
    }
  }
  'vendor.vendor_orders.accept': {
    methods: ["PATCH"]
    pattern: '/v1/vendor/orders/:uuid/accept'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['accept']>>>
    }
  }
  'vendor.vendor_orders.start_production': {
    methods: ["PATCH"]
    pattern: '/v1/vendor/orders/:uuid/start-production'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['startProduction']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['startProduction']>>>
    }
  }
  'vendor.vendor_orders.ready_to_ship': {
    methods: ["PATCH"]
    pattern: '/v1/vendor/orders/:uuid/ready-to-ship'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['readyToShip']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_orders_controller').default['readyToShip']>>>
    }
  }
  'vendor.vendor_shipments.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/orders/:uuid/shipments'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_shipments_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_shipments_controller').default['index']>>>
    }
  }
  'vendor.vendor_shipments.store': {
    methods: ["POST"]
    pattern: '/v1/vendor/orders/:uuid/shipments'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/shipment').createShipmentValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/shipment').createShipmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_shipments_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_shipments_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_shipments.void': {
    methods: ["POST"]
    pattern: '/v1/vendor/orders/:uuid/shipments/:shipmentUuid/void'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { uuid: ParamValue; shipmentUuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_shipments_controller').default['void']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_shipments_controller').default['void']>>>
    }
  }
  'vendor.vendor_payouts.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/payouts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_payouts_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_payouts_controller').default['index']>>>
    }
  }
  'vendor.vendor_payout_methods.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/payout-method'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['show']>>>
    }
  }
  'vendor.vendor_payout_methods.start_stripe': {
    methods: ["POST"]
    pattern: '/v1/vendor/payout-method/stripe/onboarding'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['startStripe']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['startStripe']>>>
    }
  }
  'vendor.vendor_payout_methods.start_paypal': {
    methods: ["POST"]
    pattern: '/v1/vendor/payout-method/paypal/connect'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['startPaypal']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['startPaypal']>>>
    }
  }
  'vendor.vendor_payout_methods.complete_paypal': {
    methods: ["POST"]
    pattern: '/v1/vendor/payout-method/paypal/callback'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_payout').paypalConnectCallbackValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_payout').paypalConnectCallbackValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['completePaypal']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_payout_methods_controller').default['completePaypal']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_addresses.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/addresses'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['index']>>>
    }
  }
  'vendor.vendor_addresses.store': {
    methods: ["POST"]
    pattern: '/v1/vendor/addresses'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/address').createAddressValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/address').createAddressValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_addresses.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/addresses/:uuid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['show']>>>
    }
  }
  'vendor.vendor_addresses.update': {
    methods: ["PATCH"]
    pattern: '/v1/vendor/addresses/:uuid'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/address').updateAddressValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/address').updateAddressValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_addresses.destroy': {
    methods: ["DELETE"]
    pattern: '/v1/vendor/addresses/:uuid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_addresses_controller').default['destroy']>>>
    }
  }
  'vendor.vendor_onboarding.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/vendor/onboarding'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['show']>>>
    }
  }
  'vendor.vendor_onboarding.update_profile': {
    methods: ["PATCH"]
    pattern: '/v1/vendor/onboarding/profile'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_onboarding').updateVendorProfileValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_onboarding').updateVendorProfileValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['updateProfile']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['updateProfile']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_onboarding.set_capabilities': {
    methods: ["PUT"]
    pattern: '/v1/vendor/onboarding/capabilities'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_onboarding').setVendorCapabilitiesValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_onboarding').setVendorCapabilitiesValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['setCapabilities']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['setCapabilities']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_onboarding.accept_agreement': {
    methods: ["POST"]
    pattern: '/v1/vendor/onboarding/agreement'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_onboarding').acceptVendorAgreementValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_onboarding').acceptVendorAgreementValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['acceptAgreement']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['acceptAgreement']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_onboarding.upload_tax': {
    methods: ["PUT"]
    pattern: '/v1/vendor/onboarding/tax'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_onboarding').uploadVendorTaxDocumentValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_onboarding').uploadVendorTaxDocumentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['uploadTax']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['uploadTax']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vendor.vendor_onboarding.submit': {
    methods: ["POST"]
    pattern: '/v1/vendor/onboarding/submit'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['submit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vendor_onboarding_controller').default['submit']>>>
    }
  }
  'admin.admin_quotes.needs_review': {
    methods: ["GET","HEAD"]
    pattern: '/v1/admin/quotes/needs-review'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_quotes_controller').default['needsReview']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_quotes_controller').default['needsReview']>>>
    }
  }
  'admin.admin_quotes.split': {
    methods: ["POST"]
    pattern: '/v1/admin/quotes/:uuid/split'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/admin_quote').splitQuoteValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/admin_quote').splitQuoteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_quotes_controller').default['split']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_quotes_controller').default['split']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_vendor_payouts.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/admin/payouts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['index']>>>
    }
  }
  'admin.admin_vendor_payouts.release': {
    methods: ["POST"]
    pattern: '/v1/admin/payouts/:uuid/release'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_payout').releasePayoutValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_payout').releasePayoutValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['release']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['release']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_vendor_payouts.cancel': {
    methods: ["POST"]
    pattern: '/v1/admin/payouts/:uuid/cancel'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['cancel']>>>
    }
  }
  'admin.admin_vendor_payouts.retry': {
    methods: ["POST"]
    pattern: '/v1/admin/payouts/:uuid/retry'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['retry']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['retry']>>>
    }
  }
  'admin.admin_vendor_payouts.rates': {
    methods: ["GET","HEAD"]
    pattern: '/v1/admin/vendors/:uuid/payout-rates'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['rates']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['rates']>>>
    }
  }
  'admin.admin_vendor_payouts.update_rates': {
    methods: ["PUT"]
    pattern: '/v1/admin/vendors/:uuid/payout-rates'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_payout').payoutRatesValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_payout').payoutRatesValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['updateRates']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['updateRates']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_vendor_payouts.update_vendor': {
    methods: ["PATCH"]
    pattern: '/v1/admin/vendors/:uuid'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vendor_payout').updateVendorPayoutSettingsValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/vendor_payout').updateVendorPayoutSettingsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['updateVendor']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendor_payouts_controller').default['updateVendor']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_invitations.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/admin/invitations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['index']>>>
    }
  }
  'admin.admin_invitations.store': {
    methods: ["POST"]
    pattern: '/v1/admin/invitations'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitation').createInvitationValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/invitation').createInvitationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_invitations.resend': {
    methods: ["POST"]
    pattern: '/v1/admin/invitations/:uuid/resend'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['resend']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['resend']>>>
    }
  }
  'admin.admin_invitations.revoke': {
    methods: ["POST"]
    pattern: '/v1/admin/invitations/:uuid/revoke'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['revoke']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_invitations_controller').default['revoke']>>>
    }
  }
  'admin.admin_vendors.index': {
    methods: ["GET","HEAD"]
    pattern: '/v1/admin/vendors'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['index']>>>
    }
  }
  'admin.admin_vendors.show': {
    methods: ["GET","HEAD"]
    pattern: '/v1/admin/vendors/:uuid'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['show']>>>
    }
  }
  'admin.admin_vendors.review_capability': {
    methods: ["PATCH"]
    pattern: '/v1/admin/vendors/:uuid/capabilities/:technology'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/admin_vendor').reviewCapabilityValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { uuid: ParamValue; technology: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/admin_vendor').reviewCapabilityValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['reviewCapability']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['reviewCapability']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_vendors.tax_document': {
    methods: ["GET","HEAD"]
    pattern: '/v1/admin/vendors/:uuid/tax/document'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['taxDocument']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['taxDocument']>>>
    }
  }
  'admin.admin_vendors.verify_tax': {
    methods: ["POST"]
    pattern: '/v1/admin/vendors/:uuid/tax/verify'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['verifyTax']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['verifyTax']>>>
    }
  }
  'admin.admin_vendors.reject_tax': {
    methods: ["POST"]
    pattern: '/v1/admin/vendors/:uuid/tax/reject'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/admin_vendor').rejectTaxDocumentValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/admin_vendor').rejectTaxDocumentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['rejectTax']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['rejectTax']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_vendors.activate': {
    methods: ["POST"]
    pattern: '/v1/admin/vendors/:uuid/activate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['activate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['activate']>>>
    }
  }
  'admin.admin_vendors.suspend': {
    methods: ["POST"]
    pattern: '/v1/admin/vendors/:uuid/suspend'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/admin_vendor').suspendVendorValidator)>>
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/admin_vendor').suspendVendorValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['suspend']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['suspend']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.admin_vendors.reinstate': {
    methods: ["POST"]
    pattern: '/v1/admin/vendors/:uuid/reinstate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { uuid: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['reinstate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_vendors_controller').default['reinstate']>>>
    }
  }
  'webhooks.stripe_webhooks': {
    methods: ["POST"]
    pattern: '/v1/webhooks/stripe'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/stripe_webhooks_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/stripe_webhooks_controller').default['handle']>>>
    }
  }
  'webhooks.paypal_webhooks': {
    methods: ["POST"]
    pattern: '/v1/webhooks/paypal'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/paypal_webhooks_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/paypal_webhooks_controller').default['handle']>>>
    }
  }
  'webhooks.easypost_webhooks': {
    methods: ["POST"]
    pattern: '/v1/webhooks/easypost'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/easypost_webhooks_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/easypost_webhooks_controller').default['handle']>>>
    }
  }
}
