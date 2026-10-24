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
import CloseExpiredConversations from '#jobs/close_expired_conversations'
import RescanRecentUrls from '#jobs/rescan_recent_urls'
import SweepHeldMessages from '#jobs/sweep_held_messages'

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

/**
 * Hourly: idle inquiries and finished order threads become read-only (see
 * conversation_service.ts). Bookkeeping only - posts to a finished order are
 * refused the moment it finishes - so hourly is plenty.
 */
CloseExpiredConversations.schedule({}).id('close-expired-conversations').cron('35 * * * *').run()

/**
 * Every 6 hours: re-checks links sent in the last 30 days whose cached
 * verdict expired, and takes down messages whose link turned malicious (see
 * message_analysis_service.ts). Overlap-safe: a rescan only re-analyses and
 * removes, both idempotent.
 */
RescanRecentUrls.schedule({}).id('rescan-recent-urls').cron('45 */6 * * *').run()

/**
 * Every 10 minutes: a message held for automated analysis too long gets a
 * final pass, after which anything undecided goes to a person - so a lost job
 * never leaves a message held. Overlap-safe: the pass re-checks the status
 * under a row lock.
 */
SweepHeldMessages.schedule({}).id('sweep-held-messages').cron('*/10 * * * *').run()
