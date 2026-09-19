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

## Vendor Acceptance

After an order is created, it enters the open order pool.

Open orders are visible to vendors.

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

Rates are configured per:

* Vendor
* Material

The percentage determines how much of an order item should be paid to the vendor.

---

## Vendor Payouts

Vendor payouts represent money owed to vendors after work is completed.

Payouts store:

* Vendor
* Order
* Provider
* Provider transaction identifiers
* Amount
* Status

Statuses:

* `pending`
* `processing`
* `paid`
* `failed`

Vendor payouts are separate from payments because customer payments and vendor disbursements are independent financial events.

---

# Shipping

Shipping is modeled separately from orders.

An order may create one or more shipments.

Shipments store:

* Carrier
* Service level
* Tracking information
* Destination address
* Vendor origin information
* Shipping lifecycle timestamps

Statuses:

* `pending`
* `label_created`
* `shipped`
* `in_transit`
* `delivered`
* `cancelled`

---

## Shipping Labels

Shipping labels are external artifacts generated by shipping providers.

Labels store:

* Provider information
* Label URLs
* PDFs
* Label cost

Separating labels from shipments allows shipping providers and labels to be regenerated or replaced without altering shipment records.

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
