import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
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
    'projects.project_files.update_slicing_progress': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.quotes.store': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.quotes.configure': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.quotes.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.checkout_sessions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.checkout_sessions.authorize': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.projects.capture_email': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'serviceable_countries.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.accept': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
  }
  GET: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'projects.project_files.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'serviceable_countries.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.index': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'projects.project_files.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'serviceable_countries.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.index': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'auth.new_customer.store': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'projects.project_files.store_instant_quote_files': { paramsTuple?: []; params?: {} }
    'projects.quotes.store': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.checkout_sessions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.projects.capture_email': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
  }
  PATCH: {
    'projects.project_files.update_technology': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_material': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_color': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_result': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_progress': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.quotes.configure': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.quotes.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.checkout_sessions.authorize': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'vendor.vendor_orders.accept': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}