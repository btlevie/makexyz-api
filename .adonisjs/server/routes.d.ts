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
    'profile.addresses.index': { paramsTuple?: []; params?: {} }
    'profile.addresses.store': { paramsTuple?: []; params?: {} }
    'profile.addresses.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'profile.addresses.update': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'profile.addresses.destroy': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.store_instant_quote_files': { paramsTuple?: []; params?: {} }
    'projects.project_files.update_technology': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_material': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_color': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_result': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_progress': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.quotes.store': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.quotes.index': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.quotes.configure': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.quotes.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.checkout_sessions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.checkout_sessions.authorize': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.orders.show': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.projects.capture_email': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'serviceable_countries.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.active': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.accept': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_orders.start_production': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_orders.ready_to_ship': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_addresses.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_addresses.store': { paramsTuple?: []; params?: {} }
    'vendor.vendor_addresses.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_addresses.update': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_addresses.destroy': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'admin.admin_quotes.needs_review': { paramsTuple?: []; params?: {} }
    'admin.admin_quotes.split': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'webhooks.stripe_webhooks': { paramsTuple?: []; params?: {} }
    'webhooks.paypal_webhooks': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.addresses.index': { paramsTuple?: []; params?: {} }
    'profile.addresses.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.quotes.index': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.orders.show': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'serviceable_countries.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.active': { paramsTuple?: []; params?: {} }
    'vendor.vendor_addresses.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_addresses.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'admin.admin_quotes.needs_review': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.addresses.index': { paramsTuple?: []; params?: {} }
    'profile.addresses.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.quotes.index': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.orders.show': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'serviceable_countries.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_orders.active': { paramsTuple?: []; params?: {} }
    'vendor.vendor_addresses.index': { paramsTuple?: []; params?: {} }
    'vendor.vendor_addresses.show': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'admin.admin_quotes.needs_review': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'auth.new_customer.store': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'profile.addresses.store': { paramsTuple?: []; params?: {} }
    'projects.project_files.store_instant_quote_files': { paramsTuple?: []; params?: {} }
    'projects.quotes.store': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'projects.checkout_sessions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.projects.capture_email': { paramsTuple: [ParamValue]; params: {'projectUuid': ParamValue} }
    'vendor.vendor_addresses.store': { paramsTuple?: []; params?: {} }
    'admin.admin_quotes.split': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'webhooks.stripe_webhooks': { paramsTuple?: []; params?: {} }
    'webhooks.paypal_webhooks': { paramsTuple?: []; params?: {} }
  }
  PATCH: {
    'profile.addresses.update': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_technology': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_material': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_color': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_result': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.project_files.update_slicing_progress': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'projects.quotes.configure': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.quotes.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'projects.checkout_sessions.authorize': { paramsTuple: [ParamValue,ParamValue]; params: {'projectUuid': ParamValue,'uuid': ParamValue} }
    'vendor.vendor_orders.accept': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_orders.start_production': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_orders.ready_to_ship': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_addresses.update': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
  }
  DELETE: {
    'profile.addresses.destroy': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
    'vendor.vendor_addresses.destroy': { paramsTuple: [ParamValue]; params: {'uuid': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}