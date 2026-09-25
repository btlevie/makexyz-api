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

---

## Addresses

The `addresses` table stores addresses for both customers and vendors.

Addresses may be used for:

* Customer shipping addresses
* Vendor business addresses
* Vendor shipping origin addresses

The `owner_type` field identifies whether the address belongs to a customer or vendor. An owner may have many addresses (e.g. a "Personal" and a "Business" one, distinguished by `label`), with at most one marked `is_default` at a time. A quote's shipping address is either selected from the customer's existing addresses or created new during quote configuration (see Quotes below) — a newly-created one starts unowned (`customer_id: null`) if the project has no resolved customer yet, and is backfilled once checkout resolves one.

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
