/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
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
}
