import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'auth.new_customer.store': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'projects.project_files.store_instant_quote_files': { paramsTuple?: []; params?: {} }
    'projects.project_files.update_technology': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_material': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_color': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_result': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.quotes.store': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.projects.capture_email': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
  }
  GET: {
    'profile.profile.show': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'profile.profile.show': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'auth.new_customer.store': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'projects.project_files.store_instant_quote_files': { paramsTuple?: []; params?: {} }
    'projects.quotes.store': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.projects.capture_email': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
  }
  PATCH: {
    'projects.project_files.update_technology': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_material': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_color': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_result': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}