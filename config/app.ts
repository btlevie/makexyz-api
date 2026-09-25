import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/core/http'
import { BlockList, isIPv4, isIPv6 } from 'node:net'

/**
 * The app URL can be used in various places where you want to create absolute
 * URLs to your application. For example, when sending emails, images should
 * use absolute URLs.
 */
export const appUrl = env.get('APP_URL')

/**
 * Loopback and private (RFC 1918 / IPv6 unique-local) ranges - where the ALB
 * connects from, whatever the VPC's CIDR. Equivalent to proxy-addr's
 * 'loopback' + 'uniquelocal' presets, which defineConfig's string form can't
 * combine (it compiles a single range).
 */
const trustedProxyRanges = new BlockList()
trustedProxyRanges.addSubnet('127.0.0.0', 8, 'ipv4')
trustedProxyRanges.addSubnet('10.0.0.0', 8, 'ipv4')
trustedProxyRanges.addSubnet('172.16.0.0', 12, 'ipv4')
trustedProxyRanges.addSubnet('192.168.0.0', 16, 'ipv4')
trustedProxyRanges.addAddress('::1', 'ipv6')
trustedProxyRanges.addSubnet('fc00::', 7, 'ipv6')

function isTrustedProxy(address: string): boolean {
  // Dual-stack sockets report IPv4 peers as IPv4-mapped IPv6 (::ffff:10.0.0.5).
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : null
  if (mapped && isIPv4(mapped)) return trustedProxyRanges.check(mapped, 'ipv4')
  if (isIPv4(address)) return trustedProxyRanges.check(address, 'ipv4')
  if (isIPv6(address)) return trustedProxyRanges.check(address, 'ipv6')
  return false
}

/**
 * The configuration settings used by the HTTP server
 */
export const http = defineConfig({
  /**
   * Generate a unique request id for each incoming request.
   * Useful to correlate logs and debug a request flow.
   */
  generateRequestId: true,

  /**
   * Which proxies request.ip() may skip when reading X-Forwarded-For.
   * proxy-addr walks the header from the right, skipping trusted addresses,
   * and returns the first untrusted one - never the leftmost entry, which the
   * client controls. Used for vendors.agreement_accepted_ip and as the rate
   * limiters' default key.
   *
   * The API runs on ECS behind an Application Load Balancer. The ALB connects
   * from private VPC addresses and (in its default `append` mode) appends
   * the client IP it saw, so trusting private ranges trusts exactly the ALB.
   *
   * TODO(verify): confirm against a real deploy, then remove this TODO:
   *   1. Nothing fronts the ALB (CloudFront, API Gateway). If CloudFront
   *      does, the ALB appends CloudFront's public edge IP instead - trust
   *      one more hop, e.g. `(address, hop) => hop < 2 && ...`, and make
   *      sure only CloudFront can reach the ALB.
   *   2. The ALB's routing.http.xff_header_processing.mode is `append`.
   *   3. The ALB's routing.http.xff_client_port.enabled is off (with it on,
   *      entries become ip:port, which proxy-addr doesn't parse).
   *   4. The frontend calls the API from the browser, not from its own server
   *      (Amplify SSR) - otherwise request.ip() is Amplify's address.
   *   5. From a known IP, log request.header('x-forwarded-for'),
   *      request.request.socket.remoteAddress and request.ip() for one request.
   */
  trustProxy: (address) => isTrustedProxy(address),

  /**
   * Allow HTTP method spoofing via the "_method" form/query parameter.
   * This lets HTML forms target PUT/PATCH/DELETE routes while still
   * submitting with POST.
   */
  allowMethodSpoofing: false,

  /**
   * Enabling async local storage will let you access HTTP context
   * from anywhere inside your application.
   */
  useAsyncLocalStorage: false,

  /**
   * Redirect configuration controls the behavior of
   * response.redirect().back() and query string forwarding.
   */
  redirect: {
    /**
     * When enabled, all redirects automatically carry over the current
     * request's query string parameters to the redirect destination.
     * Use withQs(false) to opt out for a specific redirect.
     */
    forwardQueryString: true,
  },

  /**
   * Manage cookies configuration. The settings for the session id cookie are
   * defined inside the "config/session.ts" file.
   */
  cookie: {
    /**
     * Restrict the cookie to a specific domain.
     * Keep empty to use the current host.
     */
    domain: '',

    /**
     * Restrict the cookie to a URL path. '/' means all routes.
     */
    path: '/',

    /**
     * Default lifetime for cookies managed by the HTTP layer.
     */
    maxAge: '2h',

    /**
     * Prevent JavaScript access to the cookie in the browser.
     */
    httpOnly: true,

    /**
     * Send cookies only over HTTPS in production.
     */
    secure: app.inProduction,

    /**
     * Cross-site policy for cookie sending.
     */
    sameSite: 'lax',
  },
})
