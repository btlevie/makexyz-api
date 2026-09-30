/**
 * Registrable domains a link may point to without holding the message for
 * review. Deliberately short: manufacturing/3D-printing resources customers
 * and vendors legitimately share, and carrier tracking. It only lifts the
 * "unknown link" hold - it never exempts a message from the contact or
 * advertising rules (a vendor's own Printables profile is still a way to take
 * a customer off-platform).
 *
 * Moves to the url_domains table (moderator-managed allow/block lists) with
 * the URL-reputation step - see docs/plans/messaging_moderation.md.
 */
export const ALLOWLISTED_DOMAINS: ReadonlySet<string> = new Set([
  // MakeXYZ itself
  'makexyz.com',
  // Model repositories and CAD
  'thingiverse.com',
  'printables.com',
  'myminifactory.com',
  'cults3d.com',
  'grabcad.com',
  'onshape.com',
  'autodesk.com',
  // Parts, printers and materials
  'mcmaster.com',
  'prusa3d.com',
  'bambulab.com',
  'formlabs.com',
  'ultimaker.com',
  // Carrier tracking
  'ups.com',
  'usps.com',
  'fedex.com',
  'dhl.com',
])

export function isAllowlistedDomain(registrableDomain: string | null): boolean {
  return registrableDomain !== null && ALLOWLISTED_DOMAINS.has(registrableDomain)
}
