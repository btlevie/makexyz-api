/**
 * Access grants for anonymous instant-quote projects.
 *
 * An instant-quote project has no owner - the customer is optional and only
 * appears later, if the visitor opts into "email this quote to yourself". So
 * ownership can't authorize follow-up requests. Instead the upload response
 * carries an opaque signed grant naming the project, and the holder of that
 * grant may act on it.
 *
 * Built on Adonis's encryption service, so the token is signed, tamper-evident
 * and self-expiring with no table behind it.
 *
 * Deliberately generic in shape: a checkout session will need exactly this when
 * a guest completes checkout from an emailed link.
 */
import encryption from '@adonisjs/core/services/encryption'
import type { HttpContext } from '@adonisjs/core/http'
import Customer from '#models/customer'
import Project from '#models/project'
import ProjectFile from '#models/project_file'
import Vendor from '#models/vendor'
import env from '#start/env'

/** Namespaces the signature so a grant can't be replayed as another token. */
const GRANT_PURPOSE = 'anonymous_project_grant'

const GRANT_HEADER = 'x-project-grant'

export function issueGrant(project: Project): string {
  return encryption.encrypt(project.uuid, env.get('ANONYMOUS_GRANT_TTL', '30 days'), GRANT_PURPOSE)
}

/**
 * The project uuid a presented grant authorizes, or null when absent, malformed,
 * tampered with, or expired. Never throws - a bad grant is simply no grant.
 */
export function readGrant(ctx: HttpContext): string | null {
  const token = ctx.request.header(GRANT_HEADER)
  if (!token) {
    return null
  }

  return encryption.decrypt<string>(token, GRANT_PURPOSE)
}

/**
 * Resolves a project the caller is allowed to act on, by either route:
 * an authenticated customer who owns it, or a valid grant naming it.
 *
 * Returns null rather than throwing so callers can 404 uniformly - deliberately
 * not distinguishing "no such project" from "not yours", which would confirm
 * the existence of other people's projects.
 */
/**
 * Vendor statuses with staff project access. Suspended is included: a
 * suspended vendor can't accept new orders but still has to finish (and so
 * see) the ones already accepted. A vendor still onboarding or awaiting review
 * hasn't been vetted and gets no access - see docs/VENDOR_ONBOARDING.md.
 */
const STAFF_VENDOR_STATUSES: Vendor['status'][] = ['active', 'suspended']

/**
 * Whether the caller may reach any project, not just their own: admins, and
 * vendors whose onboarding has been approved. Async because a vendor's access
 * depends on their Vendor record's status, not just their role - always
 * `await` it (an un-awaited Promise is truthy).
 */
export async function isStaff(ctx: HttpContext): Promise<boolean> {
  const user = ctx.auth.user
  if (!user) {
    return false
  }
  if (user.role === 'admin') {
    return true
  }
  if (user.role !== 'vendor') {
    return false
  }
  const vendor = await Vendor.findBy('userId', user.id)
  return !!vendor && STAFF_VENDOR_STATUSES.includes(vendor.status)
}

/**
 * Stricter than isStaff - admin only. Used for actions like splitting a
 * quote or force-assigning a vendor, which a vendor account (bundled into
 * isStaff's broader "may reach any project" check) shouldn't be able to do.
 */
export function isAdmin(ctx: HttpContext): boolean {
  return ctx.auth.user?.role === 'admin'
}

/**
 * Resolves a project file the caller may act on, by the same three routes as
 * resolveProject plus staff access - staff need to reach anyone's file, since
 * correcting someone else's part is the entire point of the override.
 *
 * Preloads `project` (needed for the grant check), `sliceVariants` (needed by
 * every caller so far, which all reset slice data), `material` with its
 * `colors` (needed to resolve/validate a project file's color), and `color`
 * itself - every caller now serializes these via ProjectFileTransformer,
 * including their unchanged/no-op return paths.
 */
export async function resolveProjectFile(
  ctx: HttpContext,
  fileUuid: string
): Promise<ProjectFile | null> {
  const projectFile = await ProjectFile.query()
    .where('uuid', fileUuid)
    .preload('project')
    .preload('sliceVariants')
    .preload('material', (query) => query.preload('colors'))
    .preload('color')
    .first()

  if (!projectFile || !projectFile.project) {
    return null
  }

  if (await isStaff(ctx)) {
    return projectFile
  }

  if (readGrant(ctx) === projectFile.project.uuid) {
    return projectFile
  }

  const user = ctx.auth.user
  if (!user) {
    return null
  }

  const customer = await Customer.findBy('userId', user.id)
  if (!customer) {
    return null
  }

  return projectFile.project.customerId === customer.id ? projectFile : null
}

export async function resolveProject(
  ctx: HttpContext,
  projectUuid: string
): Promise<Project | null> {
  if (readGrant(ctx) === projectUuid) {
    return Project.findBy('uuid', projectUuid)
  }

  const user = ctx.auth.user
  if (!user) {
    return null
  }

  const customer = await Customer.findBy('userId', user.id)
  if (!customer) {
    return null
  }

  return Project.query().where('uuid', projectUuid).where('customerId', customer.id).first()
}
