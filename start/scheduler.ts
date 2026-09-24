/*
|--------------------------------------------------------------------------
| Scheduler
|--------------------------------------------------------------------------
|
| This file is used to define scheduled jobs. You can schedule jobs to run
| at specific intervals using cron expressions or duration strings.
|
| Example:
|
|   import SendWeeklyReport from '#jobs/send_weekly_report'
|
|   SendWeeklyReport.schedule({ userId: 1 })
|     .cron('0 9 * * MON')
|     .run()
|
| These require a worker to be running: `node ace queue:work`.
|
*/

import ExpireAbandonedProjects from '#jobs/expire_abandoned_projects'
import PurgeExpiredProjects from '#jobs/purge_expired_projects'
import EscalateOrderRouting from '#jobs/escalate_order_routing'
import ExpireCheckoutSessions from '#jobs/expire_checkout_sessions'
import ProcessVendorPayouts from '#jobs/process_vendor_payouts'

/**
 * Abandoned instant-quote cleanup, in two stages so it stays reversible for a
 * while: expire first (marking the project expired and its open quotes rejected
 * as `abandoned`), then reclaim the storage after a grace window.
 *
 * Both are daily - the TTLs are measured in days, so there is nothing to gain
 * from running them more often.
 *
 * The stable `id()` matters: this file is preloaded on every boot, so without
 * one each restart would register another copy of the same schedule.
 *
 * This scheduler has no withoutOverlapping(); both jobs are written to be safe
 * if they do overlap - expire re-queries by cutoff, and purge locks each project
 * row and re-checks before acting.
 */
ExpireAbandonedProjects.schedule({}).id('expire-abandoned-projects').cron('15 3 * * *').run()

// An hour after expire, so a project expired by tonight's run isn't purged by a
// sweep running alongside it.
PurgeExpiredProjects.schedule({}).id('purge-expired-projects').cron('15 4 * * *').run()

/**
 * Hourly: moves any order past its preferred-routing window into the open
 * queue so it isn't stuck waiting on preferred vendors indefinitely.
 */
EscalateOrderRouting.schedule({}).id('escalate-order-routing').cron('0 * * * *').run()

// Offset five minutes from the routing escalation above so the two hourly
// jobs don't contend for the same rows at the same moment.
ExpireCheckoutSessions.schedule({}).id('expire-checkout-sessions').cron('5 * * * *').run()

/**
 * Hourly vendor payouts, offset from the other hourly jobs. Overlap-safe: each
 * payout is claimed under a row lock and re-checked, and every send carries
 * the payout's idempotency key (see vendor_payout_service.ts).
 */
ProcessVendorPayouts.schedule({}).id('process-vendor-payouts').cron('20 * * * *').run()
