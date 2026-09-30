> Approved plan, not yet implemented. Companion plan: [manual_quotes.md](./manual_quotes.md).

# MakeXYZ customer/vendor messaging: architecture and moderation plan

## Context

MakeXYZ needs a way for customers and vendors to talk about an order. The main risk isn't building chat. It's stopping four kinds of abuse:
- **Disintermediation:** users swapping contact details or taking payment off-platform.
- **Advertising and spam.**
- **Malicious URLs and attachments.**
- **Harassment.**

All of this has to work without sending every message to an LLM. This document is the architecture and phased plan. No code has been written.

**Two flows share one messaging system** (confirmed with you):
1. **Inquiry → manual quote → order.** In the current (legacy) application, anyone can message a vendor (a printer). The conversation can lead the vendor to build and send a manual quote (`projects.source = 'manual'` already exists), which becomes an order outside the instant-quote flow. The manual-quote/order mechanics get **their own plan**. This plan supplies the conversation substrate they attach to. Decisions already made:
   - Only **signed-in customer accounts** can start an inquiry. Guests can't.
   - Vendor identity (a public profile with `vendors.display_name`) is **visible in this flow**.
   - **Vendors can only reply.** They can never start a conversation with a customer.
2. **Instant-quote orders.** Once a vendor accepts a routed order, the customer and the vendor get a thread. **The vendor stays white-label here**: `OrderTransformer` exposes no vendor fields, and the order came from the routing pool (`order_routing_service`, `VendorOrdersController#accept`).

**What this means for risk:**
- **Inquiries are the only place conversations start from nothing**, so cold spam and advertising aimed at vendors concentrate there. Examples: web/SEO agency pitches, fake RFQs carrying phishing "view my drawing" links, competitors recruiting vendors.
- **Disintermediation risk peaks in the inquiry and quote phase.** A vendor who knows a customer found them on MakeXYZ, and who is about to price a job by hand, has the strongest incentive to say "pay me directly and skip the fee". Payment-intent rules matter most in that phase.
- **In instant-quote order threads, identity leakage is asymmetric.** The vendor sees the customer's shipping address (`vendor_orders_controller.ts` preloads `address`), but the customer doesn't know the vendor. The worst case there is vendor→customer ("order direct next time").

**What the codebase already tells us** (these facts also shape the design):
- **Guest customers have no login.** A `customers` row has `user_id = null` and only an email (DATABASE_FLOW, "Guest customers"). Guests can't open inquiries, and **they must claim an account to read or reply in their order thread** (D3). Until they do, they get a notification email with a call to action to claim or create their account (no body, since we can't authenticate them), using the existing guest-claim flow.
- **Accounts have no email verification.** `users` has no verified flag, and `POST /v1/auth/signup` is open. So "accounts only" still lets someone create throwaway accounts cheaply. **Verified email before a first inquiry** is a prerequisite (D12). The signed-link mechanism from `guest_claim_service` can be reused for it.
- **Infrastructure already in place:**
  - SES (outbound, `config/mail.ts`), S3 (`@adonisjs/drive`) and SQS (`sqs_service.ts`), all using the default AWS credential chain.
  - A DB-backed `@adonisjs/queue` with a scheduler (`config/queue.ts`, `start/scheduler.ts`).
  - `@adonisjs/limiter` with a DB store (`start/limiter.ts`).
  - `@adonisjs/transmit` SSE with per-channel authorization (`start/transmit.ts`).
  - A webhook idempotency pattern (`webhook_event_service.ts`).
  - An `audit_events` table.
  - Admin role checks on the `/v1/admin` group.
- **Order lifecycle:** `open → accepted → in_progress → ready_to_ship → shipped → delivered`, plus `rejected`, `refunded` and `cancelled`.

Together these make the recommended design cheap. It needs **no new infrastructure tier**: no Redis, no Kafka, no separate chat service.

---

## 1. Messaging architecture

**Decided:** messaging is **in-app**. MakeXYZ holds the canonical conversation, and all moderation happens in our API. Email is **not** relied on for abuse prevention. It serves two purposes:

1. **Notifications (in scope).** An email tells a participant there's a new message. Notifications are debounced, skipped if the user is online, and sent through the existing SES mailer.
   - **Notifications include the moderated message text** (D5), but only for messages that are `delivered` (not `delivered_flagged`) and come from `standard` or `trusted` senders.
   - Flagged messages, messages from `new` or `restricted` senders, and every notification to a guest carry **no body**: "New message on Order #1234 / your inquiry to <vendor>" plus a link.
   - This keeps content that might later be removed out of inboxes. Links in any included body are rewritten to the click-through interstitial.
2. **Reply-by-email (to explore; see Step 5 and section 11).** The recipient hits Reply and the text is posted into the thread.
   - Technically it's **just another input channel into the same moderation pipeline** as the web composer. It gets no special trust.
   - What it adds is convenience and reach: vendors and customers who live in their inbox can reply without opening the app. Only account holders can use it; guests must claim an account first.
   - What it costs:
     - MIME parsing and stripping quoted history and signatures. Business email signatures routinely carry phones and websites, so stripping is a moderation issue, not only a UX one.
     - Sender verification (alias + DMARC).
     - Loop and autoresponder handling.
     - An inbound SES / DNS setup.
   - **Recommendation:** build the in-app system and notifications first. Design the data model so email is an additional `channel` from day one (`messages.channel`, `inbound_emails`, per-participant reply aliases). Then run a **spike** before committing: a staging `reply.` subdomain, SES inbound, and a fixture corpus of real replies from Gmail, Outlook and Apple Mail. Measure how reliably replies and signatures can be stripped. Ship it only if stripping is reliable enough that most email replies aren't escalated.

No message reaches another party without passing moderation, whichever channel it arrived on.

### Conversation model and scope

Who may start a conversation is restricted, and each kind of conversation has a fixed starter:

| Kind | Started by | Participants | Vendor identity shown to the customer |
|---|---|---|---|
| `inquiry` | A **customer account** with a verified email, addressing an **active** vendor that accepts inquiries (via the vendor profile the separate plan defines) | That customer, that vendor, and staff | The vendor's `display_name` only. Never their email, phone, website or legal name |
| `order` | The system, when a vendor accepts an instant-quote order (`order_acceptance_service`) | The order's customer (account or guest), the assigned vendor, and staff | Pseudonymous: "Your manufacturer (MakeXYZ partner)" |
| `support` | A customer or vendor, addressed to MakeXYZ only | That user and staff | — |

- **No other path exists.** There's no user-to-user DM, no vendor→customer start, and no vendor→vendor messaging. Users with the vendor role can't open inquiries.
- **An inquiry grows into a deal on the same thread.**
  - When the vendor creates a manual project or quote from an inquiry, the conversation gains `project_id`, and later `order_id` when the quote is paid. Those are designed in the separate plan.
  - Quote events show up in the thread as `system` / `quote_ref` messages, so context is never split across threads.
  - This also gives moderation the most important context signal: **the phase of the deal** (`inquiry` → `quoted` → `ordered` → `fulfilled`).
- **Instant-quote order threads:** one per (order, assigned vendor).
  - If the order is re-routed to another vendor, the old thread closes and the new vendor gets a fresh one. A vendor never sees messages from before their assignment.
  - A vendor in the open pool with pre-acceptance questions asks MakeXYZ through `support`, never the customer.
- **Limits on inquiry creation** (anti-spam, enforced in the service):
  - one open inquiry per (customer, vendor) pair, with further questions going on the same thread;
  - a daily cap on new inquiries per customer, tighter for the `new` tier;
  - the first message must reference work: a subject plus a description.
- **Vendor controls on an inquiry:**
  - **Decline** ("not a fit"), which makes it `read_only`.
  - **Report and block the customer**, which blocks that pair permanently and opens a case.

  A high decline or report rate against a customer is a strong behavioral signal.
- **The customer is shown to the vendor** as first name + last initial in every kind of thread.
- **Neither side ever sees the other's email address.** The reply-to address is always a per-participant alias.

### Inquiry lifecycle

| State | Conversation |
|---|---|
| Created, no quote yet | `open`. Goes `read_only` after **60 days** without a message. The customer can reopen it within 90 days by posting |
| Vendor declined / vendor blocked the customer | `read_only` |
| Manual quote sent or accepted | `open`; the lifecycle then follows the separate manual-quote plan |
| Manual order exists | Follows the order rules in the next table |
| Vendor suspended | `read_only` for new inquiries. Threads with a live order stay open |

### Order-thread lifecycle (instant-quote orders, and manual orders once an order exists)

| Order state | Conversation |
|---|---|
| `accepted` → `ready_to_ship` | `open` |
| `shipped` | `open` (delivery questions) |
| `delivered` | `open` until `delivered_at + 14 days` (the defect/dispute window; configurable), then `read_only` |
| `cancelled`, `refunded`, `rejected`, vendor reassigned | `read_only` immediately. Staff can still post |
| 180 days after `read_only` | `archived`: hidden from default lists. Kept for dispute evidence and pattern discovery |

- `read_only` means participants can read but not send. Email replies to a closed conversation's alias get one polite auto-response per sender per day, sent only if the mail passes DMARC, pointing to support.
- Aliases expire at `read_only + 30 days`. After that, mail to the alias is silently dropped (bounced at the SES rule), so we never create backscatter.
- A closed conversation *should* matter to moderation. A vendor messaging after delivery is the classic "for your next order…" pattern. Messages sent close to closure get stricter advertising and contact rules (see the `context.post_fulfilment` rule).
- **In inquiry threads, a repeat customer is legitimate.** A new inquiry to the same vendor is the on-platform way to do repeat business, so the vendor can say "send me a new inquiry any time". It gives the vendor a legitimate path and removes much of the incentive to leave.

### Message lifecycle (states)

```
draft (client) → submitted → [sync pipeline] ─┬─ delivered
                                             ├─ delivered_flagged   (visible; async review queued)
                                             ├─ held                (awaiting async automated analysis: URL, attachment, LLM)
                                             ├─ pending_review      (awaiting a human)
                                             └─ blocked             (sender sees it with a reason; recipient never does)
held → delivered | pending_review | blocked
pending_review → delivered | blocked
delivered / delivered_flagged → removed   (moderator retraction; recipient sees a "removed by MakeXYZ" tombstone)
```

- Messages are **never edited**. Editing a message after moderation is a well-known bypass. Senders may withdraw a message only while it's `held` or `pending_review`.
- Every submission is persisted, **including blocked ones**. Blocked messages are the raw material for finding new abuse patterns (section 6).

### Ordering, threading, duplicates, retries, idempotency

- **Ordering:** a per-conversation integer `seq` is assigned inside the insert transaction. A row lock on `conversations` (`SELECT … FOR UPDATE`, incrementing `last_seq`) makes it gap-free and total. Messages are ordered by `seq`, never by timestamp: email `Date` headers are untrusted and email replies arrive late. A held message keeps its original `seq`, so once approved it appears where it was sent, marked "delivered after review".
- **In-app idempotency:** the client generates a `clientMessageId` (UUID) for each send. It's unique on `(sender_participant_id, client_message_id)`, so a retried POST returns the existing message instead of creating a duplicate. This is the same idea as the webhook idempotency guard.
- **Inbound email idempotency:**
  - The SES `mail.messageId` is unique in `inbound_emails`, which covers SNS redelivery and replays.
  - A second check on the RFC `Message-ID` header per conversation catches the same mail arriving via two paths (Cc'd twice, re-sent).
- **Outbound email threading:**
  - Every notification email carries a stable `Message-ID: <msg-{uuid}@reply.makexyz.com>`.
  - It also sets `In-Reply-To` / `References` to a per-conversation root id and uses a stable subject: "Order #1234: new message". Mail clients thread these naturally.
  - We don't *need* `In-Reply-To` for routing. Routing is done by alias. The header is only a cross-check.
- **Notification retries:**
  - `conversation_participants.last_notified_seq` is advanced under a row lock by the notification job.
  - A retried job either sees nothing new or sends the same batch again. That's an acceptable edge case; at most one duplicate email.
  - Notifications are **debounced**: the first undelivered message schedules a job about 3 minutes out, and that job sends one digest of everything since `last_notified_seq`. Users who are online (active SSE subscription or read recently) get no email.

---

## 2 and 3. The moderation pipeline and the rule architecture

### Principles

1. **Extract, then decide.** Extractors turn text into typed *signals* (emails found, phones, URLs, platform names, payment terms, fingerprints). Rules make decisions from signals plus context. Extractors are shared, so rules stay small.
2. **Explicit decisions from high-precision rules. Scores only for routing.**
   - A rule may **block** only when it's precise enough that a moderator would agree more than about 98% of the time.
   - Weak signals (promotional words, a new account, an unknown domain) never block on their own. They add weight to a **risk score whose only job is to decide escalation**: deliver, flag for later review, hold for LLM, or hold for a human.
   - This hybrid is deliberate. Pure scoring is opaque, hard to explain to moderators and users, and drifts silently. Pure explicit rules can't combine several weak signals. The rule is: **scores route, rules and humans decide.**
3. **Direction-aware and context-aware.** The same rule gets different thresholds depending on:
   - direction (vendor→customer is stricter);
   - sender trust tier;
   - channel (email replies get extra rules for signature remnants);
   - conversation phase (post-delivery is stricter on advertising).
4. **Everything is recorded:** which rules ran, which fired, rule and config versions, the evidence spans, and the final decision along with who or what made it.

### Pipeline stages

| # | Stage | Where | Cost | Output |
|---|---|---|---|---|
| 0 | Validation: auth, participant, conversation open, length ≤ 4,000 chars, attachment count, rate limits | Sync, in request | ~1 ms | Reject 4xx (not a moderation event) |
| 1 | Normalization: NFKC, strip zero-width and bidi controls, confusables skeleton (UTS #39), lowercase, leet map (`0→o`, `3→e`, `@→a`…), collapse spaced letters (`g m a i l`), number words to digits (`five five five` → `555`), URL de-obfuscation (`hxxp`, `[.]`, `(dot)`, ` dot `) | Sync | <1 ms | Several **views**: `raw`, `normalized`, `digitsOnly`, `deobfuscated` |
| 2 | Extractors run over all views: email, phone (libphonenumber, all regions + digit-run fallback), URL and bare domain, social handle (`@name`, "IG: name"), platform lexicon, payment lexicon, crypto addresses (BTC/ETH/SOL/TRON with checksum validation), IBAN/routing numbers, profanity, promotional lexicon, injection lexicon, exact and near-duplicate fingerprints | Sync | ~1–5 ms | `signals` object |
| 3 | Sync behavioral lookups: per-sender counters and recent history (section 5) | Sync, a few indexed DB reads | ~5–15 ms | `behavior` object |
| 4 | Local URL verdicts: allowlist and blocklist, cached reputation, shortener list, TLD risk, IDN/homograph check, dangerous extension (section 2a) | Sync, DB + in-process | ~2–5 ms | Per-URL `known_good` / `known_bad` / `unknown` |
| 5 | Sync rule evaluation, then combine | Sync | <1 ms | A decision |
| 6 | Async enrichment: remote URL reputation, redirect resolution, RDAP domain age, attachment scan, QR/OCR on images | `AnalyzeMessage` job | 100 ms–10 s | Re-run the rules with the enriched signals |
| 7 | LLM contextual classification, **only when escalated** | `AnalyzeMessage` job | ~1–3 s, ~$0.003–0.02 | A structured verdict |
| 8 | Human review | Admin queue | Minutes to hours | The final decision, which also becomes a label |

### Combining rule results

Each rule returns `null` (didn't fire) or a result: `{ action, reasonCode, severity, weight, evidence[], userMessage? }`. The possible actions are:

- `block`: deterministic and certain.
- `review`: hold for a human.
- `escalate`: hold for the async stage and the LLM.
- `flag`: deliver now, then queue an async review.
- `allow_override`: a narrow "known safe" exception, such as an allowlisted domain. It only suppresses the specific rules it names.
- `continue`: contributes `weight` to the score only.

The combiner applies precedence: **block > review > escalate > flag > allow**. Then the score routes the case:
- score ≥ `review_threshold` → `review`;
- score ≥ `escalate_threshold` → `escalate`;
- score ≥ `flag_threshold` → `flag`.

The thresholds are set per trust tier. `allow_override` can never cancel a `block` from a different rule.

### Rule plugin architecture

```
app/services/moderation/
  pipeline.ts                  # orchestrates stages; pure apart from injected lookups
  normalizer.ts
  extractors/{email,phone,url,handle,platform,payment,crypto,fingerprint,profanity,promo,injection}.ts
  rules/
    index.ts                   # the ONLY shared file touched when adding a rule: one import line
    contact_email.ts           # one rule per file
    contact_phone.ts
    ...
  rule_registry.ts             # loads rules, merges DB config over defaults, caches for 60 s
  combiner.ts
  types.ts                     # ModerationRule, RuleContext, RuleResult, Signals
```

The rule interface (conceptual, not code to write yet):
- `id`: a stable slug, e.g. `contact.phone`.
- `version`: an integer, bumped whenever the logic changes.
- `stage`: `'sync' | 'async'`.
- `appliesTo`: `{ channels?, directions?, conversationKinds? }`.
- `defaultConfig`: typed thresholds and word lists, with a small VineJS schema to validate DB overrides.
- `evaluate(ctx: RuleContext, config): RuleResult | null`. This must be a **pure function**: no I/O. All lookups are done beforehand and passed in through `ctx`, which is what makes rules trivially testable and replayable.

Operational controls live in the `moderation_rule_configs` table, one row per rule:
- **Mode:** `off | shadow | enforce`. In shadow mode the rule runs and its hits are recorded with `shadow = true`, but it has no effect on the decision. **Every new rule ships in shadow mode first.** Its precision is measured against human labels and replayed history before it's promoted.
- **Config overrides**, such as thresholds, with a `config_version` that increments on every change. Every change is logged to `moderation_actions` with the actor.
- **Versioning:** each evaluation stores `rule_id@version` plus `config_version`, and a `pipeline_version` (build SHA, or a constant bumped on normalizer or extractor changes). Any past decision can therefore be explained exactly.
- **Logging:** only fired rules get a row (`moderation_rule_hits`). The evaluation row lists every `rule@version` that ran, which answers "which rules were checked and didn't fire?" without storing a row per rule per message.
- **Tests:**
  1. Each rule has a unit spec with positive and negative fixtures. Rules are pure, so this fits the existing `tests/unit/**` suite, which currently has no specs.
  2. There's a **labelled corpus** (`tests/fixtures/moderation/corpus/*.jsonl`) of anonymized real examples plus adversarial variants. A regression spec runs the whole sync pipeline over it and asserts each expected decision.
  3. A precision gate: a rule may not move to `enforce` if it fails any corpus "should allow" case.

### Initial rule catalog

**Contact info and off-platform communication**

| Rule | Fires on | Default action |
|---|---|---|
| `contact.email` | An email address in any view (including `name at gmail dot com`) | **block**, with a user-facing reason ("Sharing contact details isn't allowed; use this thread") |
| `contact.phone` | A valid phone number (libphonenumber), or a 10+ digit run in `digitsOnly` that isn't an order number, dimension or quantity (context exclusions: next to `mm`, `x`, `qty`, `#`, known order-number pattern) | block if it validates; escalate on a digit-run-only match |
| `contact.platform_handle` | A platform name (Discord, Telegram, WhatsApp, Signal, WeChat, Skype, Instagram, FB/Messenger, X, LinkedIn, Snap, TikTok, Line, Viber, Kik…) **near** a handle, number or invitation (`discord.gg/`, `t.me/`, `wa.me/`) | block on an invite URL or a handle next to a platform name; escalate on a bare platform mention |
| `contact.solicitation` | Phrases such as "text me", "call me", "email me directly", "reach me at", "my number is", "DM me", "find me on" | escalate (context matters) |
| `contact.obfuscation_attempt` | A contact signal that shows up only in a de-obfuscated view, not in `raw` | Upgrades the paired contact rule by one level (escalate→block). Obfuscating is itself strong evidence of intent |

**Off-platform transactions**

| Rule | Fires on | Default action |
|---|---|---|
| `payment.offplatform_method` | PayPal, Venmo, Cash App, Zelle, wire, bank transfer, Wise, Revolut, check/cheque, "cash" | **continue with weight only.** MakeXYZ itself uses PayPal and Stripe, so "I paid with PayPal" is legitimate |
| `payment.direct_intent` | Payment term **plus** direct-intent phrasing ("pay me directly", "outside the platform", "skip the fees", "cheaper if we…", "invoice you myself", "next order directly") | review (vendor→customer: block if paired with any contact signal) |
| `payment.crypto_address` | A checksum-valid crypto address, or a seed-phrase-shaped list of 12/24 BIP-39 words | **block** |
| `payment.bank_details` | A checksum-valid IBAN, a SWIFT/BIC plus account number, or routing + account digits | **block** |
| `payment.fee_avoidance` | "avoid (marketplace/platform) fees", "save the commission", "cut out the middleman" | review |

**Advertising and spam**

| Rule | Fires on | Default action |
|---|---|---|
| `ad.promo_language` | Promotional lexicon ("check out my", "% off", "promo code", "limited time", "we also offer", "visit our store", "follow us") | continue with weight. Escalate if a URL is also present or the message doesn't reference the order |
| `ad.unrelated_url` | Any URL whose domain is not on the allowlist, sent vendor→customer. A white-label vendor in an order thread has no legitimate reason to send links. An inquiry vendor may occasionally link a material datasheet or process guide, which the allowlist covers | escalate. Block if the domain is unknown **and** promo language is present, or if it matches the vendor's own website domain (captured privately from onboarding) |
| `spam.duplicate_cross_conversation` | The same normalized-text hash, or a near-duplicate (SimHash Hamming distance ≤ 3), sent by this sender to ≥ 3 conversations in 24 h, **or** by ≥ 3 distinct senders. **Exception:** a customer sending the same RFQ to several vendors is legitimate comparison shopping. Duplicate *first messages of inquiries* only fire when combined with a URL, promo weight, or no work-context terms. The separate plan may add a first-class "request quotes from several vendors" action that makes this explicit | review; block once confirmed by a human-labelled prior |
| `inquiry.cold_pitch` | First message of an inquiry that pitches a service to the vendor instead of requesting work: promo weight + "your business", "your website", "SEO", "leads", "partnership", "we help manufacturers" + no part/material/quantity terms | escalate. Review if a URL is present |
| `payment.quote_phase_direct` | In inquiry or quoted phase: vendor→customer talk of pricing combined with "invoice", "direct", "outside", "no fee", "cheaper if", "my own site", or a payment method | review (block if a contact signal is also present) |
| `spam.same_url_fanout` | The same registrable domain sent by this sender to ≥ 3 conversations in 24 h | review |
| `context.post_fulfilment` | Vendor→customer after `delivered` containing a URL, promo language or a "future work" phrase ("next time", "future projects", "my other services") | escalate |
| `context.off_topic_commercial` | Promo weight with no order-context terms (material, print, part, file, delivery, tolerance…) | escalate (LLM decides) |

**Other**

| Rule | Fires on | Default action |
|---|---|---|
| `url.*` | Output of the URL pipeline (section 2a): known-bad → block; unknown → escalate (hold); dangerous extension → block | as stated |
| `attachment.*` | Disallowed type, extension/magic-byte mismatch, executable, macro, encrypted archive, scan failure | block / hold |
| `abuse.threat_lexicon` | Threat phrases ("I will find you", "you'll regret", doxxing language) | review |
| `abuse.harassment_candidate` | Profanity directed at the recipient (profanity + second-person pronoun within N tokens), or slurs | escalate (slurs → review) |
| `profanity.general` | Any profanity (via library) | **continue with a small weight only.** Never blocks |
| `llm.injection_text` | "ignore previous instructions", "system prompt", "you are an AI", role-tag strings | continue with weight, and forces escalation to use the hardened prompt path. Not a block: it's rare in legitimate messages, but not a violation in itself |
| `email.signature_remnant` | Email-channel only: contact signals in the last N lines after the reply parser ran | Redact the signature block instead of blocking the message (see section 11). This is the only rule with a `redact` action |

The sender gets feedback on a block:
- **Policy violations** (contact info, payment details) show the specific reason. Most violators are legitimate users who don't know the rule.
- **Spam, scam and malicious-URL blocks** show a generic "This message couldn't be delivered". Giving adversaries the exact rule helps them probe it.
- Repeated blocked attempts are themselves a behavioral signal (section 5), which blunts probing.

### 2a. The URL-analysis pipeline

URLs are handled as structured objects with their own lifecycle, not as text.

1. **Extraction** (`extractors/url.ts`):
   - Uses `linkify-it` with a full TLD list, run on `raw` and `deobfuscated`.
   - Catches scheme-less domains (`example.shop/deal`), `hxxp(s)`, `[.]`, `(.)`, ` dot `, `[:]//`, full-width dots, and URLs split across lines.
   - Also pulls links from email HTML `href`s. The displayed text is compared with the actual target; a mismatch is a signal.
   - Pulls links from PDF attachments and from QR codes decoded out of images (step 9).
2. **Normalization:**
   - Lowercase the scheme and host.
   - IDNA to punycode (UTS #46).
   - Strip the default port, `userinfo@`, the fragment, and tracking params (`utm_*`, `fbclid`, `gclid`).
   - Percent-decode unreserved characters. Collapse dot-segments and repeated slashes.
   - Resolve the **registrable domain** (eTLD+1) using the Public Suffix List (`tldts`).
   - Key the result as the SHA-256 of the normalized URL.
3. **Static checks (sync):**
   - An IP-literal host, whether decimal, octal, hex or IPv6, is suspicious. A private or reserved IP is blocked.
   - Mixed-script or confusable labels are checked by comparing the UTS #39 skeleton against the allowlist and a top-brand list, so `paypaI.com` or `makexуz.com` (Cyrillic у) → block.
   - `@` in the authority, an excessive subdomain depth, or a data:, javascript: or file: scheme → block.
   - A dangerous path extension (`.exe`, `.scr`, `.msi`, `.apk`, `.dmg`, `.js`, `.vbs`, `.bat`, `.ps1`, `.jar`, `.iso`, `.lnk`, `.hta`, `.zip`/`.rar`/`.7z` from an unknown domain) → block.
   - A known **shortener** (bit.ly, tinyurl, t.co, rebrand.ly, goo.su…) is always resolved in the async stage, and the message is held.
   - The TLD is compared against a configurable high-abuse TLD list; a match adds weight.
4. **Lists (sync):** the `url_domains` table holds `list_status` `allow`, `block` or `none`, set by moderators or seeded.
   - **Seed an allowlist** of legitimate manufacturing and 3D-printing domains: Thingiverse, Printables, MyMiniFactory, Cults3D, GrabCAD, Onshape, Autodesk/Fusion, McMaster-Carr, Prusa, Bambu Lab, Formlabs, Ultimaker, material manufacturer datasheet sites, and carrier tracking (UPS, USPS, FedEx, DHL). Also makexyz.com itself.
   - These are domains a *customer* plausibly sends ("here's the model on Printables"). **An allowlist match removes the "unknown URL" hold, but it doesn't bypass contact or ad rules.** Thingiverse and Printables have user profile pages, so a vendor linking to *their own* Printables profile is an advertising or disintermediation vector.
   - The rule `ad.unrelated_url` therefore still applies vendor→customer, and profile-shaped paths (`/@user`, `/social/…`, `/user/…`) on allowlisted sites escalate.
   - **A third list status, `user_content`**, covers file-sharing and hosting domains: Google Drive/Docs, Dropbox, OneDrive/SharePoint, WeTransfer, Box, GitHub, and the model repositories' profile areas.
     - Customers in inquiries legitimately send "here's my CAD on Drive", so these domains aren't treated as suspicious.
     - But they're also the top phishing carrier ("view the drawing"), and the domain says nothing about the content. So a `user_content` URL is **never auto-allowed**. It always gets a per-URL Web Risk check, and the message is held until that check returns.
     - Customer→vendor file links are delivered once clean. Vendor→customer file links escalate.
     - The product nudge is to use in-platform attachments for CAD files, which get scanned.
5. **Reputation cache (sync read, async write):** `url_scans`, keyed by the normalized-URL hash, stores the verdict, threat types, final URL, redirect chain and `expires_at`.
   - Cache lifetimes: known-bad 30 days; `safe` from Web Risk 24 h (or the API's own `expireTime`); unknown 6 h.
   - The domain-level `url_domains` row carries the aggregate: first seen, seen count, distinct senders, RDAP registration date.
   - Each URL is analysed remotely **once per TTL, however many messages contain it**.
6. **Remote reputation (async, only for URLs not already cached):** Google Web Risk `uris.search` for MALWARE, SOCIAL_ENGINEERING and UNWANTED_SOFTWARE. Optionally Spamhaus DBL/ZRD over DNS for newly observed domains (section 12).
7. **Redirect resolution (async)**, done by a **hardened fetcher** (`safe_url_fetcher.ts`) and only for shorteners or unknown domains:
   - `HEAD`, falling back to `GET` with `Range: bytes=0-0`. At most 5 hops, 3 s per hop, 8 s total, and a 256 KB body cap. No cookies, no JavaScript. A fixed user agent.
   - **SSRF controls:**
     - Resolve DNS ourselves and validate **every resolved IP** (v4 and v6) against private, loopback, link-local, CGNAT, multicast and metadata ranges (169.254.169.254, fd00:ec2::254) *before connecting*.
     - Connect to the validated IP with the SNI/Host header set, which prevents DNS-rebinding TOCTOU.
     - Re-validate on every redirect hop. Allow only http/https on ports 80 and 443.
     - Treat a redirect to a private IP as a **malicious verdict**, not just an error.
   - Run the fetcher outside the API task if possible: a small Lambda or separate ECS task with **no IAM role and egress-only networking**. If it has to run in-process at first, it must use the connect-time IP check, and the ECS task role must never be reachable. IMDSv2 hop-limit 1 is already the ECS default for awsvpc; verify this.
   - Every hop's host goes back through steps 2–6. The **final** domain's verdict is the URL's verdict.
   - Scanner-attack mitigation: strict timeouts, byte caps, a concurrency cap on the `url` queue, per-domain fetch rate limits, and never parsing the body beyond a `<meta refresh>` check.
8. **Domain age (async):** an RDAP lookup against the IANA bootstrap (free, standard), cached on `url_domains.registered_at`.
   - A domain younger than 30 days and not allowlisted → review.
   - Younger than 7 days → block when the sender is vendor→customer or the account is new.
9. **Images and QR codes (async, attachments only):** decode QR codes (e.g. `zxing-wasm` or `jsQR` on a `sharp`-decoded bitmap). Any decoded URL goes through this same pipeline. OCR only on escalation, via LLM vision or Rekognition `DetectText`, not by default.
10. **Adult, obscene and illegal-content categories:** Web Risk doesn't classify content categories. Rather than fetching and rendering pages ourselves (expensive and risky), the policy is:
    - vendor→customer: any non-allowlisted URL is held, so the categories matter less;
    - customer→vendor: unknown domains are escalated to the LLM with the URL string and the redirect chain only, never page content;
    - if volume ever justifies it, add a sandboxed scanner (urlscan.io or Cloudflare URL Scanner) for escalated URLs only.
11. **Retroactive re-scan:** a scheduled `RescanRecentUrls` job re-checks URLs sent in the last 30 days whose cache has expired.
    - If a URL flips to malicious (common with phishing: a clean domain is weaponized later), every message containing it is found via `message_urls`, automatically `removed`, and a case is opened.
    - The links in delivered messages are rendered through a **click-through interstitial** (`/v1/links/:token` → a "you're leaving MakeXYZ" page that re-checks the verdict at click time). That makes later takedowns effective even for messages already read. Emails contain only the interstitial link, never the raw URL.

---

## 4. LLM usage

### When the LLM is called

The LLM is called only when a message has status `held` because the combined decision was `escalate`. Typical triggers:
- ambiguous contact or payment signals (a bare platform mention, a digit run, a payment term without direct intent);
- `context.*` rules: post-fulfilment vendor messages, off-topic commercial content;
- promo weight plus a URL, or an unknown domain from customer→vendor;
- harassment candidates (profanity + second person), threat-adjacent phrasing;
- a behavioral anomaly: a new account, sender volume above baseline, or a sender with recent blocks, sending anything non-trivial;
- a risk score in the escalate band;
- email-channel messages where the reply parser had low confidence (a large unparsed quoted block).

### When it isn't called

- Clean messages: no signals and a score below the flag threshold. That should be about 95% of traffic.
- Anything already `block`ed by a deterministic rule. The LLM can never un-block.
- Known-bad URLs and attachments.
- A duplicate of an already-labelled message (same hash): the prior decision is reused.
- Senders in the `restricted` tier. Everything they send goes straight to a human, so an LLM verdict adds nothing.
- As a per-sender budget guard: at most N LLM calls per sender per hour. Beyond that, send to review. This stops an attacker from farming LLM spend.

### Context given to the LLM

The context is minimal and pseudonymized:
- **The current message:** the normalized text, the extracted signals, and the URL analyses (domain, age, verdict, redirect chain).
- **The last 10 delivered messages** in the conversation, labelled by role (`CUSTOMER` / `VENDOR` / `STAFF`) with relative timestamps. Messages that were blocked or removed are shown as `[message withheld: reason=contact.email]` so the model sees attempts without the content.
- **Conversation and deal state:**
  - the kind (`inquiry`, `order`, `support`);
  - the **deal phase** (inquiry with no quote / quote sent / quote accepted / ordered / shipped / delivered);
  - days in the current phase;
  - technology and material;
  - direction;
  - whether this is the first message of an inquiry.

  Deal phase matters most for manual-quote threads: "can we sort out payment another way?" before a quote is sent is the textbook fee-avoidance pattern.
- **The sender's profile:** role, account age in days, trust tier, messages sent, blocks in the last 30 days, confirmed violations, reports received, and for vendors, vendor tenure.
- **The rules that fired**, and why the message was escalated.
- **Never sent:** names, emails, addresses, phone numbers, company names, order totals, or the recipient's profile.

The phrase "Maybe there's another way we can work together?" shows why context matters:
- In a conversation about print-orientation trade-offs, the model sees an on-topic thread and allows it.
- From a vendor two days after delivery, following an earlier `contact.email` block, the same phrase is a disintermediation pattern and goes to review.

The deterministic layer can't tell these apart, which is exactly why the LLM is reserved for this band.

### Output (structured, schema-constrained)

- `categories[]`, each with `{category, confidence 0–1}`. Categories are: off_platform_contact, off_platform_payment, advertising, spam, scam_phishing, harassment, threat, sexual, other_violation, none.
- `recommended_action`: `allow | review | block`.
- `rationale`: at most 300 characters, shown to moderators.
- `evidence_quotes[]`.

How the verdict is applied:
- `allow` with confidence ≥ 0.85 → delivered.
- `block` with confidence ≥ 0.95 **and** a category in {scam_phishing, off_platform_payment, off_platform_contact, spam} → blocked.
- Everything else → human review. Harassment and threats always go to human review rather than an auto-block.

### Prompt injection defence

- User content is placed in data blocks with random per-request delimiters. Any delimiter-like strings in the content are escaped.
- The system prompt states that the content is untrusted data to be classified, never instructions.
- **No tools** and structured output only, so injected text can't exfiltrate data or take any action. The worst it can do is influence its own verdict.
- The LLM cannot override deterministic blocks, and it can only *allow* messages with no hard signals. So the most a successful injection achieves is "allow a message that was merely ambiguous". The async post-delivery sampling and user reports catch that.
- `llm.injection_text` makes injection attempts visible: the message goes to human review, not auto-allow, even if the LLM says allow.
- The schema output is validated. Anything malformed, a refusal, or an error means human review. The system fails closed for held messages.

### Model choice and cost

See decision D6. Prices per 1M input / output tokens (Bedrock on-demand matches the Anthropic list price):

| Model | Price |
|---|---|
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1 / $5 |
| Claude Sonnet 5 (`claude-sonnet-5`) | $2 / $10 |
| Claude Opus 5 (`claude-opus-5`) | $5 / $25 |

**Decided: Claude Sonnet 5 on Bedrock** (D6). A typical call is about 2.5K input tokens (roughly 1.2K of it a cacheable system prompt) and about 200 output tokens. That comes to roughly $0.002 on Haiku, $0.005 on Sonnet 5 and $0.012 on Opus 5 per escalation, before prompt-cache savings on the system prompt.

At 100K messages/month and a 5% escalation rate, 5K calls cost about **$10–60/month**. Offline work (pattern-discovery summaries, replaying a new prompt over the corpus) is small and weekly, so it uses ordinary on-demand calls. Bedrock's own batch-inference jobs (S3 in, S3 out, and likewise discounted) are an optional later optimization if replay volume grows. Held messages always use on-demand calls, because they're latency-sensitive.

---

## 5. Behavioral detection

The key question is which signals must be computed before delivery and which can wait.

| Signal | Sync (pre-delivery) | Async | How |
|---|---|---|---|
| Messages per minute, hour and day per sender | ✓ | | `@adonisjs/limiter` keyed `msg:{principal}` (existing DB store). Hard 429 at the cap. Soft thresholds feed rules |
| Distinct conversations messaged in 24 h | ✓ | | Indexed count on `messages(sender_principal, created_at)` |
| Inquiries opened by a customer in 24 h / 7 d; distinct vendors contacted | ✓ | | Indexed count on `conversations(kind, customer_id, created_at)`. Hard cap at creation, soft thresholds as rule inputs |
| Vendor declines / blocks / reports against this customer (30 d) | ✓ (cached counter) | ✓ | On the risk profile. Several vendors blocking the same customer → auto `hold_all` + case |
| Inquiry→quote conversion per customer | | ✓ | Daily. Many inquiries and zero quotes is a cold-pitch or scraper pattern |
| Blocked or held attempts by sender in 24 h | ✓ | | Indexed count on `messages(sender, status, created_at)`. More than 3 blocks in 1 h → auto `hold_all` for 24 h, and **a `behavioral` case is opened containing those blocked messages**, so a human sees the pattern. The hold expires on its own and is not a suspension |
| Exact duplicate text across conversations and senders (24 h) | ✓ | | Indexed `content_hash` lookup |
| Near-duplicates from the same sender | ✓ | | SimHash of the sender's last 50 messages, compared in-process |
| The same domain sent by this sender or by many senders | ✓ | | `message_urls` + `url_domains.seen_count` and `distinct_sender_count` |
| Account age, vendor tenure, trust tier, restrictions | ✓ | | One row: `messaging_risk_profiles` |
| Conversation phase and order state | ✓ | | Already loaded |
| Reports received (30 d), confirmed violations | ✓ (read the cached counters) | ✓ (recompute) | Counters on the risk profile, updated when a report or decision is recorded |
| Volume anomaly against the sender's own baseline (z-score over 7-day hourly buckets) | | ✓ | `RecomputeRiskProfiles` job, hourly |
| Cross-account clustering (shared URL, fingerprint or IP /24 across new accounts) | | ✓ | Daily job; opens cases |
| Report-rate outliers across vendors | | ✓ | Daily |
| Trust-tier promotion and demotion | | ✓ | Hourly job + immediately on human decisions |

**Trust tiers**, stored on `messaging_risk_profiles`:
- `new`: account under 7 days old **or** fewer than 5 delivered messages. Every URL is held, the flag threshold is lower, and the LLM escalate threshold is lower.
- `standard`
- `trusted`: for example 60+ days and 50+ clean messages with no violations. Slightly relaxed weights. It **never** bypasses block rules.
- `restricted`: every message goes to human review.
- `suspended`: can't send at all. The UI tells the user to contact support.

A human decision can set any tier. Automatic demotion to `restricted` happens after 2 **confirmed** violations in 30 days. "Confirmed" means a human upheld the block, so an automatic block by itself never counts toward restriction. Automatic suspension never happens: suspension is always a human decision.

**These tiers apply to messaging only.** They live on `messaging_risk_profiles` and are checked only by the messaging and inquiry services.
- A `restricted` or `suspended` user can still sign in, get quotes, check out and track orders. A vendor in either tier can still accept and fulfil orders.
- Account-wide sanctions remain separate, manual admin actions: for vendors, the existing `vendors.status = suspended` flow (see VENDOR_ONBOARDING.md); for customers, no account-level suspension exists yet. Moderation tooling can link to them but never triggers them automatically.
- **Live orders aren't stranded.** A messaging-`suspended` user can't open inquiries or post in threads without a live order. In a thread whose order is still in progress (accepted → delivered), they're treated as `restricted` instead: they can still post, but every message goes to human review. So fulfilment communication never breaks, even though the suspension is otherwise in force.

**The risk principal:** vendors are keyed by `vendor_id`, customers by `customer_id`. Admins are exempt, but their messages are still logged.

---

## 6. Discovering new abuse patterns

### What is retained, per submitted message (including allowed ones)

- The sanitized body, and the normalized view the rules saw.
- The `signals` JSON, the behavior snapshot, and the risk score.
- `rules_evaluated` (the list of `rule@version`) and the `moderation_rule_hits` rows, including shadow-mode hits.
- `pipeline_version` and `config_version`s.
- The LLM input hash, output, model and token counts. The full LLM prompt isn't stored; it can be rebuilt from the stored inputs and a versioned prompt template id.
- The final decision and who made it: `rules`, `llm`, `human:{userId}` or `report_resolution`.

### Labels

Labels come from three sources:
- every human decision (approve or block, plus an `abuse_category` and an optional `pattern_note`);
- resolved user reports;
- sampled audits. A weekly job randomly samples about 0.5% of `delivered` messages into a low-priority "audit" queue. This is the **only** way to estimate the false-negative rate for messages nobody reported.
- sampled **automatic blocks**. The same job samples about 5% of automatically blocked messages, plus every block a sender disputed through support, to measure the false-positive rate of each rule and of LLM blocks. A rule whose blocks keep getting overturned goes back to shadow mode.

### The feedback loop

1. A message passes the filters: `delivered`, or LLM-allowed.
2. A user reports it, an audit sample catches it, or a moderator finds it. A case is opened, and the moderator view shows **why it was allowed**: every rule evaluated, with version, fired or not; shadow hits; the score breakdown by rule weight; the LLM rationale if there was one; and the thresholds in force for the sender's tier at that moment.
3. The moderator labels it: category plus `pattern_note` ("vendor asks for 'your other email'", "link to Etsy shop via Printables profile"). The resolution records **"missed by automation"** (a false negative) versus "caught".
4. **Grouping:** a weekly `DiscoverAbusePatterns` job:
   - Collects false negatives and review-confirmed violations from the period.
   - Clusters them deterministically: shared registrable domains, shared SimHash buckets, shared rare n-grams (weighted against the delivered-clean baseline), shared sender cohorts (account age band, role, direction), and the signal combinations present.
   - Optionally sends each cluster through the LLM (on-demand Bedrock calls; weekly and low-volume) for a summary: "common pattern, proposed deterministic rule, candidate phrases".
   - Writes a report to the admin API. It never changes rules automatically.
5. An engineer writes a new rule, or an extractor or lexicon change, **in shadow mode**, with the cluster's examples as unit fixtures.
6. **Replay:** a command (`node ace moderation:replay --rule <id> --since 90d`) runs the candidate rule over stored normalized views and signals. It reports hits against labelled positives (recall) and against labelled clean or unlabelled delivered messages (estimated false positives). This works because rules are pure functions of stored inputs.
7. Promote to `enforce`, and add the examples, anonymized, to the regression corpus.

### Retention

See decision D10.
- Raw inbound MIME in S3: 90 days (a lifecycle rule).
- Message bodies: for the life of the order + **3 years** (for inquiries that never became an order: 3 years after the inquiry closes).
- Blocked, removed and labelled messages, with their evaluations: 3 years, as the training corpus.
- Unlabelled evaluations of clean messages: signals and hits are kept, but the normalized text is dropped after 180 days (the body stays with the message).

---

## 7. Profanity

| Approach | Verdict |
|---|---|
| Hand-built list | Rejected. High maintenance and easy to evade |
| Maintained word lists (e.g. LDNOOBW) | Fine as data. They lack obfuscation handling and whitelisting ("Scunthorpe", "cockpit", "Dick's Sporting Goods") |
| **`obscenity` (npm, MIT)** | **Recommended.** A curated English dataset plus transformers for leetspeak, confusables and repeated characters, a whitelist mechanism, and match positions for evidence. Runs locally, free, <1 ms |
| Third-party moderation APIs | OpenAI `omni-moderation-latest` is free and covers harassment, hate, sexual and violence for text and images. Google's Perspective API is **shutting down at the end of 2026**, so don't adopt it |
| LLM classification | Only as part of an escalation that's already happening. Not for profanity alone |
| Contextual detection | The harassment-candidate heuristic (profanity + second person + recipient reference) and escalation to the LLM |

**Policy:** profanity alone **never blocks**. A customer writing "this f***ing support bracket keeps snapping" is legitimate and still commercially valuable. Profanity is a small score weight. **Directed** abuse and slurs escalate or go to review, and harassment and threats are what get acted on. The platform's real risks are scams, off-platform leakage, advertising and unsafe links, and blocking vocabulary would create false positives that train users to distrust the system without reducing any of those risks.

---

## 8. Human moderation workflow

The API is admin-only, under `/v1/admin/moderation`, using the existing admin group and role check. The frontend doesn't exist yet, so this is API design only.

- **Queue:** `moderation_cases`, ordered by priority:
  1. `held` messages, where a user is waiting (admins review on a best-effort basis with no set response time, D8, so the pipeline keeps these rare);
  2. user reports;
  3. `delivered_flagged` messages;
  4. automated behavioral cases;
  5. audit samples.

  Cases can be filtered by category, sender, direction and rule. A reviewer claims a case (`assigned_to`, with a claim timeout) so two admins don't work the same case.
- **The case detail endpoint** returns everything in one response:
  - the message, with its evidence spans highlighted;
  - ±10 messages of conversation context, withheld ones included for moderators;
  - sender and recipient pseudonyms plus the real identities (admins only);
  - the sender's risk profile and history: past cases, decisions and blocks;
  - order and project state;
  - each URL with its full analysis (normalized, final URL, chain, verdicts and sources, domain age, seen and sender counts);
  - attachments with scan results;
  - rules evaluated, rules hit (including shadow), and the score breakdown;
  - the LLM verdict and rationale;
  - any reports.
- **Actions**, each an append-only `moderation_actions` row:
  - on the message: approve & deliver, block, or remove a delivered message;
  - on the user: warn (sends a system message to them), set tier `restricted` or `suspended` with an expiry, or lift a restriction;
  - on domains: allow or block the domain, with scope `global`;
  - on the conversation: close it early;
  - on the case: add a label (category + pattern note + missed-by-automation).
- **Feedback into detection:**
  - A block/remove decision updates the risk profile immediately.
  - A domain blocklisted by a moderator instantly affects the sync stage, and `RescanRecentUrls` retro-removes other messages with it.
  - Hashes of human-blocked spam are reused by `spam.duplicate_cross_conversation`, so the same text from anyone is blocked instantly.
  - Labels feed the discovery job and the replay precision numbers.

---

## 9. Data model (PostgreSQL, new migrations only)

Conventions: every table gets `id` + `uuid` where it's exposed externally. Status columns use `table.enum()` in the migration, mirrored in `database/schema_rules.ts`. JSON columns use `table.json()` so SQLite tests keep working. Model classes extend the regenerated `*Schema` classes.

| Table | Purpose | Key columns |
|---|---|---|
| `conversations` | One thread per inquiry, per (order, vendor assignment), or per support context. An inquiry thread later gains its project and order | `uuid`, `kind` (`inquiry`, `order`, `support`), `customer_id` null, `vendor_id` null, `project_id` null, `order_id` null, `subject`, `status` (`open`, `read_only`, `archived`), `closed_reason` (`idle`, `declined`, `blocked`, `order_closed`, `reassigned`, `staff`), `read_only_at`, `last_seq`. Partial unique index: one `open` inquiry per (`customer_id`, `vendor_id`). Unique on (`order_id`, `vendor_id`) where `kind = 'order'` |
| `conversation_blocks` | A vendor's permanent block of a customer (and future user↔user blocks) | `vendor_id`, `customer_id`, `created_by`, `reason`, `case_id`. Unique on the pair. Checked when an inquiry is created |
| `conversation_participants` | Who is in a thread, their pseudonymous display, their reply alias, read and notify cursors | `conversation_id`, `role` (`customer`, `vendor`, `staff`), `user_id` null, `customer_id` null, `vendor_id` null, `display_name`, `reply_token` (unique, 128-bit random, base32), `reply_token_expires_at`, `last_read_seq`, `last_notified_seq`, `email_notifications` bool, `removed_at` |
| `messages` | The canonical message record, including blocked submissions | `uuid`, `conversation_id`, `sender_participant_id` (null for system messages), `seq`, `kind` (`text`, `system`, `quote_ref`; quote events are written by the manual-quote flow and **skip content moderation**), `ref_type`/`ref_id` null (e.g. a quote), `channel` (`web`, `email`, `system`), `body` (sanitized plain text), `client_message_id`, `inbound_email_id` null, `status` (`held`, `pending_review`, `delivered`, `delivered_flagged`, `blocked`, `removed`, `withdrawn`), `block_reason_code`, `user_facing_reason`, `content_hash`, `simhash` (bigint), `delivered_at`, `removed_at`. Unique on (`sender_participant_id`, `client_message_id`); index on (`conversation_id`, `seq`), (`content_hash`, `created_at`), (sender principal, `status`, `created_at`). The sender principal (`sender_customer_id` / `sender_vendor_id`) is denormalized onto the row so behavioral queries don't need joins |
| `message_attachments` | Uploaded files and their scan state | `uuid`, `message_id`, `storage_key` (quarantine prefix → clean prefix), `original_filename`, `declared_type`, `sniffed_type`, `size_bytes`, `sha256`, `scan_status` (`pending`, `clean`, `rejected`, `infected`, `error`), `scan_details` json |
| `inbound_emails` | Audit and dedupe of every inbound mail to the reply domain, before and after routing | `ses_message_id` (unique), `s3_key`, `envelope_from`, `header_from`, `recipients` json, `message_id_header`, `spf`, `dkim`, `dmarc`, `spam_verdict`, `virus_verdict`, `size_bytes`, `status` (`received`, `routed`, `rejected`, `duplicate`), `reject_reason`, `participant_id` null, `message_id` null |
| `moderation_evaluations` | One row per pipeline pass on a message (sync, then async/LLM, then any rescan). The explainability record | `message_id`, `stage` (`sync`, `async`, `rescan`), `pipeline_version`, `decision`, `risk_score`, `signals` json, `behavior` json, `rules_evaluated` json, `llm` json null (model, prompt version, verdict, tokens), `duration_ms` |
| `moderation_rule_hits` | Only the rules that **fired**. Makes "messages where rule X fired" and precision queries cheap without JSON queries | `evaluation_id`, `message_id`, `rule_id`, `rule_version`, `config_version`, `action`, `weight`, `shadow` bool, `evidence` json. Index on (`rule_id`, `created_at`) |
| `moderation_rule_configs` | Runtime enable/shadow/enforce state and threshold overrides | `rule_id` (unique), `mode`, `config` json, `config_version`, `updated_by` |
| `url_domains` | Registrable-domain reputation plus allow/block lists | `domain` (unique, punycode), `list_status` (`allow`, `block`, `none`), `list_reason`, `listed_by`, `registered_at` null, `rdap_checked_at`, `first_seen_at`, `seen_count`, `distinct_sender_count` |
| `url_scans` | The cached per-URL verdict | `url_hash` (unique), `normalized_url`, `domain_id`, `final_url`, `redirect_chain` json, `verdict` (`safe`, `unknown`, `suspicious`, `malicious`), `threat_types` json, `sources` json, `checked_at`, `expires_at` |
| `message_urls` | Which messages contain which URLs. Needed for fan-out detection and retroactive removal | `message_id`, `url_scan_id`, `domain_id`, `link_token` (for the click-through interstitial) |
| `message_reports` | User reports | `uuid`, `message_id`, `reporter_participant_id`, `reason` (`contact_sharing`, `payment`, `spam_ad`, `scam`, `harassment`, `other`), `note`, `status`. Unique on (`message_id`, `reporter_participant_id`) |
| `moderation_cases` | The human review queue item and its label | `uuid`, `message_id` null, subject principal (`customer_id` / `vendor_id`), `source` (`auto_hold`, `auto_flag`, `report`, `behavioral`, `audit_sample`, `url_rescan`), `priority`, `status` (`open`, `claimed`, `resolved`), `assigned_to`, `claimed_at`, `resolution`, `abuse_category`, `pattern_note`, `missed_by_automation` bool, `resolved_by`, `resolved_at` |
| `moderation_actions` | Append-only audit of every human action and rule/config change | `actor_user_id`, `case_id` null, `action`, `target_type`, `target_id`, `reason`, `metadata` json |
| `messaging_risk_profiles` | One row per principal, read on every send: tier, restriction, cached counters | `customer_id` null / `vendor_id` null (exactly one), `trust_tier`, `restriction_expires_at`, `delivered_count`, `blocked_count_30d`, `reports_30d`, `confirmed_violations_30d`, `baseline` json, `recomputed_at` |

**Deliberately not created:**
- A per-rule-execution table for non-firing rules. `rules_evaluated` on the evaluation row covers it.
- A behavioral-signal time-series table. Signals are computed from indexed `messages` and `message_urls` queries, snapshotted into `evaluation.behavior`, and rolled up on the risk profile.
- A message-edit history. Edits aren't allowed.
- A notification-delivery table. `last_notified_seq` is enough.
- A reuse of `webhook_events` for SES. `inbound_emails` already carries the unique SES id and far more.

`audit_events` stays for commercial entities; moderation has its own action log.

---

## 10. AdonisJS mapping

### Request lifecycle for `POST /v1/conversations/:uuid/messages`

Messages are submitted as JSON. Attachments are uploaded beforehand via presigned URLs and referenced by uuid.

1. `middleware.auth()`, then `messagingThrottle` (a new `limiter.define`, keyed by user id).
2. `MessagesController.store` → `request.validateUsing(sendMessageValidator)`: body 1–4,000 chars, `clientMessageId` uuid, up to 5 `attachmentUuids`.
3. `conversation_access_service.resolveParticipant(ctx, uuid)`. This follows `resolveProject`'s pattern: return null → 404, never revealing whether a conversation exists. It checks that the conversation is `open` and the principal isn't `suspended`.
4. `message_service.submit()`:
   - **Idempotency:** if the `clientMessageId` already exists, return that message.
   - **Sync pipeline** (`moderation/pipeline.runSync`): normalize → extract → local URL verdicts → behavior lookups → rules → combine. Budget under 50 ms; it's all CPU plus a handful of indexed reads.
   - **One transaction:** lock the conversation, assign `seq`, insert the message, `message_urls`, the evaluation and the rule hits, and a case if the decision is review.
   - **After commit:**
     - `delivered` / `delivered_flagged` → Transmit broadcast on `conversations/:uuid` and schedule `SendMessageNotifications`. If flagged, also enqueue `AnalyzeMessage` (post-delivery).
     - `held` → enqueue `AnalyzeMessage` (pre-delivery).
     - `pending_review` → a case exists; the sender sees "under review".
     - `blocked` → return the reason.
5. The response is `201` with the message and its status, using the `serialize(MessageTransformer)` envelope. It's still 201 when blocked; the resource exists with status `blocked`.

### Process placement: in the API, in a worker, or in a separate service?

Slicing runs outside the API (SQS → Lambda) for good reasons:
- it's heavy CPU work that takes seconds to minutes;
- it needs a different runtime (the PrusaSlicer binary);
- load is bursty;
- it's an unauthenticated cost-amplification target.

Moderation work splits into parts that have *different* profiles, so each part goes where it fits:

| Work | Profile | Where it runs | Why |
|---|---|---|---|
| Sync stage: normalize, extract, local URL/list/cache lookups, behavior counters, rules, combine | Pure CPU of about 1–5 ms per message, plus a few indexed DB reads it needs anyway | **In the API process**, as a library module (`app/services/moderation/`) | A network hop to a separate service would *add* latency and a failure mode, with nothing gained. A 4,000-character message is tiny: one API task can check thousands per second. The send has to wait for this decision anyway |
| Async stage: Web Risk and RDAP calls, LLM calls, the decisions for held messages | Waits on I/O (network), from 100 ms to 10 s | **A queue worker** (`node ace queue:work`) running as its **own ECS service**, separate from the API service | Slow third-party calls never hold up HTTP requests, and the worker scales on queue depth. It's the same codebase, the same DB access and the same rule code. A separate *codebase* isn't needed; a separate *process* is |
| Following URL redirects (the safe fetcher) | Makes requests to arbitrary attacker-chosen URLs | **An isolated Lambda** (or a small separate task) with **no IAM role** and no access to the VPC, invoked by the worker | Security, not load: if a URL tries to reach internal addresses (SSRF), there's nothing inside to reach and no credentials to steal. This is the one part that follows the slicing pattern |
| Attachment malware scanning | Heavy, and handles untrusted files | **A managed AWS service** (GuardDuty for S3) or a ClamAV Lambda, triggered by S3 events | Same reasons as slicing: heavy, a separate runtime, and untrusted input |
| Decoding MIME, images and QR codes (step 5 / attachments) | Parsing untrusted input, which can be memory-heavy | **The queue worker**, with size limits and timeouts. Can move to a Lambda if it ever threatens worker stability | Contained well enough by limits at our scale |

**Design choice that keeps this open for later:** the pipeline is written as a pure module. It takes the message, context and lookups as input and returns a decision with evidence, with no dependency on the HTTP context. So if scale ever calls for it, the sync stage can be moved behind an internal endpoint or into a Lambda without rewriting the rules.

Signs that a real extraction would be justified:
- the sync-stage p95 goes over about 50 ms;
- a second application needs the same moderation;
- a classifier needs Python or a GPU.

None of these is expected soon.

### Delivery timing

**"Do not deliver until we know it is safe"**, meaning the message stays `held` or `pending_review` until the async stage or a human decides, applies to:
- any URL that isn't allowlisted plus cached-safe;
- any attachment, since everything is delivered only after its scan;
- any `escalate` decision;
- any `new`-tier vendor→customer message with a URL;
- anything from a `restricted` principal.

**"Deliver now, analyse later"** (`delivered_flagged`, then `AnalyzeMessage` post-delivery) applies to:
- score in the flag band (mild promo words, profanity, a bare payment mention by a `standard`/`trusted` sender);
- the audit sample.

If post-delivery analysis finds a violation, the message is removed and a case is opened. And because flagged-message notification emails **omit the body** ("You have a new message — view it"), there's nothing to recall from anyone's inbox.

### Components

| Kind | Items |
|---|---|
| **Models** | `Conversation`, `ConversationParticipant`, `Message`, `MessageAttachment`, `InboundEmail`, `ModerationEvaluation`, `ModerationRuleHit`, `ModerationRuleConfig`, `UrlDomain`, `UrlScan`, `MessageUrl`, `MessageReport`, `ModerationCase`, `ModerationAction`, `MessagingRiskProfile`. Each extends its generated schema class |
| **Services** | `conversation_service` (create on accept, close on status change; called from `order_acceptance_service`, `shipment_tracking_service` on delivered, the refund and cancel paths, and routing reassignment), `conversation_access_service`, `message_service`, `message_notification_service`, `attachment_service`, `inbound_email_service` (+ `email_reply_parser.ts`), `moderation/*` (pipeline, normalizer, extractors, rules, registry, combiner), `url_analysis_service` (+ `safe_url_fetcher.ts`, `web_risk_client.ts`, `rdap_client.ts`), `behavior_signal_service`, `risk_profile_service`, `llm_moderation_service`, `moderation_case_service` |
| **Jobs** (`@adonisjs/queue`, separate queue names so LLM and URL latency can't starve `default`) | `AnalyzeMessage` (queue `moderation`), `ProcessInboundEmail` (`inbound`), `SendMessageNotifications` (`mail`), `ScanAttachment` (`moderation`). Scheduled: `CloseExpiredConversations` (hourly), `RecomputeRiskProfiles` (hourly), `RescanRecentUrls` (every 6 h), `SampleAuditMessages` (daily), `DiscoverAbusePatterns` (weekly). Every job is idempotent: it re-reads message status under a lock and no-ops if it's already decided. This follows the style of the existing overlap-safe jobs |
| **Controllers** | `InquiriesController` (customer: `POST /v1/vendors/:vendorUuid/inquiries` creates the conversation and runs its first message through the pipeline in one transaction; vendor: decline, block customer), `ConversationsController` (customer and vendor listing and show), `MessagesController` (index with a `?afterSeq=` cursor, store, withdraw), `MessageAttachmentsController` (presign upload, download via presigned GET with `Content-Disposition: attachment`), `MessageReportsController`, `ConversationReadsController` (mark read), `LinksController` (the click-through interstitial), `SesInboundWebhooksController`. Admin: `AdminModerationCasesController`, `AdminModerationRulesController`, `AdminUrlDomainsController`, `AdminMessagingProfilesController` |
| **Middleware** | No new classes. Participant checks happen in services, as with `resolveProject`. New `limiter.define` entries: `messaging` per user, and `inboundWebhook` |
| **Events** | Not used. `#events` and `#listeners` have no code yet, and the codebase prefers explicit service calls. Delivery calls `message_notification_service` and Transmit directly |
| **Transmit** | A new private channel `conversations/:uuid`, authorized in `start/transmit.ts` via `conversation_access_service` (participants + admins). Payload is the message uuid and status only; clients fetch the content |
| **Worker** | The existing `node ace queue:work` process. Run it as a separate ECS service if it isn't already (see the verification section) |

---

## 11. Email-specific security (the reply-by-email channel, if Step 5 goes ahead)

### Is reply-by-email worth the risk? Yes, but only in a deliberately narrow v1

**The key point:** an email reply passes through exactly the same moderation as an in-app message. So a malicious reply is no worse than the same text typed into the app by the same user. What email adds is limited to:
- (a) impersonation;
- (b) content that's harder to moderate: quoted history, signatures, HTML;
- (c) malicious files;
- (d) parser and loop edge cases.

The v1 scope removes most of that instead of defending against it:

| Risk | v1 treatment | Residual risk |
|---|---|---|
| Malicious attachments and inline images | **Not accepted.** Discarded, with an "upload in the app" notice | None from files |
| HTML (script, tracking pixels, deceptive links) | **Never stored or rendered.** We keep plain text only: the text part, or HTML converted to text. Remote images are never fetched. Links go through the URL pipeline and the click-through page like any link | Only the conversion itself. A maintained library with size limits keeps this low |
| Impersonation / spoofed sender | Per-participant secret address **and** From must equal the participant's email **and** DMARC-aligned authentication must pass. Otherwise rejected silently. The user sees an in-app notice | Someone who controls the participant's mailbox is effectively that user, the same as a stolen password |
| Contact details in signatures, quoted history | Strip, and redact signature blocks. If stripping is uncertain → escalate to review | Some extra review load. The spike measures how much |
| Parser bugs and malformed MIME (maliciously crafted email structure meant to break parsers) | Parsed in the queue worker, never in the web request; size, part-count and depth limits; timeouts | A crash affects one job, which then goes to the retry/failure queue |
| Loops, autoresponders, bounces | Header filters + a rate limit per address | Low |
| Irreversibility | Not relevant: inbound mail becomes an in-app message, which can be held or removed like any other | None |

**What's left:** some vendors' or customers' mail won't pass authentication (small business domains without DKIM/DMARC). Those replies are rejected, and those users have to reply in the app. That's an inconvenience, not a safety problem.

Extra controls that keep the risk manageable:
- The whole channel is **behind a feature flag**, and can be enabled for vendors first.
- Reply-by-email is **switched off automatically per user** when they're in the `restricted` tier, or after repeated rejected or escalated email replies.
- **Every failure path falls back to "reply in the app"**, so turning the channel off never loses a message.

**Recommendation:** worth building in this narrow form: text only, no attachments, verified senders, failures blocked rather than let through. But only after the Step 5a spike shows that reply extraction is reliable. If the spike shows too many replies need human review, notifications alone (Step 1) still deliver most of the value.

Notification emails in steps 1–4 are outbound only and carry no body. The only risks they bring are the link, handled by the interstitial, and our domain's reputation. Everything below applies only if reply-by-email is built.

### Reply routing uses the address, not the MIME

- Each participant in each conversation gets its own reply address, `r-<token>@reply.makexyz.com`. Notification emails put it in `Reply-To`.
- The token is a 128-bit random value stored on `conversation_participants`. It maps to the conversation **and** the participant, so it identifies both where the reply goes and who is replying.
- SES puts the envelope recipients (`receipt.recipients`) in the JSON notification it sends to our webhook, alongside the SPF/DKIM/DMARC and spam/virus verdicts. So routing and the first checks happen **before the MIME is ever fetched or parsed**:
  - look up the token;
  - reject it if it's unknown or expired;
  - reject it if the conversation is closed;
  - reject it if the authentication verdicts fail.
- Only mail that passes those checks is fetched from S3 and parsed. Parsing is needed only to get the *text of the reply*: pick the text part, strip quoted history and signatures, and extract attachments. It's never used to decide *which conversation* the reply belongs to.
- **Why not put the raw conversation uuid in the address?**
  - It identifies the thread but not the sender, and every participant would share one address.
  - A uuid also shows up elsewhere (URLs, API responses), so it isn't a secret. Knowing a reply address shouldn't be enough to post, even with the From check behind it.
  - A per-participant random token is unguessable, can be rotated or expired on its own, and doesn't expose internal ids.
  - A stateless alternative is `<conversationUuid>.<participantId>.<HMAC>`. It's workable, but it can't be revoked per participant without a lookup anyway, so the stored token is simpler.
- `In-Reply-To` / `References` headers are only used as a consistency check (a mismatch goes to review), never for routing.

### Topology

- A dedicated subdomain, `reply.makexyz.com`, with its MX pointed at SES inbound, keeps inbound separate from the corporate domain and from `MAIL_FROM_ADDRESS`.
- Receipt rule: recipient `reply.makexyz.com`, spam and virus scanning on.
  1. **S3 action**: raw MIME to a private, KMS-encrypted bucket with a 90-day lifecycle.
  2. **SNS notification** to an HTTPS subscription at `/v1/webhooks/ses-inbound`.
- The SES receiving region must be one that supports inbound (D9).
- The alternative is SNS → SQS → a worker poller, which gives a DLQ. The HTTPS push is recommended because it matches the existing webhook controllers. The raw MIME stays in S3 for manual replay either way.

| Threat | Mitigation |
|---|---|
| **Webhook forgery** | Verify the SNS message signature (SignatureVersion 2, SHA-256). The cert is fetched only from `https://sns.<region>.amazonaws.com/` (strict host regex) and cached. Check `TopicArn` equals ours. Handle `SubscriptionConfirmation` by confirming only for our topic. Reject anything unsigned. Never trust email content in the webhook body; always fetch the MIME from S3 by the key in the verified notification |
| **Replay or duplicate delivery** | `inbound_emails.ses_message_id` is unique, and the webhook inserts it before enqueueing (unique violation → 200 no-op). Per-conversation `Message-ID` dedupe as well. Also reject SNS messages whose `Timestamp` is older than 1 h |
| **Spoofed sender** | A message is accepted only if **all** of these hold: (a) the envelope recipient's alias token is valid and unexpired; (b) the RFC5322 `From` address, normalized (lowercase, IDNA; no plus-stripping, since plus-addressing is the user's own), equals the participant's registered email; (c) the SES verdicts show **DMARC pass**, or when the sender domain has no DMARC policy, SPF *and* DKIM pass, aligned with the From domain. Otherwise the mail is rejected: `inbound_emails.status = rejected`, no reply sent (no backscatter). The participant gets an in-app notice of a "rejected email reply" |
| **Reply-To manipulation** | We ignore inbound `Reply-To` completely; routing uses only the envelope recipient. Our outbound mails set `Reply-To` to the recipient's own alias, and `From` is always `MakeXYZ Messages <notifications@makexyz.com>`. Never the sender's name or address, since that would leak identity and look like spoofing |
| **Alias guessing and enumeration** | 128-bit random tokens, one per participant (not per conversation), so a leaked alias only lets *that* participant's verified email post. Unknown aliases are dropped by an SES rule that bounces only unknown recipients at SMTP time (free, no backscatter), or silently |
| **Alias leaked or forwarded to a third party** | Mail from any address other than the participant's is rejected (see spoofing). A participant can rotate their alias (new token) from the settings API |
| **Forwarded emails** | Detect `Fwd:`/`FW:` subjects, `message/rfc822` parts and "Forwarded message" markers. Strip the forwarded content, keep only the new text, and add weight. Forwarded content is where outside contact info and ads hide |
| **MIME parsing** | Parse in the worker job, never in the webhook request. Use a maintained parser (`mailparser`) with limits: 15 MB total (reject larger at the job, and set an SES size condition), at most 20 parts, at most 10 nesting levels, a 256 KB header size cap. Use a timeout and run in a job with a memory ceiling |
| **HTML email** | Never rendered and never stored as HTML. Prefer `text/plain`. If only HTML exists, convert to text (`html-to-text`), extracting `href`s into the URL pipeline and comparing link text against the target. The stored body is plain text; the frontend renders it as text with auto-linking through the interstitial only |
| **Embedded images, tracking pixels** | Remote images are never fetched, so tracking pixels do nothing. Their URLs are extracted and analysed like any other URL (a tracking pixel from an unknown domain is a weak ad/spam signal). Inline `cid:` images are treated as attachments |
| **Attachments and malicious attachments** | **Not accepted by email in v1.** Attachments and inline images are discarded without being stored or parsed further. The thread gets a system notice: "Attachments sent by email aren't delivered. Upload them in the app." An SES virus verdict of FAIL rejects the whole email. If this is ever loosened, email attachments would go through the same pipeline as web uploads (type allowlist by magic bytes, size cap, malware scan) |
| **Embedded URLs** | The full URL pipeline, and the same rules as web messages |
| **Signatures and quoted history** | `email-reply-parser` (the GitHub-style reply/quote/signature splitter) plus our own markers: `On … wrote:`, `-----Original Message-----`, our notification footer delimiter "— Reply above this line —", Outlook `From:/Sent:` blocks, and common mobile signatures. Contact signals found **only in the detected signature block** trigger `email.signature_remnant` → **redact** the block rather than blocking the message. Legitimate users' signatures shouldn't block their replies, but they must never be relayed. If the parser can't find a boundary and the body is over 3× the median length, escalate |
| **Email loops and autoresponders** | Drop inbound mail with `Auto-Submitted` other than `no`, `Precedence: bulk/junk/list`, `X-Autoreply`, `X-Autorespond`, `List-Id`, empty envelope sender (`MAIL FROM:<>`, i.e. bounces), or our own `X-MakeXYZ-Notification` header. Our outbound mails set `Auto-Submitted: auto-generated`. Rate-limit inbound per alias (≤ 20/hour) as a loop backstop |
| **Oversized messages** | An SES rule rejects mail over the limit. The job rejects over 15 MB. Bodies over 4,000 chars after reply-stripping are truncated with a notice and flagged |
| **Wrong project or thread association** | Routing is **only** envelope recipient → `reply_token` → participant → conversation. Subject and `In-Reply-To` are ignored for routing. As a sanity check, if `In-Reply-To` references a message uuid from a *different* conversation, the mail goes to review instead of posting. Multiple MakeXYZ aliases in one email (a user Cc'ing two threads) → reject with an in-app notice; never post to both |
| **Expired aliases or closed conversations** | Expired token → drop. Closed but not expired, and the mail passed DMARC → at most one auto-reply per sender per 24 h pointing to support, with `Auto-Submitted` set |
| **Our sending reputation** | Only moderated, delivered content is ever emailed. Flagged or low-trust content goes out as notification-only emails without the body |

---

## 12. Third-party services

Pricing was checked against the official pages in September 2026. Items marked **verify** couldn't be fetched this session and should be confirmed before signing up.

| Service | Problem it solves | We still build | Integration | Security notes | Cost drivers | Necessary? |
|---|---|---|---|---|---|---|
| **Amazon SES inbound** (receipt rules) | Receives mail for `reply.makexyz.com`; SPF/DKIM/DMARC results; spam and virus verdicts | MIME parsing, reply stripping, routing, all moderation | Receipt rule → S3 (≤ 40 MB) + SNS → our webhook | Verify SNS signatures; the S3 bucket is private and KMS-encrypted; receiving is only available in some regions | $0.10 per 1K emails + $0.09 per 1K incoming 256 KB chunks. Negligible at our scale | **Necessary** if reply-by-email ships (it's already our provider, and it adds no new vendor) |
| SES Mail Manager | Managed ingress with traffic policies, archiving, and add-ons (Spamhaus DBL, Abusix, Trend Micro virus scanning, Vade) | Same as above | Ingress endpoint + rule sets | Same | $50/month per open ingress endpoint + $0.15 per 1K emails + add-on fees | Convenient, not necessary. Consider it only if inbound spam becomes a real problem |
| Postmark inbound | Parsed JSON webhook, including reply stripping (`StrippedTextReply`) | Routing and moderation | HTTPS webhook with basic auth | New data processor | Pro plan and above ($16.50/month and up) | Not recommended: it adds a vendor when SES already covers this |
| **Google Web Risk (Lookup API)** | Malware, phishing and unwanted-software verdicts for URLs. The Safe Browsing API is **non-commercial only**, so it's not an option | Normalization, caching, redirect resolution, domain age, lists, policy | REST `uris.search` with an API key or service account; results cached per the response's `expireTime` | Only the URL is sent. Store the key in the env schema | Free up to 100K lookups/month, then $0.50 per 1K. With per-URL caching we'll stay in the free tier for a long time | **Recommended.** The cheapest high-value external signal |
| Spamhaus DBL / ZRD (DQS) | Low-reputation and newly observed (<24 h) domains | Nothing beyond the DNS query | DNS lookups against DQS | The free DQS is **non-commercial only**, so a paid DQS subscription is needed | Paid subscription (verify pricing) | Convenient later. RDAP domain age covers most of the "new domain" need for free |
| RDAP (IANA bootstrap) | Domain registration date | Client + cache | HTTPS JSON | Treat as untrusted input; use timeouts | Free | **Recommended** |
| VirusTotal | File and URL multi-engine reputation | — | REST | The public API is **non-commercial only** (4 requests/minute); commercial use needs the private API | Enterprise contract | Not necessary |
| urlscan.io / Cloudflare URL Scanner | Sandboxed rendering of suspicious pages, plus categories | Deciding when to submit | REST submit + poll | Submissions must be private or unlisted, or we leak customer URLs publicly (**verify** each product's visibility defaults and pricing) | Per scan | Optional, only for escalated unknown URLs, once volume justifies it |
| **Attachment malware scanning**: GuardDuty Malware Protection for S3 (**verify** pricing and standalone enablement) or ClamAV (self-hosted Lambda or container) | Malware in uploads | Quarantine prefix, promotion on clean, type allowlist | GuardDuty: tag-on-scan-complete + EventBridge. ClamAV: an S3-event Lambda | Keep the quarantine prefix unreadable by the app's presign path until the file is clean | GuardDuty charges per GB scanned + per object; ClamAV costs compute + signature updates | **Necessary in some form** if attachments beyond the 3D-file allowlist are allowed. GuardDuty is the least operational work |
| OpenAI `omni-moderation-latest` | Harassment, hate, sexual, violence and self-harm classification for text **and images** | Policy mapping | REST | Adds a third-party data processor that receives message text | **Free** | Optional. Useful for images and as an async harassment signal (D6) |
| AWS Rekognition (`DetectModerationLabels`, `DetectText`) | Explicit-image detection; OCR for text or URLs in images | Policy | SDK (same AWS chain) | Stays inside AWS | Per image (verify) | Optional. Only on escalated images |
| Perspective API | Toxicity scoring | — | — | — | — | **Don't adopt: it's being retired at the end of 2026** |
| **Claude on Amazon Bedrock** (decided) | Contextual classification of escalated messages; offline pattern summarization | Prompting, schema, context assembly, thresholds, evals | `@anthropic-ai/bedrock-sdk` (Mantle client, same `messages.create` surface), structured outputs, prompt caching on the system prompt. Auth through the ECS task role (`bedrock:InvokeModel` on the chosen model or inference profile) | Pseudonymized context only; no tools; fails closed. Message text stays inside AWS | Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25 per MTok, times the escalation rate | **Recommended** for the escalation band. Not needed for steps 1–4 |
| Akismet or other generic spam APIs | Generic comment spam | — | — | — | — | Not needed. Order-scoped conversations plus behavioral rules plus SES spam verdicts cover this |

---

### How to reach Claude: Anthropic API, Amazon Bedrock, or Claude Platform on AWS

| | Anthropic API (first-party) | Amazon Bedrock | Claude Platform on AWS |
|---|---|---|---|
| Who runs it | Anthropic | AWS (partner-run) | Anthropic, reached through AWS |
| Auth | API key, which becomes a new secret in env | **IAM / SigV4 through the default AWS credential chain.** The ECS task role works, with no new secret, matching how S3, SQS and SES already work here | **IAM / SigV4 through the default chain**, plus an `ANTHROPIC_AWS_WORKSPACE_ID` setting |
| Billing | Separate Anthropic invoice | AWS bill | AWS bill (AWS Marketplace) |
| Model IDs, SDK | `claude-haiku-4-5` etc. `@anthropic-ai/sdk` | `anthropic.`-prefixed IDs. `@anthropic-ai/bedrock-sdk` (Mantle client), with the same `messages.create` surface | Bare IDs. `@anthropic-ai/aws-sdk`, with the same surface |
| Features this design needs: structured outputs, prompt caching | Yes | Yes | Yes |
| Message Batches API (the offline pattern-discovery job, −50%) | Yes | **No.** Bedrock has its *own* batch inference (an S3-based job API) instead: a different integration, and it's for Bedrock's supported models | Yes |
| New models and features | Day one | Can lag, and some features are missing (server tools, the Batches API, Files API, `inference_geo`, fallbacks) | Same-day parity with the first-party API |
| Data path | Message text leaves AWS for Anthropic (commercial terms: API data isn't used for training by default) | Stays inside AWS; the model provider has no access to your prompts | Anthropic-operated, reached over AWS. **Verify** the data-handling terms if that difference matters to you |
| Quotas | Anthropic rate-limit tiers, which rise with spend | Per-account, per-region Bedrock quotas; new accounts often need increases requested | **Verify** |
| Price | Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25 per MTok | Set by AWS. The public pricing page didn't list current Claude models when checked, so **confirm in the Bedrock console**. Regional endpoints may cost more than cross-region/global ones | **Verify** (AWS Marketplace listing) |

**For this design,** the LLM is a small, occasional classification call, so all three work. The differences come down to operations and privacy:

- **Decided: Amazon Bedrock.** Its price for these models matches the Anthropic API, and it keeps everything inside AWS: IAM through the task role, no new secret, one bill, and message text never leaves AWS. The feature gaps don't affect this design. Structured outputs and prompt caching are both supported, and the one missing piece, the Batches API, isn't needed at this volume.
- **Region (decided: production runs in us-west-1):** Claude Sonnet 5 isn't offered *in-region* in us-west-1. The Bedrock client therefore gets its own `BEDROCK_REGION` env var, separate from `AWS_REGION`. It points at a region that serves Sonnet 5, such as us-east-1 (in-region) or us-west-2 through the US cross-region profile. An IAM task role can call Bedrock in another region, and the extra ~60 ms doesn't matter for an async job. Before choosing, verify whether us-west-1 is a valid source region for the global profile. SES email receiving *is* supported in us-west-1.
- **Setup to check at Step 6:**
  - model access is enabled for the chosen model in the account and region;
  - the exact Bedrock model ID, or cross-region inference-profile ID, for that model;
  - Bedrock on-demand quotas (tokens and requests per minute) are enough for peak escalation bursts, with an increase requested if not;
  - the ECS task role can call `bedrock:InvokeModel` on that model or profile ARN.
- *Alternatives considered:* Claude Platform on AWS (full first-party feature parity, AWS billing) and the direct Anthropic API (a new secret and a separate bill).
- **The Anthropic API directly** is the simplest to start with (one API key). It's fine if a separate vendor bill and a new secret are acceptable.

The pipeline code talks to a single small `llm_moderation_service` interface, so switching between these later changes only the client construction and model IDs.

## 13. End-to-end flow

```
[INQUIRY START] Customer (verified account) ──► POST /vendors/:vendorUuid/inquiries {subject, body}
  SYNC  vendor active & accepting inquiries · not blocked by the vendor · inquiry caps · no open inquiry for the pair
  SYNC  create conversation + participants, then the first message goes through the SAME pipeline below
        (first-message rules: inquiry.cold_pitch, fan-out; new-tier customers → a first inquiry with a URL is held)

[WEB] Sender composes ──► POST /conversations/:uuid/messages
  SYNC  auth ─ throttle ─ validate ─ participant & conversation open ─ tier not suspended
  SYNC  normalize → extract signals → local URL verdicts (lists, cache, static) → behavior lookups
  SYNC  rules (sync stage) → combine → decision
  SYNC  TX: lock conversation, seq, insert message + urls + evaluation + hits (+ case)
        │
        ├─ blocked ───────────► 201 {status: blocked, reason}; recipient sees nothing
        ├─ pending_review ────► case queued; sender sees "under review"
        ├─ held ──────────────► ASYNC AnalyzeMessage:
        │                          remote URL rep (Web Risk, cached) · redirects (safe fetcher) · RDAP
        │                          attachment scan wait · QR decode · async rules re-run
        │                          → still ambiguous? → LLM (pseudonymized context) → verdict
        │                          → delivered | blocked | pending_review
        └─ delivered / delivered_flagged
                 │  (flagged → ASYNC post-delivery AnalyzeMessage; may → removed)
                 ▼
        DELIVERY  Transmit push to online participants
                  ASYNC SendMessageNotifications (debounced ~3 min, skip if online)
                    → SES email: body included only if delivered & sender not low-trust;
                      links rewritten to the interstitial; Reply-To = recipient's alias

[EMAIL — only if Step 5 ships] Recipient hits Reply ──► reply.makexyz.com (MX → SES)
  SES     SPF/DKIM/DMARC + spam/virus verdicts → S3 (raw MIME) → SNS → POST /webhooks/ses-inbound
  SYNC    verify SNS signature + topic → insert inbound_emails (unique ses id) → enqueue → 200
  ASYNC   ProcessInboundEmail:
            loop/autoresponder filters → size limits → alias → participant → conversation open?
            From == participant email && DMARC-aligned pass? (else reject silently)
            parse MIME → text part / HTML→text → strip quoted history, forwards, signature
            attachments / inline images → discarded (in-thread notice: "upload in app")
            ► message_service.submit(channel=email) — the SAME pipeline as web
              (+ email-only rules: signature_remnant redaction, parser-confidence escalation)
  → delivered / held / review / blocked, exactly as above; the canonical history lives only in `messages`

[HUMAN] reports / held / flagged / audit samples ─► moderation_cases ─► moderator decision
          ─► message status + risk profile + domain lists + labels ─► discovery job ─► new shadow rules ─► replay ─► enforce + regression corpus
```

---

## 14. Cost and scalability

- **Per-message cost for the ~95% clean path:** zero external calls. CPU normalization plus about 4–6 indexed Postgres reads and one transaction.
- **URL costs scale with distinct URLs, not messages.** Results are cached with TTLs, so Web Risk stays in its free 100K/month tier well past early scale. Redirect fetching happens only for shorteners and unknown domains.
- **LLM costs scale with the escalation rate.** At a 5% rate and 100K messages/month that's about $10–60/month (section 4). Per-sender LLM budgets stop attackers from driving up spend. The escalation rate is tracked as a key metric; if it rises, the answer is to write deterministic rules for the recurring escalation causes.
- **Email:** outbound is a few cents per 1K. Inbound ≈ $0.10 per 1K + chunks. Debounced digests cut outbound volume severalfold.
- **Infrastructure:** nothing new beyond an S3 bucket, an SNS topic, an SES rule set, and optionally a small isolated fetcher Lambda.

**Scaling path, in order, as each becomes necessary:**
1. Move the limiter and hot counters from the DB store to Redis. `@adonisjs/limiter` supports it with a config-only change.
2. Move `@adonisjs/queue` to a Redis- or SQS-backed driver, or run dedicated worker services per queue.
3. Partition `messages` and `moderation_evaluations` by month (declarative partitioning).
4. Move pattern discovery and replay to a read replica.

Rules are pure and in-process, so the sync stage scales linearly with API tasks.

---

## 15. Implementation plan (build order, all pre-launch)

**Nothing here is a staged release.** The app hasn't shipped, so everything is built **before launch** and ships together.

The steps below are **build order**. Each step depends on the ones before it: rules need extractors, the URL pipeline needs the hold mechanics, and the LLM needs escalation signals. They're also convenient review and PR boundaries. Two things stay genuinely conditional:
- **Reply-by-email** (Step 5) is gated by its spike.
- **The model tier** (Step 6) is picked by an eval.

**At launch, the pre-launch build still can't provide:**
- **Real traffic to tune against.** Without it, thresholds, behavioral baselines, and which rules can safely run in `enforce` are educated guesses. So at launch:
  - only the near-certain rules enforce (`contact.email`, validated `contact.phone`, `payment.crypto_address`, `payment.bank_details`, known-bad URLs, dangerous attachments);
  - every other rule runs in **shadow** mode;
  - ambiguous messages are held and the LLM decides them automatically. Human review is only for what the LLM can't decide and for harassment or threats, because admins review on a best-effort basis (D8).

  After a few weeks of live data, promote rules to `enforce` and relax the holds. That's configuration in `moderation_rule_configs`, not new code.
- **Labels.** The discovery job and the per-rule precision reports are built now but have nothing to work on until moderators have labelled cases.
- **Seed data:** importing the legacy application's message history (D13) is the best source of a realistic corpus. It's useful for the rule fixtures, the LLM eval set and the initial thresholds before launch, even if the history isn't shown to users.

### Step 1: Minimum viable messaging (with a safety floor)

- **Build:**
  - Migrations and models for `conversations` (all three kinds), `conversation_participants`, `messages` (including `kind`/`ref`), `conversation_blocks`, and `messaging_risk_profiles` (tier and restriction only).
  - Account email verification as a prerequisite for starting an inquiry (D12).
  - `InquiriesController`: creation with caps, and vendor decline/block.
  - Instant-quote order threads created in `order_acceptance_service`, with close hooks on delivered, cancelled, refunded and reassigned.
  - Idle expiry for inquiries in `CloseExpiredConversations`.
  - The `project_id` / `order_id` link points and the `quote_ref` message kind, which the **separate manual-quote plan** builds on. That plan owns vendor profiles, manual projects and quotes, and turning an inquiry into an order.
  - `ConversationsController`, `MessagesController` (web only, text only, no attachments).
  - Idempotent send with `seq` ordering.
  - Transmit channel.
  - Debounced notification emails (a `NewMessageNotification` mail class following `GuestClaimNotification` style: text + HTML, escaped). Emails are **notification-only with no body**, so notifications need no content-safety handling of their own.
  - Limiter.
  - Admin read-only access to conversations.
  - **Include the pipeline skeleton now** (`moderation/pipeline.ts`, types, registry, combiner, `moderation_evaluations`, `moderation_rule_hits`, `moderation_rule_configs`) with just three rules: `contact.email`, `contact.phone`, `url.any_non_allowlisted_holds`, plus a minimal `pending_review` queue. Messaging must never launch with *no* safety floor.
- **Depends on:** nothing new. Update DATABASE_FLOW.md with a "Messaging" section and the order→conversation lifecycle.
- **Decisions:** D1–D5.
- **Can wait:** email replies, attachments, the LLM, behavioral rules beyond rate limits.
- **Tests:**
  - Functional: participant authorization (404 for non-participants, vendor reassignment cuts off access, a guest can't reach the API), idempotency, `seq` ordering under concurrent sends, close transitions, notification debouncing with `mail.fake()`.
  - Unit: the three rules.

### Step 2: Deterministic abuse prevention

- **Build:**
  - The full normalizer and extractor set.
  - The contact, payment, advertising, spam-duplicate, profanity and injection rules from the catalog.
  - Shadow mode.
  - Admin endpoints for rule config (with `moderation_actions` logging).
  - User-facing block reasons.
  - Reports (`message_reports` → cases).
  - Basic case queue and actions (approve, block, remove, restrict).
  - The regression corpus and its spec.
- **Depends on:** Step 1.
- **Decisions:**
  - The precedence and score thresholds, as constants per trust tier.
  - Which rules launch in enforce versus shadow. Recommendation: `contact.email`, `contact.phone` (validated), `payment.crypto_address` and `payment.bank_details` enforce; everything else shadow for 2–4 weeks.
- **New dependencies** (need approval): `libphonenumber-js`, `linkify-it`, `tldts`, `obscenity`, a UTS #39 confusables package.
- **Can wait:** remote URL checks, the LLM.
- **Tests:**
  - Unit fixtures per rule, including obfuscation variants and legitimate look-alikes: dimensions such as "120x80x40", order numbers, "I paid with PayPal", "Prusa MK4".
  - Corpus regression.
  - Functional: a blocked message is visible to the sender only; a report creates a case.

### Step 3: URL security and reputation

- **Build:**
  - `url_domains`, `url_scans`, `message_urls`.
  - Normalization and static checks.
  - A seeded allowlist.
  - The Web Risk client, the RDAP client, and the hardened `safe_url_fetcher` (separate Lambda or task recommended).
  - The `AnalyzeMessage` job and the `held` flow.
  - The click-through interstitial.
  - `RescanRecentUrls` with retroactive removal.
  - Admin allow/block list endpoints.
  - Attachments (presigned upload to a quarantine prefix, magic-byte sniffing, a type allowlist, scanning, promotion) and QR decoding. Attachments live here because they share the async hold mechanics.
- **Depends on:** Step 2, a GCP project for Web Risk, and D7 (scanning).
- **Can wait:** Spamhaus, sandbox scanners, OCR.
- **Tests:**
  - Unit: normalization tables (punycode, confusables, `hxxp`, `[.]`, percent-encoding, IP encodings like `http://0x7f.1`, `http://2130706433`).
  - SSRF: a mocked DNS returning private, IPv6-mapped and rebinding answers; redirect to 169.254.169.254; hop and byte caps; slowloris timeouts.
  - Functional: a held message is delivered or blocked after the job, with Web Risk mocked. Rescan removes messages retroactively.

### Step 4: Behavioral detection

- **Build:**
  - Sync behavior lookups and the rules that use them (fan-out, duplicates across senders, blocked-attempt auto-hold, new-tier thresholds).
  - Full trust-tier logic.
  - The `RecomputeRiskProfiles` job (baselines, anomaly detection).
  - Cross-account clustering cases.
  - The `SampleAuditMessages` job.
- **Depends on:** Steps 2–3. The anomaly baselines start empty and fill in after launch. Until then, only the fixed-threshold behavioral rules (rate caps, fan-out, auto-hold after repeated blocks) have any effect.
- **Can wait:** IP and device fingerprint clustering. We don't currently store request IPs per message; decide then whether to store a /24 hash.
- **Tests:**
  - Functional, time-travelled: seeded message histories drive tier promotion and demotion, auto-hold after N blocks, and fan-out detection.
  - Performance: the sync stage stays under 50 ms at p95 with 100K seeded messages (Postgres, not SQLite).

### Step 5: Reply-by-email (exploratory: spike, then build)

This channel is optional and comes after steps 2–3, because any email reply has to pass the same moderation pipeline.

- **5a. Spike (about 1 week, throwaway code, run on staging):**
  - Set up a `reply.` subdomain with SES inbound → S3.
  - Collect 50–100 real replies from Gmail, Outlook, Apple Mail, iOS and Android, including business signatures and forwards.
  - Measure how accurate reply extraction and signature stripping are, and how often the moderation pipeline would escalate the result.
  - **Go/no-go:** go if more than about 90% of replies come out clean with no human needed.
- **5b. Build (only if the spike is a go). Text-only v1 behind a feature flag, with attachments discarded. See section 11, "Is reply-by-email worth the risk?"**
  - The `reply.makexyz.com` DNS setup, SES rule set, S3 bucket and SNS topic (infrastructure outside this repo).
  - `SesInboundWebhooksController` with SNS verification.
  - `inbound_emails`.
  - The `ProcessInboundEmail` job with MIME parsing, reply and signature stripping, loop filters, sender verification and routing.
  - Email-only rules.
  - Reply-by-email is available only to account holders (guests must claim an account, D3).
- **New dependencies:** `mailparser`, `email-reply-parser` (or equivalent), `html-to-text`.
- **Tests:**
  - A fixture library of real-world MIME: Gmail, Outlook, Apple Mail, iOS, and Android replies; forwarded mail; HTML-only mail; autoresponders; bounces; oversized mail; nested multiparts; malformed headers; spoofed From with DMARC fail; multiple aliases.
  - SNS signature verification with a test cert.
  - Duplicate SES ids.
  - An expired alias.

### Step 6: LLM-assisted moderation

- **Build:**
  - `llm_moderation_service`: context assembly with pseudonymization, a versioned prompt template, structured output schema, prompt caching, a fail-closed path, and per-sender budgets.
  - The escalation band wired into `AnalyzeMessage`.
  - LLM results in `moderation_evaluations.llm`.
  - Cost metrics.
  - Optionally, Rekognition image moderation on escalated images. OpenAI's endpoint is set aside to keep all processing in AWS.
- **Depends on:** Steps 2–4 (the escalation signals), an eval set, and D6.
- **Tests:**
  - An **offline eval set**, built from corpus and case labels, measuring precision and recall per category and the false-allow rate. Includes context-sensitive pairs (the "another way to work together" pair) and injection attempts.
  - Unit: schema validation and fail-closed on malformed or refused output.
  - Functional: the SDK mocked, and the thresholds mapping to the right states.

### Step 7: Human moderation tooling and the pattern-discovery loop

- **Build:**
  - The full case detail endpoint (everything in section 8).
  - Claiming, priority ordering, and a daily admin email digest when held items are waiting.
  - All actions, including warning and restricting users and closing conversations.
  - Labels (category, pattern note, missed-by-automation).
  - The `moderation:replay` ace command.
  - The `DiscoverAbusePatterns` weekly job (deterministic clustering + optional LLM summaries through Bedrock).
  - Precision and recall reporting per rule.
  - Corpus export for anonymized fixtures.
- **Depends on:** everything above. Basic queue and actions already exist from step 2.
- **Tests:**
  - Replay determinism: the same inputs and versions give the same decisions.
  - Clustering on seeded false negatives.
  - The admin authorization matrix.

A minimal human-review queue is built in Step 2, alongside the first enforcing rules, because enforcement without a way to review decisions is unsafe. Everything still launches together.

---

## Decisions (all resolved)

| # | Decision |
|---|---|
| D1/D2 | Only customer accounts with a verified email start inquiries. The vendor's display name is shown in inquiry and manual-quote threads, and instant-quote order threads stay white-label. There are threads for both flows and for support. Vendors can only reply. The manual quote and order mechanics get their own plan |
| D3 | **Guests must claim an account** to read or reply in an order thread. They get no-body notifications with a claim call to action. There's no signed guest link and no email replies from guests |
| D4 | **Contact details are always blocked**, in both directions, at every stage |
| D5 | **Notifications include moderated text** for delivered, non-flagged messages from standard or trusted senders. Everything else gets a no-body notification |
| D6 | **Claude Sonnet 5 on Amazon Bedrock.** The eval set still validates the thresholds before enforcement |
| D7 | **Attachments: images (re-encoded), PDF (no JavaScript or embedded files), and the existing 3D/CAD allowlist. No archives.** Scanning uses **GuardDuty Malware Protection for S3** (verify it's available in us-west-1 and check pricing) |
| D8 | **Admins review on a best-effort basis, with no set response time.** So the design minimizes pre-delivery human holds:<ul><li>Clear violations are blocked, with a reason and a "contact support" path.</li><li>Ambiguous cases go to Sonnet 5. Human review is for what the LLM can't decide and for harassment or threats.</li><li>Lower-risk ambiguity is delivered as `delivered_flagged` and reviewed afterwards.</li><li>A daily email digest goes to admins when held items are waiting.</li><li>A held message is never auto-delivered on timeout, but the sender can withdraw and rephrase it at any time.</li></ul> |
| D9 | **Production runs in us-west-1.** SES receiving works there. Bedrock is called through a separate `BEDROCK_REGION` (see section 12) |
| D10 | **Retention:** message bodies for the life of the order + 3 years; blocked, removed and labelled messages with their moderation data for 3 years; normalized text of clean messages for 180 days; raw inbound MIME for 90 days |
| D11 | **All listed dependencies are approved:** libphonenumber-js, linkify-it, tldts, obscenity, a confusables library, @anthropic-ai/bedrock-sdk, a QR decoder + sharp, and, if reply-by-email ships, mailparser, an email-reply-parser and html-to-text. Exact package picks are confirmed when implementation starts |
| D12 | **Email verification before a customer's first inquiry**, via a signed link (reusing the guest-claim mechanism). Other features aren't gated |
| D13 | **Legacy message history is used as test data only.** It's exported and anonymized for rule fixtures, the LLM eval set and starting thresholds, and it isn't imported for users |
| D14 | **Inquiry caps:** 5 new per day for `new`-tier customers, 20 per day otherwise. Inquiries go idle and read-only after **60 days**, and the customer can reopen within 90 days |

## Verification

- `npm run typecheck`, `npm run lint`, and `npm test` (unit rule specs + functional suites) after every step.
- Run the migrations against Postgres (per memory: schema regeneration uses a throwaway pg DB, not SQLite) and check that `database/schema.ts` regenerates with the `schema_rules.ts` unions.
- End-to-end locally: `npm run dev` + `node ace queue:work`.
  - Accept an order as a vendor, then exchange messages as customer and vendor over the API.
  - Send contact info and a shortener URL and watch the block and hold flows.
  - Resolve a case through the admin endpoints.
- Step 5: send real mail through SES to a staging `reply.` subdomain and run the MIME fixture suite.
- Step 6: run the offline eval set and record precision, recall and cost before enabling it in enforce mode.
- Update `docs/DATABASE_FLOW.md` (a Messaging lifecycle section) and add a `docs/MESSAGING_MODERATION.md`, following the precedent of `VENDOR_ONBOARDING.md` being maintained alongside its flow.

---

## Amendments from the manual-quote plan

The manual-quote plan (`docs/plans/manual_quotes.md`) amends this plan as follows. Where these conflict with the text above, these win:

1. **Illegal and prohibited activity:** add the `prohibited.*` rule family (section 8) to the rule catalog, `prohibited_goods` to the LLM categories, and "prohibited item" to report and decline reasons. Unambiguous terms enforce at launch. The rest start in shadow mode.
2. **Moderated surfaces:** the pipeline also runs on manual quote text (`kind = quote`), vendor profile text, rating text and vendor replies, and file names. `moderation_evaluations` gains a nullable `subject_type` / `subject_id` (quote, vendor_profile, vendor_rating, project_file) alongside `message_id`, so the same explainability and case tooling cover them.
3. **`moderation_cases.source`** gets `quote_outlier`, `unconfirmed_delivery` and `prohibited_item`.
4. **The deal phase in the LLM context** now comes from the real quote states (draft/sent/superseded/accepted) defined here.
5. **Instant-quote uploads:** file-name prohibited checks apply to them too, via `needs_review`.
6. **Response statistics:** inquiry conversations record `first_customer_message_delivered_at` and `first_vendor_response_at` (a reply or a decline), so `vendor_response_stats_service` can compute the response rate and time without scanning messages.
7. **The customer risk profile** gains an input: vendors' private ratings of customers (`customer_ratings`). Low ratings from several vendors open a `behavioral` case.
8. **Public images** (vendor photo and portfolio) reuse the attachment scanning pipeline and add a Rekognition moderation check. They also get a `vendor_image` subject type for cases.
