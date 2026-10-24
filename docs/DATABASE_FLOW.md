# makexyz Database Flow

## Overview

makexyz is a manufacturing marketplace that connects customers with vendors capable of fulfilling manufacturing projects. The system is designed around the following lifecycle:

```text
Project
↓
Quote
↓
Checkout Session
↓
Payment Authorization
↓
Order (Open)
↓
Vendor Acceptance
↓
Payment Capture
↓
Production
↓
Shipping
↓
Delivery
↓
Vendor Payout
```

The database is organized to support each stage of this lifecycle while maintaining historical records, auditability, and integrations with payment processors and accounting systems.

---

# Core Concepts

## Users

The `users` table stores authentication and authorization information for all system users.

Users have one of three roles:

* `admin`
* `customer`
* `vendor`

Additional profile information is stored in role-specific tables:

* `customers`
* `vendors`

This separation allows role-specific integrations and metadata while keeping authentication centralized.

`users.email_verified_at` records that the account holder proved they own their email: through a signed link emailed at signup (resendable), or by accepting an emailed invitation, which counts as proof on its own. Signup itself never checks the address. A verified email is required before a customer can message vendors (see Messaging). See `app/services/email_verification_service.ts`.

A `customers` row does not require a user. Instant-quote visitors never need an account: the moment they give an email (alongside the shipping address on quote configuration, or via "email this quote to me") a **guest customer** is created with `customers.email` set and `user_id` null, and one guest row is shared by every project the same email is given for. This is what lets an abandoned quote be followed up by email. Guest customers also record an explicit marketing opt-in (`marketing_opt_in`, default false, with `marketing_opt_in_updated_at` as evidence of when the choice last changed); follow-up campaigns only go to customers who opted in. An account's consent is never changed through these public, unverified guest endpoints.

### Guest customers and account claiming

When a guest later creates an account, their guest work has to follow them. Matching by email alone is unsafe (anyone can sign up with someone else's email), so linking always needs proof:

* **Same browser (grant):** a signup request carrying a project grant (`x-project-grant`) attaches *that one project* to the new account's customer, along with its orders, checkout sessions and quote shipping addresses. The grant proves nothing about the guest's other projects, so nothing else moves.
* **Verified email (signed link):** if a guest customer with the same email holds projects, signup emails that address a signed link (`${ACCOUNT_CLAIM_URL}?link=<signed API path>`, 24 hours). Opening it **while signed in to that account** merges the guest into it: every project, order, address and checkout session moves to the account's customer, the more recent marketing choice is kept, and the guest row is deleted (so the link works once). Requiring the signed-in account blocks someone who signed up with a victim's email from pulling the victim's orders in if the victim clicks the link.

Neither path ever takes work from a customer that already has an account. See `app/services/customer_claim_service.ts` and `app/services/guest_claim_service.ts`.

---

## Addresses

The `addresses` table stores addresses for both customers and vendors.

Addresses may be used for:

* Customer shipping addresses
* Vendor business addresses
* Vendor shipping origin addresses

The `owner_type` field identifies whether the address belongs to a customer or vendor. An owner may have many addresses (e.g. a "Personal" and a "Business" one, distinguished by `label`), with at most one marked `is_default` at a time. A quote's shipping address is either selected from the customer's existing addresses or created new during quote configuration (see Quotes below) — a guest must give an email alongside a new shipping address, which attaches a guest customer (no user account) to the project first, so the address is owned from the start. Only a quote staff configure on a guest's behalf can create an unowned address (`customer_id: null`), which is backfilled once checkout resolves a customer.

Once an order references an address, its location fields (recipient, lines, city, state, postal code, country) are frozen — the order's tax was calculated on it and its shipping label is bought against it. Only `label` and `is_default` remain editable; a customer who moves adds a new address instead.

---

# Project Lifecycle

## Projects

A project represents a customer's manufacturing request.

A project contains:

* Files uploaded by the customer
* Manufacturing specifications
* Metadata and configuration
* Current lifecycle status

A project may have many quotes over its lifetime.

Typical statuses:

```text
draft
↓
quoted
↓
awaiting_checkout
↓
ordered
↓
fulfilled
```

Projects may also become:

* `cancelled`
* `expired`

---

## Project Files

A project may contain multiple files.

Each file stores manufacturing-specific information including:

* Material
* Volume (cm³)
* Dimensions (millimeters)
* Surface area (mm²)
* Color
* Layer height
* Infill
* Model material grams and support material grams
* Estimated print time (seconds)
* Generated G-code

These records represent the manufacturing inputs that are later used to generate quotes and order items.

The material split, print time, and dimensions are produced by the slicer service and are what the pricing engine consumes. A file must have finished slicing before it can be priced.

SLS files get a geometry-only analysis instead of a traditional slice: PrusaSlicer has no powder-bed-fusion process, so the slicer service reads volume, bounding box, and surface area directly from the mesh (`prusa-slicer --info` plus a small surface-area calculation) rather than generating toolpaths. There's no G-code, no support/model material split (the surrounding powder bed is the support, reclaimed after the build), and `printTimeEstimatedSeconds` is a geometry-based approximation rather than a physics-simulated slicer output. Like SLA, SLS files aren't priceable yet - no pricing algorithm exists for either.

---

# Quotes

A quote represents a pricing proposal for a project.

A project may have multiple quote revisions.

Quotes contain:

* Subtotal
* Tax
* Total
* Notes
* Revision number
* Generator information
* A shipping address (`address_id`, referencing the `addresses` book — see
  Addresses above) — required before a quote can be accepted, since sales
  tax depends on the full address, not just destination country

Quotes may be:

* `draft`
* `sent`
* `accepted`
* `rejected`

Quotes are immutable pricing snapshots and should be preserved for historical reference.

Quantity lives only on quote items. Until a quote is accepted, the customer can
change line quantities (`PATCH /v1/projects/:projectUuid/quotes/:uuid/quantities`).
Each change writes a new revision in the same lineage: changed lines are repriced,
other lines carry over unchanged, and a quote that was already configured has its
tax recomputed. Automatic requotes (a material change, a newly sliced part) keep
the quantities from the latest revision, and a part quoted for the first time
starts at one.

---

## Quote Items

Quote items represent the individual line items that make up a quote.

Examples:

* Printing costs
* Setup charges
* Post-processing services
* Additional manufacturing services

Quote items are associated with project files and contain:

* Quantity
* Unit price
* Total
* The pricing configuration used
* A pricing snapshot

Unit price is a rounded, display-oriented figure. Because it is rounded before
being multiplied out, `unit price × quantity` does not always equal `total` — the
authoritative figures are `total` and the pricing snapshot.

---

## Pricing Configuration

Manufacturing prices are calculated from constants held in the database rather
than in application code, so they can be tuned without a deploy.

`pricing_configs` is the technology-scoped, versioned header: technology,
version, active flag, and who activated it when. The constants themselves live
in a per-technology values table — currently `fdm_pricing_config_values` — so
adding a technology means adding a table rather than widening a shared one with
columns that are null for everything else.

Exactly one configuration is active per technology. Changing prices means
creating a new version and activating it, never editing an active row: each
quote item records the configuration that produced it plus a full snapshot of
the calculation, so a historical quote can still be explained months later after
the constants have moved on.

The FDM engine prices manufacturing only — model material, support material,
machine time, a failure buffer, a fixed per-line charge, a quantity discount
that decays toward a material-cost floor, and an oversize surcharge. Shipping,
tax, fees and any minimum order value are deliberately excluded; those belong to
checkout.

---

## Fees

Fees represent reusable platform charges.

Examples:

* Rush processing fee
* Handling fee
* Service fee

Fees are defined in:

* `fees`

Applied fees are stored separately:

* `quote_fees`
* `order_fees`

This preserves historical pricing even if fee definitions change in the future.

---

# Checkout Sessions

A checkout session represents a customer's intent to purchase a quote.

A checkout session is essentially a cart-like snapshot that locks pricing and customer information at the time checkout begins.

Checkout sessions exist independently of orders because an order cannot exist until the customer initiates the purchasing process.

A checkout session belongs to:

* one quote
* one project
* one customer

Statuses:

* `active`
* `expired`
* `completed`
* `failed`

---

# Payments

Payments belong to checkout sessions.

This is intentional because payment authorization occurs before vendor acceptance.

Payment lifecycle:

```text
Checkout Session
↓
Payment Authorized
↓
Order Created
↓
Vendor Accepts
↓
Payment Captured
```

Payment statuses:

* `pending`
* `authorized`
* `captured`
* `failed`
* `refunded`
* `cancelled`

A payment is only ever `pending` while a card awaits 3D Secure: the provider returned "requires action", so no hold exists yet and no order has been created. The customer completes the bank's challenge in the browser (Stripe.js), and the next checkout call on the same session re-reads that same provider transaction. If it's now authorized, the payment becomes `authorized` and the order is created; if the challenge failed, the payment and session become `failed`. A pending payment on a session that expires is cancelled at the provider.

Every authorization is checked against the quote before a hold counts: Stripe amounts are set by the backend and re-checked on resume, and a PayPal order must have been created for exactly this quote's total (the backend creates it; the frontend only has the customer approve it).

The payment record stores:

* Payment provider
* Provider transaction identifiers
* Fees
* Gross amount
* Net amount
* Lifecycle timestamps

---

## Refunds

Refunds are children of payments.

A payment may have multiple refunds.

Refund records preserve:

* Amount
* Reason
* Timestamps

---

# Orders

An order represents a commercial agreement that may be fulfilled by a vendor.

Orders are created from quotes.

An order contains:

* Customer information
* Shipping address (`address_id`, copied forward from the quote at checkout)
* Pricing snapshot
* Vendor assignment
* Status information
* External references

An order initially enters the system without vendor acceptance.

Typical flow:

```text
pending
↓
paid
↓
open
↓
accepted
↓
in_progress
↓
ready_to_ship
↓
shipped
↓
delivered
```

Orders may also become:

* `rejected`
* `refunded`
* `cancelled`

---

## Vendor Onboarding

Vendors join by admin invitation (`invitations`). Accepting creates the vendor's user and `vendors` row together, and the vendor then completes an onboarding checklist before an admin reviews and activates them (`vendors.status`: `onboarding → pending_review → active`, with `suspended` reversible). Capabilities are requested by the vendor and approved by an admin (`vendor_technology_capabilities.status`). Tax forms are kept in `vendor_tax_documents`.

**Only active vendors with approved capabilities count** for quote fulfillability, order routing, order acceptance, and staff project access.

The full process (states, checklists, endpoints, frontend routing, edge cases) is documented in [VENDOR_ONBOARDING.md](./VENDOR_ONBOARDING.md).

---

## Vendor Acceptance

After an order is created, it enters the open order pool.

Open orders are visible to active vendors with approved capabilities for every technology the order needs (see Vendor Onboarding).

A vendor may accept an order.

Upon acceptance:

1. The order is assigned to the vendor.
2. The payment authorization is captured.
3. Production begins.

---

## Order Items

Order items are immutable snapshots of quote items.

They preserve:

* Descriptions
* Quantities
* Pricing

This prevents historical order information from changing if quote data is modified later.

---

# Vendor Compensation

## Vendor Payout Rates

Vendor payout rates define how revenue is split for manufacturing work.

Rates are configured per vendor and material (unique per pair), as the percentage of an order item's total paid to the vendor. They are managed by admins (`PUT /v1/admin/vendors/:uuid/payout-rates`).

**A vendor cannot accept an order unless they have a rate for every item's material** — acceptance is refused and the order stays open for another vendor. The vendor's open-order listing shows the estimated payout for each order, or why they can't accept it.

Rate changes only affect orders accepted afterwards; accepted orders keep their snapshot (below).

---

## Vendor Payouts

Vendor payouts represent money owed to vendors after work is completed. There is at most one payout per order (`order_id` is unique).

**Amount.** Snapshotted into `breakdown` (JSON) when the vendor accepts the order, in the same transaction as the `open → accepted` transition — the terms the vendor accepted under:

* Each order item's total × the vendor's rate for that item's material, rounded per line in integer cents
* Plus 100% of the order's production-time fee
* Never shipping (MakeXYZ pays for labels) or tax

If staff change a part's material on an accepted order (via the lock override), the pending payout is recalculated; a material with no rate refuses the change.

**Rails.** Vendors choose how they're paid, and must have a ready payout method before they can accept orders:

* **Stripe Connect (Express)** — the server creates the connected account and stores its id in `vendors.stripe_account_id`; readiness is Stripe's `payouts_enabled`. Paid by transfer from the platform balance.
* **PayPal** — the vendor connects through Log in with PayPal, and the verified PayPal account id (`vendors.paypal_payer_id`) is stored. Payouts go to that id, never to a typed email, because PayPal cannot verify an email belongs to a live account.

Account ids are only ever obtained from the provider, never entered by the vendor.

**Timing.** Delivery sets `eligible_at` = `orders.delivered_at` + the vendor's hold period (`vendors.payout_hold_days`, default 10 days). An hourly job sends due payouts.

Statuses:

* `pending` — waiting for delivery and the hold period
* `held` — needs review, never sent automatically (`hold_reason`: `partial_refund`, `open_dispute`, `payout_method_invalid`, `manual`)
* `processing` — sent; PayPal payouts stay here until PayPal's webhook reports the result
* `paid`
* `failed` — `failure_kind` is `recipient` (the vendor's account) or `platform` (ours)
* `cancelled`

Rules applied when a payout comes due:

* The order was fully refunded or cancelled → `cancelled` (also applied to pending/held payouts before delivery).
* Any refund on the order's payment, or an open dispute → `held` for admin review. An admin releases it (optionally at a reduced amount, recorded as an adjustment in `breakdown`) or cancels it. Refunds and disputes reviewed at release don't hold it again.
* A **recipient** failure (closed/limited account, unclaimed PayPal payout) flags the vendor (`vendors.payout_method_error`): new acceptances are blocked and their other due payouts are held. Unclaimed PayPal payouts are cancelled immediately so the funds return. Once the vendor reconnects, everything failed or held for that reason is re-queued automatically.
* A **platform** failure waits for an admin retry.

Every send uses a per-attempt idempotency key (the payout uuid, suffixed by `send_attempt` after a failed attempt is re-queued), so an interrupted send is recovered without paying twice. Every payout state change is recorded as an audit event.

Vendor payouts are separate from payments because customer payments and vendor disbursements are independent financial events.

**Not yet handled:** a refund or dispute that arrives *after* a payout was paid is not clawed back automatically — it is only visible through the refund/dispute records.

---

# Shipping

Shipping is modeled separately from orders.

An order may create one or more shipments.

Shipments store:

* Carrier
* Service level
* Tracking information (tracking number, public tracking URL, raw carrier `tracker_status`)
* Destination address (the order's `address_id`)
* Parcel weight and dimensions, as packed by the vendor
* The provider's shipment id (`easypost_shipment_id`)
* Shipping lifecycle timestamps

Statuses:

* `pending`
* `label_created`
* `shipped`
* `in_transit`
* `delivered`
* `cancelled`

## Instant-Quote Shipping (EasyPost)

Orders from instant-quote projects (`projects.source = 'instant_quote'`) ship on **MakeXYZ's own EasyPost account**. Orders from manual projects are not eligible — those vendors ship on their own accounts, outside this system.

* **Origin and return address are always MakeXYZ's** (configured via `MAKEXYZ_SHIP_FROM_*` env vars), never the vendor's own address.
* **The vendor never picks a carrier service.** The customer already paid for one at checkout (`orders.shipping_method`), so the cheapest carrier rate that satisfies it is bought automatically: `ups_2day` → UPS 2nd Day Air, `ups_overnight` → UPS Next Day Air, `free` → cheapest USPS, `international_expedited` → cheapest of an allowlist of expedited international services.
* The vendor supplies only the packed parcel (weight in ounces, dimensions in inches) and, for international destinations, customs line items.
* A label can only be bought once the order is `ready_to_ship`, and an order has at most one live (non-`cancelled`) shipment at a time.

Label purchase is split into *create* then *buy* at EasyPost, with the EasyPost shipment id persisted in between (on a `pending` shipment row). If a buy succeeds at EasyPost but fails on our side, the next attempt recovers the already-bought label instead of buying a second one. A short lease on the pending row (`label_purchase_started_at`) stops two concurrent requests from buying twice.

An unscanned label (`label_created`) can be voided by the vendor: EasyPost is asked for a refund, the label records `voided_at` and `refund_status`, and the shipment becomes `cancelled` — after which a new label can be bought.

**Buying a label does not move the order.** It stays `ready_to_ship` until the carrier reports otherwise, via EasyPost tracker webhooks:

* First in-transit scan (`in_transit`, `out_for_delivery`, `available_for_pickup`) → shipment `in_transit`, order `ready_to_ship → shipped` (sets `orders.shipped_at`).
* `delivered` → shipment `delivered`, order `shipped → delivered` (sets `orders.delivered_at`) once every live shipment for the order is delivered. A `delivered` event that skipped the in-transit scans still moves the order through `shipped` first, so both status history rows always exist.

Tracker events are applied forward-only (EasyPost doesn't guarantee ordering), and never fail on a state mismatch: an order that has since moved elsewhere (e.g. `refunded`) is left alone while the shipment still records what the carrier reported.

## Delivery → Payout Trigger

Order delivery starts the vendor payout clock: the delivery transition sets the order's payout `eligible_at` (delivered_at + the vendor's hold period) in the same transaction as `orders.delivered_at` and the `shipped → delivered` status history row. The only source of delivery is an EasyPost `delivered` tracker event.

* A later full refund moves an order to `refunded` from any status, including `delivered`; the payout job checks the order's current status and cancels the payout if it hasn't been sent.
* A tracker that never reports `delivered` (lost package, carrier gap) leaves the order `shipped` and its payout `pending` without an `eligible_at`; `shipments.tracker_status` records the last carrier status so such cases can be found.
* Label cost (`shipping_labels.cost`) is MakeXYZ's cost and is not deducted from vendor payouts.

---

## Shipping Labels

Shipping labels are external artifacts generated by shipping providers.

Labels store:

* Provider information (`easypost`, the purchased rate id)
* Label URLs
* PDFs
* Label cost
* Void/refund state (`voided_at`, `refund_status`)

Separating labels from shipments allows shipping providers and labels to be regenerated or replaced without altering shipment records.

Label URLs and label cost are vendor/MakeXYZ-facing only — customers see tracking information, never the label itself.

---

# History and Auditing

## Order Status Histories

Every order status transition should be recorded.

Examples:

```text
open → accepted
accepted → in_progress
in_progress → shipped
shipped → delivered
```

These records provide:

* Operational history
* Customer support visibility
* Debugging information
* Reporting capabilities

---

## Audit Events

Audit events provide a generalized audit trail across the platform.

Auditable entities include:

* Projects
* Quotes
* Orders
* Payments
* Refunds
* Vendor payouts

Each audit event stores:

* Entity type
* Entity identifier
* Event type
* Payload
* User responsible for the change

The audit system exists to provide accountability, debugging, and historical reconstruction of important business events.

---

# Messaging

Customers and vendors talk in `conversations`. The full design, including the moderation pipeline and what is still to come, is in [plans/messaging_moderation.md](./plans/messaging_moderation.md).

**Every conversation exists because of something else.** There are no free-form DMs, and vendors can never start a conversation:

* `inquiry`: a customer account with a verified email writes to an active vendor. There's one open inquiry per (customer, vendor), and new ones are capped per day (5 for accounts under 7 days old, 20 otherwise). The vendor only sees an inquiry once its first message has been delivered. The vendor can decline it, or block the customer from sending more (which also opens a moderation case).
* `order`: opened automatically when a vendor accepts an instant-quote order (`order_acceptance_service`, after payment capture). The customer sees the vendor only as "Your manufacturer" (white-label). A reassigned order cuts the previous vendor off.
* `support`: a user and MakeXYZ staff (not yet exposed).

`conversation_participants` holds who is in a thread and how they're shown (never an email address). Customers are shown to vendors as "First L.". A guest customer (no account) appears as a participant, but must create or claim an account to read or reply.

**Messages are never edited, and every submission is kept.** `messages.seq` is gap-free per conversation, assigned under a row lock on the conversation (`conversations.last_seq`). Sends are idempotent by a client-generated `client_message_id`. Every message runs through moderation (`app/services/moderation/`) before anyone else can see it, and its status records the outcome:

```text
delivered | delivered_flagged   visible to the other side
held                             waiting on automated link/attachment analysis (usually seconds)
pending_review                   held for a person (queued in moderation_cases)
blocked                          only the sender sees it, with the reason
removed                          taken down after delivery; recipients see a tombstone
```

A `held` message is judged again by the same rules once its links and attachments have been checked (`AnalyzeMessage`, see `message_analysis_service.ts`). It then becomes delivered, flagged, `pending_review` or blocked. Nothing stays held: `SweepHeldMessages` gives anything held over 20 minutes a final pass, and whatever is still undecided goes to a person.

Each moderation pass is stored in `moderation_evaluations` (the extracted signals and every `rule@version` that ran), with one `moderation_rule_hits` row per rule that fired. Rules run in `off`, `shadow` or `enforce` mode, and `moderation_rule_configs` overrides a rule's code defaults. Admins change both at runtime (`/v1/admin/moderation/rules`).

At launch, only near-certain rules enforce:
* contact details (email, phone);
* crypto wallet addresses and bank details (checksum-validated);
* link safety (below);
* attachment checks (below);
* unambiguous prohibited items (firearm parts, other weapons, drug paraphernalia, counterfeits and fraud devices). These are blocked with a policy reason and open a `prohibited_item` case.

The rest (chat-app handles, payment-intent, advertising, spam, threats, harassment and more) run in shadow until live data shows they're precise enough to promote.

The prohibited-item word lists live in code as the baseline. `moderation_terms` (unique on `category` + `term`) holds admin changes on top of them. A row for a term not in the code list adds it. A row for a built-in term overrides it: changes its action, disables it, or annotates it. Rows are never deleted, only disabled.

Each term has an action and a status:
* **action:** `block`, `review` (the default for new slang) or `weight`;
* **status:** `active`, `shadow` (matches are recorded with no effect) or `disabled`.

The `context_allow` category adds harmless-context words (like "airsoft"), which lower a prohibited-item block to review. Terms are stored normalized, and messages are matched through the same deobfuscation as the rules, so admins enter the plain spelling.

Admins list terms with 30-day hit counts, preview a term against recent messages, and add or change terms at `/v1/admin/moderation/terms`. Every change is logged in `moderation_actions` (`term_added`, `term_updated`, `term_disabled`).

**Links.** Every link is normalized, so one URL written different ways shares one cache entry, and it's checked at send time without any network call:
* private or metadata IPs, credentials in the URL, and look-alike domains (`paypa1.com`, Cyrillic homographs) are blocked;
* links to programs or archives are blocked, with a reason telling the sender to attach the file instead.

Each link is recorded in `message_urls`. Links on the allow list are delivered at once.

Any other link holds the message until it has been analysed, unless `url_scans` already has a fresh verdict for it. Each URL is analysed once per cache lifetime, however many messages contain it:
* redirects are followed, for shorteners and unknown domains, by a fetcher that refuses private addresses;
* Google Web Risk checks the original and final URL;
* RDAP gives the domain's age.

Verdicts are cached for 30 days if malicious, 24 hours if safe, and 6 hours if unknown. A malicious link blocks the message. Without a reputation, or for a domain under 30 days old, the message goes to a person. A domain under 7 days old blocks outright when the sender is a vendor or a new account.

Allow, block and user-content (file hosting) lists are built in and overridable in `url_domains`, which also counts sightings per registrable domain and stores RDAP ages. Admins manage them at `/v1/admin/moderation/domains`, and each change is logged as `domain_list_updated`.

Links are never handed out raw. Clients get a token per link, and the frontend interstitial (`LINKS_URL/<token>`) calls `GET /v1/links/:token`, which re-checks the link at click time. Notification emails carry only these interstitial links.

Every 6 hours, `RescanRecentUrls` re-checks links sent in the last 30 days whose verdict has expired. Any that turned malicious are removed from every message containing them, and each opens a `url_rescan` case.

**Attachments** (`message_attachments`):
1. The browser uploads straight to S3 with a presigned PUT into `${S3_FILE_STORAGE_KEY}/quarantine/conversations/<conversation>/`. The size is signed into the URL.
2. The upload is confirmed (`POST .../attachments/:uuid/complete`).
3. `ScanAttachment` checks the file:
   * it waits for GuardDuty Malware Protection's result tag;
   * the bytes must match the extension, and executables and archives are rejected;
   * images are re-encoded, which strips metadata, and their QR codes are decoded;
   * PDFs with JavaScript, launch actions or embedded files are rejected, and their link targets are extracted.
4. A clean file is promoted to `${S3_FILE_STORAGE_KEY}/conversations/...`. Downloads are short-lived signed URLs, only for clean files in delivered messages.

Allowed types are images (png/jpg/webp), PDF and the 3D/CAD formats. Archives are not allowed.

Text found inside a file, such as a QR code or a PDF link, is moderated with the message, as are file names. A message whose files are still being checked is `held`. A rejected file blocks its message. With no scanner verdict (`ATTACHMENT_SCANNER=disabled`, or no result within 15 minutes) the file goes to a person, and approving the message releases the file.

`message_reports` records participants reporting messages they received; several reports on a message share one case. `moderation_actions` is the append-only log of every human decision (approve, block, remove, restrict/suspend) and rule change. `messaging_risk_profiles` holds a sender's messaging trust tier: `restricted` sends everything to review, and `suspended` blocks sending except in a thread with a live order, where it's treated as `restricted`. Tiers affect messaging only, never ordering or fulfilment.

**Behavior.** Tiers are computed hourly (`RecomputeRiskProfiles`) and right after a moderator's decision:
* `new`: an account under 7 days old or with fewer than 5 delivered messages;
* `trusted`: 60+ days, 50+ delivered messages, and no confirmed violations or reports in 30 days;
* `standard`: everyone else.

Two confirmed violations in 30 days restrict a sender automatically for 30 days. A violation is "confirmed" when a moderator upheld a block or removal; automatic blocks never count. A moderator's restriction or suspension (`tier_source = manual`) is left alone until it expires, and suspension is only ever manual.

A temporary hold (`hold_until`, 24 hours) sends everything to review and opens a `behavioral` case. It applies after more than 3 blocked messages in an hour, or when two vendors block the same customer within 30 days. It expires on its own.

The profile also caches counters for the send-time rules: delivered messages, plus confirmed violations, reports received and vendor blocks over 30 days. It also holds the sender's hourly baseline: a burst far above it opens a case.

At send time the rules also see:
* volume per hour and day;
* how many vendors a customer contacted this week;
* blocks in the last hour;
* near-duplicate text sent to other conversations (word-pair resemblance);
* how many other senders linked the same domain today.

Each day, `DetectBehaviorPatterns` opens cases for new accounts converging on one unlisted domain, and for vendors reported far more than their peers. `SampleAuditMessages` queues a small random sample of unflagged delivered messages, so moderators can find what the rules miss. Behavioral cases carry `details`, and `dedup_key` keeps them to one open case per pattern. Admins see profiles at `/v1/admin/moderation/profiles`.

**Lifecycle.** An inquiry becomes `read_only` after 60 days without messages (the customer can reopen it by posting within 90 days), or when the vendor declines or blocks. An order thread stops accepting messages as soon as its order is refunded, cancelled, reassigned, or delivered more than 14 days ago. The hourly `CloseExpiredConversations` job records that as `read_only`.

**Notifications.** A delivered message schedules one debounced email per recipient, about 3 minutes later, covering everything they haven't read or been emailed about (`conversation_participants.last_notified_seq`). Message text is only included when every message in the email is delivered, unflagged and from an established sender.

---

# End-to-End Flow

```text
Customer
↓
Project
↓
Project Files
↓
Quote
↓
Quote Items + Fees
↓
Checkout Session
↓
Payment Authorization
↓
Order (Open)
↓
Vendor Acceptance
↓
Payment Capture
↓
Production
↓
Shipment
↓
Shipping Label
↓
Delivered
↓
Vendor Payout
↓
Audit and Historical Records
```

This flow separates customer intent, pricing, payment processing, fulfillment, shipping, and vendor compensation into distinct domains while maintaining historical accuracy and supporting external integrations such as Stripe, PayPal, and QuickBooks.
