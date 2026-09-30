> Approved plan, not yet implemented. Companion plan: [messaging_moderation.md](./messaging_moderation.md).

# Manual quotes: inquiry → vendor quote → order


## Context

The legacy MakeXYZ app lets customers message a vendor, and the vendor can then build a custom quote by hand. That quote becomes an order outside the instant-quote flow. The new API already anticipates this (`projects.source = 'manual'`), but nothing is built for it yet.

This plan covers:
- vendor discovery (location- and rating-ranked search, and public profiles);
- customer ratings of vendors;
- turning an inquiry into a manual project;
- the vendor writing, sending and revising a quote;
- the customer accepting and paying;
- the order going straight to that vendor;
- the vendor shipping with their own carrier;
- commission and payout.

It also adds prohibited-item detection, which applies to messaging too. The messaging plan supplies the inquiry threads that manual quotes live in.

**Decisions made:**

| Topic | Decision |
|---|---|
| Commission | The vendor enters the **customer-facing price**. MakeXYZ keeps a **single platform commission rate** and pays out the rest. The customer sees one price, plus tax |
| Shipping | **The vendor quotes shipping** as a quote line and ships with their own carrier, entering the tracking number |
| Acceptance | **Payment auto-accepts the order** for that vendor and captures immediately. There's no routing and no pool |
| Line items | **Freeform lines** (description, quantity, unit price), each with an optional link to a customer file and an optional material |
| Discovery | A **public vendor search with profiles**, carried over from the legacy app (`makexyz/xyz/search`, `makexyz/elastic`). It's ranked by the **legacy formula** (rating tier × review-volume bonus × response rate, plus a gentle distance decay with no hard radius), with the volume bonus fixed. It's filterable by service, technology and material. There's no map and no Elasticsearch |
| Location data | **Google.** Vendors are geocoded with the Google Geocoding API at city/postal precision, like legacy, and re-geocoded within Google's 30-day caching limit. The frontend search box uses the Google Places API and passes coordinates plus address components to the search. **City pages are stored by postal code, not coordinates**, and are found from the Places result's postal code or city, with a reverse geocode as the fallback |
| Carried over | **Search logging and the city-page SEO loop** (unmatched searches → candidates → a weekly digest → new city pages; indexability scoring by supply, demand and revenue), response rate/time (ranking + profile), a newcomer boost, city pages and city search, profile photo + portfolio images, a price indicator, design/scanning/CNC services, rating-request emails, vendor-rates-customer, and similar-vendor suggestions |
| Not carried over | Sponsored listings; per-machine listings and the resolution/printer-model filters; admin approval of every rating (automatic moderation is used instead) |
| Ratings | Customers rate vendors **after any delivered order, in both flows**: 1–5 stars, plus optional moderated text. Instant-quote ratings count toward the score, but text reviews are shown only for manual orders |
| Legacy data | **Legacy ratings are imported.** Vendor locations are **re-geocoded** at import, not copied: the legacy coordinates came from Google's Geocoding API (`xyz/apis/google_geo.py`) and are far older than the 30 days Google allows. Legacy city pages are imported as names, slugs and postal codes only |
| Validity | **The vendor sets the expiry** (default 30 days, max 90). Changes are made by sending a **new revision**, which replaces the previous one |
| Review | **No admin approval before sending.** Quote text goes through message moderation. Outlier totals open a case after sending. **Prohibited-item checks** apply to quotes, messages, profiles and file names |
| Prohibited | All firearm parts and accessories, other weapons, drugs and paraphernalia, counterfeit/IP goods and fraud devices. **Unambiguous terms block and open a case. Ambiguous terms escalate to the LLM, then to a human** |

**Existing code this plan reuses:**
- `quotes` revision lineage (`origin_quote_id`, `revision`) and `QuoteTransformer`.
- `CheckoutSession` → `Payment` → `Order` / `OrderItem` creation (`checkout_service.ts: createCheckoutSession`, `authorizeCheckoutSession`, `finalizeAuthorization`, `captureCheckoutSession`).
- Stripe Tax through `tax_calculator_service` / `computeShippingProductionAndTax`.
- Vendor eligibility checks in `order_acceptance_service` (`hasCurrentAgreement`, `assertPayoutMethodReady`).
- `createPayoutForAcceptedOrder` and the payout scheduler.
- `order_production_service` (start-production and ready-to-ship transitions).
- `shipment_tracking_service.applyTrackerUpdate`. `easypost_webhooks_controller.findShipment` already falls back to matching on `tracking_code`, so a tracker created only from a vendor-entered tracking number flows through the existing delivery → payout logic.
- `refund_service.recordRefund` (webhook-side recording only; issuing is new, see section 7), `address_service`, `project_grant_service.isStaff` / `isAdmin`, `audit_events`.

---

## 1. End-to-end flow

```
Customer searches POST /v1/vendors/search {location: lat/lng + address parts from Google Places | city slug; service, technology, material} → ranked vendors (rating, response rate, distance) + the matching city page → profile
  → "Request a quote": POST /v1/vendors/:vendorUuid/inquiries   (messaging plan: verified account, caps, moderation)
      body + optional file attachments (messaging attachments, scanned)
Vendor replies in the thread; when ready:
  POST /v1/vendor/inquiries/:conversationUuid/project            → manual project (source=manual, customer from the thread,
                                                                  vendor_id = this vendor); chosen attachments are copied in as project_files
  POST /v1/vendor/projects/:projectUuid/quotes                   → draft quote (lines, shipping line, notes, expiry, ship-to country/postal)
  PATCH …/quotes/:uuid (draft only) · POST …/quotes/:uuid/send   → moderation + prohibited-items + outlier checks → status 'sent'
      → system message `quote_ref` in the thread; notification email
Customer: GET /v1/projects/:projectUuid/quotes (existing index, now also account-owned manual projects)
  → decline (PATCH …/decline, optional reason → thread)  or  ask for changes in the thread → vendor sends revision N+1 (supersedes N)
  → configure: choose a full shipping address (must match the quoted country + postal code) → tax computed
  → pay: existing POST …/quotes/:uuid/pay (+ paypal-order)
      → payment authorized → order created with vendor_id preset, status 'accepted', capture immediately
      → vendor payout created (commission applied); conversation.order_id set; system message
Vendor: start-production → ready-to-ship → POST /v1/vendor/orders/:uuid/tracking {carrier, trackingNumber}
  → Shipment row (vendor_shipped) + EasyPost Tracker → existing webhook → shipped → delivered → payout eligible
```

---

## 2. Vendor directory and profiles

- **New public profile fields on `vendors`:**
  - `profile_slug` (unique);
  - `bio` (text, at most 2,000 chars);
  - `accepting_inquiries` (bool, default false);
  - `profile_published_at`.

- **Visibility:** the vendor must be `active`, have `accepting_inquiries` set, and have a published profile. A suspended vendor disappears from the directory.
- **Capabilities shown:** approved `vendor_technology_capabilities`. Materials come from the materials the vendor has a `vendor_payout_rates` row for, meaning materials an admin has approved them to make. This avoids a second, self-declared materials list that could drift.
- **Public location display:** city, state and country from the business address, plus the **distance** from the searcher, rounded to whole miles or km. **Coordinates and the street address are never returned by the API.**
- **Endpoints:**
  - `POST /v1/vendors/search` (public). It's a POST so the searcher's precise location stays out of URLs, access logs and caches. Coordinates are rounded to about 1 km (3 decimal places) before any logging or caching.
  - `GET /v1/vendors/:slug` (public).
  - `GET /v1/vendor/profile` and `PATCH /v1/vendor/profile` (for the vendor).
- **Transformers:** `PublicVendorProfileTransformer` exposes only the public fields. It never includes legal name, phone, email, website, payout details, coordinates or the full address. **Moderation:** `bio` and `display_name` run through the messaging sync pipeline (contact, URL, advertising and prohibited-item rules) before saving. A block returns 422 with the reason. Admins can unpublish a profile.
- **Existing onboarding:** `display_name` already exists. The profile fields become optional onboarding items, and `docs/VENDOR_ONBOARDING.md` is updated in the same change, as it requires.

### 2a. Geolocation search

**How the legacy app does it** (read from `makexyz/elastic/search_query.py`, `xyz/search/services.py`, `xyz/search/mysql_backend.py` and `xyz/views/main.py`):
- An Elasticsearch `function_score` query over one document per printer.
- Vendor coordinates are geocoded by Google from "city, state zip", which is city-level precision.
- The customer's location comes from browser lat/lng or a city slug (`ServiceLocation`).
- The legacy `mysql_backend.py` spike already showed the ranking can be reproduced without Elasticsearch.

**Geocoding with Google** (`geocoding_service`, the Google Geocoding API, server-side key `GOOGLE_GEOCODING_API_KEY`, restricted to the Geocoding API). The frontend uses the **Google Places API** for the search box.
- **The city's Google place ID is the stored key.** Vendor location is city-level anyway (legacy `GoogleGeo.lat_lng_from_address`), so the business address's **city, state/region and country** are geocoded to the city's (locality's) **place ID**. Google allows place IDs to be kept indefinitely.
  - Stored on `vendors` as `place_id`, `place_type`, `place_id_refreshed_at`, `geocode_status`.
  - Geocoded when the address is set or changed.
  - Fallback when an address has no locality (unincorporated areas): the sublocality place ID, then the postal-code place ID.
- **Coordinates are cached per place, not per vendor.** Distance ranking still needs latitude/longitude, and Google allows those to be kept for only 30 days.
  - A **`place_coordinates`** cache (`place_id`, `lat`, `lng`, `expires_at` ≤ 30 days) holds them, keyed by place ID.
  - All vendors in a city share one row, and city pages use the same rows, so the number of refresh calls scales with **distinct cities, not vendors**.
  - A daily `RefreshPlaceCoordinates` job looks up by place ID (`geocode?place_id=`) every place ID in use by a vendor or indexable city page whose cache entry expires within 5 days.
  - If a refresh fails and the entry expires, the vendors there still appear in search, ranked on reputation only, until the next success.
- **Keeping place IDs current:** Google says place IDs can change or become obsolete, and recommends refreshing any older than 12 months. A refresh that requests only the place ID is free.
  - A monthly `RefreshPlaceIds` job refreshes any stored place ID (vendors, city pages, candidates) older than 12 months and updates it everywhere it's used.
  - A `NOT_FOUND` result triggers a re-geocode from the stored city, state and country.
- **The searcher's location.** The search endpoint accepts:
  1. `lat` / `lng`, plus optional `postalCode`, `city`, `state`, `country`: taken by the frontend from a **Google Places** result (or from browser geolocation, coordinates only). The coordinates are used for this one search and never stored.
  2. `locationSlug`: a city page (section 2c).
  3. Nothing: the proximity term is zero and the results are ranked by reputation alone, as in legacy.

**Query. Directly against PostgreSQL through Lucid, with no Elasticsearch or other search engine, index or sync process:**
1. Filter in SQL on visibility, `service`, `technology` and `material`, joined to `place_coordinates` for each vendor's city coordinates.
2. Compute the haversine distance and the score **in application code** over the matching vendors.
3. Sort and paginate.

There's no hard radius, as in legacy; an optional `maxDistanceMiles` filter is available. Because the ranking is a function of every matching vendor, the candidate set is the whole filtered vendor list. With a few thousand vendors that's a single indexed query and a sub-millisecond loop. It needs no PostGIS and runs the same on SQLite in tests. If vendor counts reach the tens of thousands, precompute reputation and move the distance calculation into SQL.

**Ranking** is the legacy formula with the volume bonus working. It lives in `vendor_ranking.ts`, with its constants in config.

```
reputation = ratingTier × (1 + (volume − 1) / 4) × responseFactor
  ratingTier     = 1.2 if rounded average = 5 · 1.13 if 4 · 0.9 if ≤ 3 · 1.05 if unrated
  volume         = min(1.5, 1 + ratingCount / 100)        (1 if unrated)
  responseFactor = responseRate / 100                     (1 if unknown)
proximity  = exp( ln(0.5) × max(0, distanceKm − 10) / 1000 )   (0 if no location given)
score      = 10 × (reputation + proximity);  results with score < 1 are dropped
```

- The legacy index stored `volume` as an integer, so the bonus never applied (documented in `mysql_backend.py`). Here it's computed in code, so it works: a vendor with 100 five-star reviews now outranks one with a single five-star review.
- Ties break on `rating_count` descending and then on uuid, so results are stable across pages.
- **The newcomer boost** follows legacy `get_noob`. On the first page of an unfiltered search with a location, one random vendor is inserted at position 5 if it's within 25 miles, has no ratings, has an unknown or 100% response rate, and isn't already on the page.

### 2c. City pages and city search

City pages are stored **by the city's Google place ID, plus their postal codes, never by coordinates**.

- **`service_locations`:** `slug`, `city`, `state`, `country`, **`place_id` (unique)**, `place_id_refreshed_at`, `is_indexable`, and the scoring columns. This is the city page ("3D printers in Austin"). A vendor and a city page in the same city share the same place ID.
- **`service_location_postal_codes`:** `service_location_id`, `country`, `postal_code` (unique on country + postal code). This is a secondary lookup for searches that name a postal code or an address.
  - It's seeded from the legacy `ServiceLocation` rows and from vendors' own business addresses, which are user-provided data, not Google content.
  - A vendor whose city isn't covered creates a city page, non-indexable until it's scored.
- **Finding the city page for a search** (`service_location_service.resolve`):
  1. **Match on the place ID.** When the customer picks a city in the Places search box, the result's place ID is the same locality place ID stored on the city page, so it's a direct lookup.

     Google doesn't *guarantee* that every endpoint returns identical IDs for all place types. Cities (localities) are the stable case, and the other steps cover any mismatch.
  2. If the customer picked an address or a postal code, that result's place ID is for the address or postal code, not the city. So match its **postal code** in `service_location_postal_codes`.
  3. Otherwise match on **city + state + country** from the result's address components (slugified).
  4. If none of those match, the backend **reverse-geocodes the coordinates** through Google, reads that point's locality place ID and postal code, and repeats steps 1–3. A forward geocode of a city name returns no postal code, because a city spans many. Reverse-geocoding a point returns the locality and the postal code containing it.
  4. Still nothing: there's no stored city page for that place, but the search works **exactly the same way**. Vendors are ranked around the searcher's coordinates with the normal formula. The response describes the location from the reverse-geocode result (city, state, country, postal code) so the page is titled for that place, and it includes the **nearest indexable city page** as the canonical link. This is what the legacy app does (`SeoCityPage.nearest_indexable` in `serp_router` / `printers()`).

  **Results are always the vendors nearest the searched point, ranked by the formula. They're never a generic or unlocated list.** The city page only affects the page's title, URL and canonical link, not which vendors are returned.

  A postal code learned in step 3 is added to the mapping for that city when a city match exists, so the next search skips the reverse geocode.
- **City pages need a center point** for ranking, when a search arrives by `locationSlug` with no coordinates (server-rendered SEO pages). They use the city's place ID to read `place_coordinates`, the same 30-day cache the vendors use. `RefreshPlaceCoordinates` keeps indexable cities warm, so city pages never wait on Google.
- **Endpoints:**
  - `GET /v1/locations` lists the indexable cities, for the sitemap and city index.
  - `GET /v1/locations/:slug` returns a city with its nearest indexable city. That's the canonical target when a small city has no vendors, mirroring `SeoCityPage.nearest_indexable`. It's computed from the cached coordinates.
- Which city pages are indexable is decided by the scoring job in section 2g, which ports the legacy `score_city_pages` rules.

### 2g. Search logging and growing the city-page table (SEO)

The legacy app records every search so that places with real demand can be promoted to city pages (`SearchEvent`, `LocationCandidate`, `location_candidates_digest`, `score_city_pages`). This carries over.

- **`search_events`**, written on every search-box search (best effort: a logging failure never fails the search):
  - `raw_query`: the text the customer typed or chose.
  - `place_id` (what the customer picked), `locality_place_id` (the city's place ID, used to group candidates and create city pages), `city`, `state`, `country`, `postal_code`: from the Places result or the reverse geocode. This is what a new city page would be created from.
  - `matched_location_id`: the city page the search resolved to. Null means there was no page for that place.
  - `canonical_location_id`: the nearest indexable city page within 50 miles, when it differs from the match.
  - `service`, `filters` (json), `result_count`, `session_key`, `customer_id` (nullable), `created_at`.
  - `lat` / `lng`, rounded to 2 decimal places. A daily job **nulls them after 30 days**, in keeping with Google's caching limit. Nothing downstream needs them by then, because the matched and canonical locations are computed at write time, as in legacy.
- **`landing_page_visits`** (`path`, `referrer`, `is_internal_referrer`, `session_key`, `created_at`), recorded by the frontend through `POST /v1/analytics/landing-visits` (throttled). This is the second first-party demand signal the legacy scoring uses, covering visitors who arrive from outside and never use the search box.
- **`location_candidates`** (`canonical_location_id` nullable + unique, `place_key`, `search_count`, `sample_queries` json, `status` of `new` / `notified` / `dismissed` / `actioned`, `first_detected_at`, `last_seen_at`).
- **The weekly `LocationCandidatesDigest` job** ports `location_candidates_digest`:
  - It takes unmatched searches from the last 90 days.
  - It groups them by the city page they snapped to, and additionally by the searched place itself (city + state + country), so the digest names the exact places worth adding.
  - It keeps groups with at least 5 distinct sessions.
  - It emails admins the new ones with sample queries, and re-reminds after 30 days unless the candidate is dismissed or actioned.
- **Admin endpoints:**
  - `GET /v1/admin/location-candidates`.
  - `POST /v1/admin/location-candidates/:id/action`: creates the city page (slug, city, state, country) and its postal codes from the grouped search events.
  - `POST …/dismiss`.
- **The weekly `ScoreCityPages` job** ports `score_city_pages`. A city page is **indexable** if it passes any one of:
  - **supply:** at least 3 active vendors within 25 miles;
  - **demand:** either of two sources, which are additive, as in legacy. Search Console is the only view of demand that hasn't reached the site yet. First-party data only sees visitors who already arrived.
    - **Google Search Console:** the city page had at least 1 click or at least 50 impressions in the trailing window.
    - **First-party:** at least 3 distinct sessions in `search_events` or `landing_page_visits` over 90 days.
  - **revenue:** a paid order shipped to that city in the last 730 days.

  Every other page is served as noindex and left out of `GET /v1/locations`. Each indexable page also records up to 15 **served area names** (non-indexable towns within 50 miles), which the frontend renders as "Serving: …".
  - The columns on `service_locations` are `is_indexable`, `vendors_25mi`, `search_demand`, `recent_orders`, `served_area_names` (json), `scored_at`.
  - The thresholds are config constants, with the legacy values as defaults.
  - Distances use `place_coordinates` for both the city page and the vendors.
  - **The Search Console integration** (`search_console_service`) ports `xyz/apis/gsc.py`:
    - It calls the Search Console API's `searchanalytics.query` with the `page` dimension.
    - It pages through results 25,000 rows at a time, and ends the window 2 days back to allow for Google's reporting lag.
    - It keeps the rows whose path starts with the city-page prefix. That prefix is a config value (legacy: `/3dprinters/`) and must match the new frontend's URL scheme.
    - It maps each path to a city slug, folding ZIP-suffixed legacy URLs into their city.
    - **Auth:** a Google service account with read-only access to the property, added as a "Restricted" user in Search Console. Its JSON key goes in `GSC_SERVICE_ACCOUNT_KEY_BASE64`, which is a secret: inject it through ECS secrets, not plain env.
    - The property identifier `GSC_SITE_URL` defaults to `sc-domain:makexyz.com`. Using the wrong form, domain versus URL-prefix, returns a 403.
    - **Failure behavior, the same as legacy:** "not configured" or "call failed" is kept distinct from "zero demand". In that case the job **keeps each page's previous `search_demand` value** and doesn't treat every page as having none.
    - A manual fallback stays available: `node ace seo:score-city-pages --gsc <pages.csv>` reads a Search Console "Pages" export, and `--dry-run` prints the summary without writing.
    - New dependency to approve: `google-auth-library`, for service-account tokens. The query itself is a plain `fetch`. The alternative is signing the token request with `node:crypto`, which needs no dependency.
  - Legacy ZIP-suffixed slug variants (`Tacoma-WA-98465`) aren't separate pages here. The postal-code mapping resolves them to the city page, and the import records each as a postal code of its city.

### 2d. Services, price indicator, photos

- **Services beyond printing:** a `vendor_services` table: `vendor_id`, `service` (`design`, `scanning`, `cnc`), `active`, `rate` (decimal, e.g. the hourly design rate), `rate_unit`, `description` (moderated). Unique on (`vendor_id`, `service`).
  - Printing isn't a row here. It's derived from approved `vendor_technology_capabilities`.
  - The search filter is `service = printing | design | scanning | cnc`.
  - These services are quoted through manual quotes as `service` lines. There's no instant quote for them.
  - Admins can deactivate a service.
- **Price indicator:** a `vendor_indicative_prices` table (`vendor_id`, `material_id`, `price_per_cm3`) holds what the vendor publishes. It's not binding, and manual quotes stay freeform.
  - The profile and search results show `priceTier` 1–4 (the "$ to $$$$"), derived from the vendor's cheapest price with the legacy thresholds: under 0.49 → 1, under 1.49 → 2, under 3.24 → 3, otherwise 4. The thresholds are config values.
  - Designers show their hourly rate.
- **Profile photo and portfolio images:** a `vendor_images` table: `uuid`, `vendor_id`, `kind` (`profile`, `portfolio`), `storage_key`, `position`, `status` (`pending`, `approved`, `rejected`). One profile photo and up to 12 portfolio images.
  1. The image is uploaded through a presigned URL to a quarantine prefix.
  2. It's scanned for malware (GuardDuty, as for message attachments).
  3. It's re-encoded with `sharp`, which strips metadata, and thumbnails are generated.
  4. It's checked with **Rekognition `DetectModerationLabels`** (explicit or violent content), and QR codes or text in the image go through the URL/contact rules. Every one of these images is public, so each is checked, not only the escalated ones.
  5. Approved images are served from a public-read prefix (via CloudFront if available).

  Admins can reject an image.

### 2e. Response rate and response time

- Both are computed from **inquiry conversations** (messaging plan) and cached on `vendors` as `response_rate` (0–100, null = unknown) and `response_time_hours` (median, null = unknown).
- **Response rate** = the share of the vendor's inquiries in the last 90 days that got a vendor reply, or a decline, within 7 days.
  - Only inquiries whose first message was **delivered** are counted. Inquiries blocked or removed by moderation are excluded, as are ones where the vendor reported the customer.
  - Inquiries less than 7 days old with no reply yet aren't counted either way.
- **Response time** = the median hours from the customer's first delivered message to the vendor's first reply, over the 6 most recent responded inquiries, as in legacy. It's shown as a group: "within a few hours", "within a day", "a few days".
- They're recomputed when a vendor replies or declines, and by a daily job, so that unanswered inquiries age into the rate.
- The rate feeds `responseFactor` in the ranking, and both are shown on the profile.

### 2f. Similar-vendor suggestions

- `GET /v1/vendors/:slug/similar` (authenticated customers get personalized results).
- It returns up to 4 vendors offering the same service, ranked by the normal formula around **that vendor's** location. It excludes the vendor itself and any vendor the customer already has an inquiry with.
- The frontend shows it after an inquiry is sent. It mirrors legacy `recs_from_intent` / `get_recs`.
- The inquiry caps from the messaging plan still apply.

### 2b. Vendor ratings

- **Eligibility:** the order's customer can rate once the order is `delivered`, in either flow. It's **one rating per order**, available for 60 days after delivery. It can be edited within 14 days of submitting, and it can't be rated if the order was fully refunded or cancelled.
- **Content:**
  - 1–5 stars, plus optional text (at most 1,000 chars) that goes through the moderation pipeline before it's shown (contact details, URLs, advertising, prohibited items, harassment).
  - **Instant-quote orders:** the rating counts toward the vendor's score, but the text is **never shown publicly**. It's staff-only feedback. The customer never learned the vendor's identity, and showing text on the vendor's profile would reveal who made the part.
  - **Manual orders:** the text is shown on the vendor's profile with the customer's first name and last initial.
- **The vendor side:** a vendor can post one public reply per review (moderated) and can report a review. A reported review goes to the moderation queue; an admin can hide it, which removes it from the aggregate.
- **Aggregate:** `vendors.rating_count` and `rating_average` are recomputed in the same transaction as any rating insert, edit or hide, so search reads a single row per vendor.
- **Rating request emails:** a `SendRatingRequests` job emails the customer 3 days after delivery and sends up to two reminders (day 7 and day 14). It stops once the order is rated, or if the order is refunded or cancelled.
  - `rating_request_count` and `rating_last_requested_at` on the order make it idempotent.
  - Guest customers with instant-quote orders get a signed, expiring link, so they can leave a star rating without an account.
  - It uses `mail.fake()` in tests, and a failed send is logged without failing the job, like other mail.
- **Vendor rates customer** (legacy `customer_stars` / `customer_comment`): after delivery the vendor can leave 1–5 stars and a private note about the customer, once per order.
  - It's stored in `customer_ratings`. It's visible to staff and to that vendor only, and never to the customer or other vendors.
  - It feeds the customer's messaging risk profile: low ratings from several vendors open a case.
- **Integrity:** ratings need a paid, delivered order, and delivery needs carrier confirmation or an admin decision (section 6), which makes fake reviews expensive. Admin cases open for:
  - a burst of 5-star ratings on one vendor from new accounts;
  - customers who share a payment fingerprint with the vendor's (Stripe card fingerprint, where available).
- **Legacy import:** legacy ratings where `completed` and `approved` are both true (`xyz.models.Rating`, where `sender` is the maker being rated) are imported as `source = 'legacy'` rows with the original date, stars and vendor reply, and text if present (run through moderation, with any flagged text hidden). They're linked to the vendor; the legacy customer and order are kept as a reference string, since those records aren't in this system. They count in the aggregate.

---

## 3. Manual projects and files

- **Created only by the vendor, from an inquiry thread** (`project_service.createManualProject`):
  - `source = 'manual'`;
  - `customer_id` = the thread's customer;
  - new `projects.vendor_id` (nullable FK), meaning the vendor a manual project is directed to;
  - `title` from the inquiry subject.

  It sets `conversations.project_id`, the link point the messaging plan reserved.
- **One inquiry can lead to several projects** over time (repeat work). Each one sets `project_id`. The conversation keeps a history of projects, and quote messages reference the specific quote.
- **Files:** the vendor selects clean, scanned attachments from the thread, and they're **copied** into project storage. The key follows the existing convention, `${S3_FILE_STORAGE_KEY}/${projectUuid}/${fileUuid}.${ext}`. A `project_files` row is created with `technology` / `material` null and **no slicing job**. Manual pricing doesn't need slicer output. Slicing can be added later as a "get print estimates" helper for the vendor.
- **Guarding the instant-quote logic:** `technology_lock_service`, `expire_abandoned_projects` and `purge_expired_projects` must skip `source = 'manual'` projects. Their queries need a `source = 'instant_quote'` filter, which is verified in tests.

---

## 4. Manual quotes

### Schema additions (`quotes`, new migration)

| Column | Purpose |
|---|---|
| `vendor_id` | The authoring vendor. Null for instant quotes |
| `expires_at` | Set on send: the vendor's choice, default +30 days, at most +90 |
| `sent_at` | When the quote was sent |
| `commission_rate` (decimal 5,2) | A **snapshot** of the platform rate when the quote was sent. A later change to the rate never alters a sent quote |
| `quoted_destination_country`, `quoted_destination_postal_code` | What the vendor priced shipping against |
| `superseded_by_quote_id` | Set when a newer revision is sent |

- **Status:** reuse the existing enum `draft → sent → accepted | rejected`. Rejection reasons: `declined` (by the customer), `abandoned` (expired), and a new `superseded` (a later revision replaced it). `rejection_reason` gets the new value in the migration and in `schema_rules.ts`.
- **Lineage:** revision N+1 copies `origin_quote_id` from the root, the same as `configureQuote` does. Sending N+1 atomically rejects N as `superseded`. Only one `sent` quote per lineage can exist at a time.
- **Where `generated_by` comes from:** `'user'` for manual quotes (existing enum).

### `quote_items` additions

| Column | Purpose |
|---|---|
| `material_id` (nullable) | Optional material for the line |
| `line_kind` enum (`part`, `service`, `shipping`) | `shipping` lines are exempt from commission and use the shipping tax code in Stripe Tax |

- `project_file_id` is already nullable.
- `unit_price`, `quantity` and `total` are validated and computed server-side with decimal-string arithmetic (integer cents, as in `payout_calculation_service`). The client's `total` is never trusted.

### Rules for sending (`manual_quote_service.sendQuote`)

1. The vendor must still be eligible: `active`, a current agreement (`hasCurrentAgreement`), and a ready payout method (`assertPayoutMethodReady`). The same checks run again at payment.
2. At least one `part` or `service` line, and exactly one `shipping` line. The shipping line may be $0 ("pickup/free").
3. All text (notes, line descriptions) passes the **messaging moderation sync pipeline** with `kind = quote`. Contact details, payment redirection and prohibited items → 422 with the reason, and the quote stays a draft. The evaluation is stored against the quote (see section 11).
4. **Outlier checks:** a total over a configurable ceiling, a unit price under a floor while the quantity is large, a shipping line more than X% of the subtotal, or a 10× jump between revisions. These **don't block**. The quote is sent and a `moderation_cases` row is opened with `source = 'quote_outlier'`.
5. On success:
   - `status = sent`, `sent_at`, `expires_at`, and the `commission_rate` snapshot are set;
   - the previous sent revision becomes `superseded`;
   - a `quote_ref` system message is posted in the thread;
   - the customer is notified.

### The customer's side

- **Viewing:** the existing `QuotesController.index/show` gains manual projects through `resolveProject` (account-owned). `QuoteTransformer` adds `vendor` (display name + profile slug, manual only), `expiresAt`, and `lineKind` per line.
- **Configure** (the existing endpoint, which branches on `project.source`): the customer selects or creates an address. For manual quotes it must match `quoted_destination_country` and the postal code, where one was given. Otherwise 422, "ask the vendor to re-quote for this address". Tax is then computed on the vendor's lines. There's no production-time tier or platform shipping-method selection for manual quotes. Those fields stay null.
- **Decline:** `PATCH /v1/projects/:projectUuid/quotes/:uuid/decline`. It rejects with `declined` and posts a system message in the thread.
- **Expiry:** the hourly `ExpireManualQuotes` job rejects `sent` quotes past `expires_at` with `abandoned`, and posts a system message.

---

## 5. Checkout, order and payment

- **Same endpoints:** `POST …/quotes/:uuid/pay` and `…/paypal-order`, with `createCheckoutSession` / `authorizeCheckoutSession` unchanged up to authorization.
- **Guards for manual quotes:**
  - the quote is `sent` and not expired;
  - the caller is the project's customer (account only);
  - the vendor is still eligible, re-checked here (this can fail with "vendor unavailable" and no charge);
  - an address is configured and tax has been computed.
- **`finalizeAuthorization` branches on `project.source`:**
  - Instant quote: unchanged, still followed by `routeNewOrder`.
  - Manual:
    1. Create the order with `vendor_id = quote.vendor_id`, `status = 'accepted'` and `routing_stage = null`, plus an `order_status_histories` row.
    2. Compute the **manual payout breakdown** and call `createPayoutForAcceptedOrder`.
    3. After commit, call `captureCheckoutSession(order)`. It's already guarded by the payment row lock and works unchanged for an order that starts out `accepted`.
    4. Set `conversations.order_id` and post a system message.
- **If capture fails:** the order is still created, since payment was authorized. Capture is retried by a new `CaptureManualOrders` hourly job that captures `accepted` manual orders whose payment is still `authorized`. It's safe because capture is idempotent under the payment lock. Staff can see the order the whole time.

### Payout (`payout_calculation_service`)

- A new `computeManualPayoutBreakdown(order)`:
  - `Σ(part/service line totals) × (1 − commission_rate)`, plus 100% of shipping lines;
  - integer cents, each line rounded once;
  - it produces the same `PayoutBreakdown` shape (lines + total). `productionTimeFee` is `0.00`.

  `computePayoutBreakdown` dispatches on the project's source, so instant quotes are unchanged.
- **The commission rate** comes from a new env var, `MANUAL_QUOTE_COMMISSION_RATE` (e.g. `15.00`), with a default applied in code, following the `start/limiter.ts` pattern so an unset variable can never mean zero. It's snapshotted onto the quote at send. Order items get `line_kind` copied through (a new `order_items.line_kind` column), so the payout is computed from immutable order data, not the quote.
- The **payout hold, the eligibility-after-delivery rule and the payout jobs** are all unchanged.

---

## 6. Fulfilment and shipping with the vendor's own carrier

- Production transitions reuse `VendorOrdersController.startProduction` / `readyToShip` (`order_production_service`).
- **`POST /v1/vendor/orders/:uuid/tracking`** (manual orders only) takes `{ carrier, trackingNumber, weightOz?, dims? }`. It:
  1. Creates a `shipments` row with `status = 'shipped'`, `shipped_at = now`, `address_id` = the order's address, and the new `source = 'vendor_tracking'`. Instant-quote label shipments get `source = 'easypost_label'`.
  2. Creates an EasyPost **Tracker** (`client.Tracker.create({ tracking_code, carrier })`) via `easypost_shipping_label_gateway`.
  3. Moves the order `ready_to_ship → shipped` through the existing conditional transition.

  **Standalone trackers:** EasyPost's Tracker API accepts any `tracking_code` (plus the recommended `carrier`) for labels bought elsewhere. The tracker then sends the same `tracker.created` / `tracker.updated` webhook events.
  - Cost: $0.03 per USPS tracker and $0.02 per other-carrier tracker. It's billed once per unique code, and re-creating the same code within 3 months returns the existing tracker for free.
  - A standalone tracker has no `shipment_id`, so `findShipment` falls through to its existing `tracking_code` match.
  - This plan adds a `shipments.easypost_tracker_id` column (unique), stored when the tracker is created. `findShipment` checks it first, so matching is exact even when two carriers reuse the same tracking-code format.
  - `applyTrackerUpdate` then delivers the order and starts the payout clock, unchanged.
  - Caveat from EasyPost's docs: some carriers restrict tracking data requested through third-party platforms. Those shipments fall under the "never confirmed" handling below.
- **Migration:** `shipments.weight_oz`, `length_in`, `width_in` and `height_in` become nullable (they're required only for bought labels, enforced in `shipment_service`). Add `shipments.source`.
- **Tracking that's never confirmed** (a bogus number, or a carrier EasyPost can't track): the order stays `shipped`. After N days (configurable, e.g. 21) with no `delivered`, an admin case is opened; the admin can mark it delivered or put the payout on hold. Payout therefore **requires carrier-confirmed delivery or an admin decision**. That's the anti-fraud control for tracking entered by the vendor.

---

## 7. Cancellation, refunds, disputes

- **The app can't issue refunds today.** `refund_service` only *records* refunds and disputes that arrive through provider webhooks, after staff have issued them from the Stripe or PayPal dashboard. Manual orders need an issuing path, so this plan adds:
  - `refundPayment(payment, amount, reason)` to both payment gateways (`stripe_payment_gateway`: a Stripe refund on the captured PaymentIntent with an idempotency key; `paypal_payment_gateway`: a refund of the capture). It's exposed through `payment_gateway_service`.
  - The existing webhook handlers still create the `Refund` row via `recordRefund` when the provider confirms, so there's still one path that writes refunds, and the webhook stays the source of truth.
- **Before shipping:** the vendor can cancel (`POST /v1/vendor/orders/:uuid/cancel`, with a reason). In one flow, that:
  1. marks the order `cancelled` (a conditional transition plus a history row);
  2. cancels the pending payout (`cancelPayout`);
  3. issues a full refund through the new gateway method;
  4. posts a thread message.

  Frequent vendor cancellations become a behavioral signal (a moderation case).
- **The customer can't cancel on their own** once the order is paid. They ask in the thread or contact support. A new admin endpoint, `POST /v1/admin/orders/:uuid/refund` (full or partial, with a reason), uses the same gateway method. Payout adjustments follow the existing `partial_refund` hold logic once the webhook records the refund.
- **Disputes and chargebacks:** the existing Stripe and PayPal webhook handling applies unchanged.

---

## 8. Prohibited items (applies to manual quotes, messaging, profiles and file names)

- **Rule family `prohibited.*`**, added to the messaging moderation pipeline. It's the same rule plugin architecture, and every rule starts in shadow mode except the unambiguous lexicons:

| Rule | Unambiguous terms → **block + case** | Ambiguous terms → **escalate** (LLM → human) |
|---|---|---|
| `prohibited.firearm` | auto sear, drop-in auto sear / DIAS, "Glock switch", conversion device, lightning link, 80% lower / 80 lower jig, "ghost gun", solvent trap, suppressor/silencer/"can" (in a firearm context), bump stock, forced reset trigger | receiver, lower, upper, frame, trigger, magazine/mag, slide, barrel, buffer tube, "AR", "Glock", caliber terms, jig |
| `prohibited.weapon` | brass/metal knuckles, gravity/push/butterfly knife parts, pipe bomb, detonator, grenade body | blade, knife, baton, "tactical" |
| `prohibited.drugs` | pill press die, tablet press punch, "bong" / "dab rig" (for sale) | grinder, pipe, press, scale |
| `prohibited.counterfeit_fraud` | card skimmer, ATM overlay, "replica badge", "fake ID", bump key / master key for sale | "replica", brand name plus "copy"/"dupe", lock pick, key blank |

  - **Evidence rules:** matches run on the normalized and de-obfuscated views, the same as the contact rules. An unambiguous term combined with an obfuscation attempt is always a block.
  - **Context allowlist to prevent false positives:** airsoft, Nerf, cosplay prop (non-functional), "prop replica", model kits, knife *display stand*, "gun rack", "magazine rack". These lower the rule to `escalate`, never to allow. The LLM makes the call with context.
  - **LLM category:** a new `prohibited_goods` category, following the same rules as other LLM blocks (block at ≥ 0.95 confidence, otherwise human review).
- **Where these rules run:**
  - message bodies (inquiries and threads);
  - manual quote notes and line descriptions (on send);
  - vendor profile `bio` and `display_name`;
  - **file names** of message attachments and project files, **including instant-quote uploads** (`ProjectFilesController.storeInstantQuoteFiles`).

  An instant-quote filename hit doesn't block the upload, since the customer may be anonymous and names can mislead. It flags the project `needs_review`, which reuses the existing `quote.status = 'needs_review'` + `review_reason = 'prohibited_item_suspected'`, so no price or checkout happens until an admin clears it.
- **Geometry is not classified:** no reliable, cheap way exists to recognize firearm parts from a mesh. This is noted as a known gap.
  - Vendors are the second line of defence: the report/block tools include a "prohibited item" reason, and a vendor declining an inquiry with that reason opens a case.
  - A later enhancement could render a thumbnail at slicing time and run an LLM vision check on escalated projects.
- **Policy text:** the prohibited-items policy is published (frontend/terms) and linked in block messages, e.g. "This item isn't allowed on MakeXYZ (Prohibited items policy)". Confirmed prohibited-item violations count as violations for trust tiers. Two confirmed violations by a vendor also raise a flag for admins to consider an account-level suspension, which stays manual.

---

## 9. Data model changes (new migrations only; `schema_rules.ts` unions updated)

| Table | Change |
|---|---|
| `vendors` | + `profile_slug` (unique), `bio`, `accepting_inquiries`, `profile_published_at`, `place_id` (the city's Google place ID, indexed), `place_type`, `place_id_refreshed_at`, `geocode_status`, `rating_count`, `rating_average`, `response_rate`, `response_time_hours` |
| `service_locations` (new) | `slug` (unique), `city`, `state`, `country`, `place_id` (unique), `place_id_refreshed_at`, `is_indexable`, `vendors_25mi`, `search_demand`, `recent_orders`, `served_area_names` json, `scored_at`. No coordinates |
| `search_events` (new) | See section 2g. Indexes on `created_at`, `matched_location_id`, `canonical_location_id`, `session_key` |
| `landing_page_visits` (new) | `path`, `referrer`, `is_internal_referrer`, `session_key`, `created_at` |
| `location_candidates` (new) | See section 2g |
| `service_location_postal_codes` (new) | `service_location_id`, `country`, `postal_code`. Unique on (`country`, `postal_code`) |
| `place_coordinates` (new) | `place_id` (unique), `lat`, `lng`, `expires_at` (≤ 30 days). One row per city in use, shared by vendors and city pages. No user data |
| `vendor_services` (new) | `vendor_id`, `service` (`design`, `scanning`, `cnc`), `active`, `rate`, `rate_unit`, `description`. Unique on (`vendor_id`, `service`) |
| `vendor_indicative_prices` (new) | `vendor_id`, `material_id`, `price_per_cm3`. Unique on (`vendor_id`, `material_id`) |
| `vendor_images` (new) | `uuid`, `vendor_id`, `kind` (`profile`, `portfolio`), `storage_key`, `thumbnail_key`, `position`, `status`, `moderation_details` json |
| `customer_ratings` (new) | `order_id` (unique), `vendor_id`, `customer_id`, `stars`, `note` |
| `orders` | + `rating_request_count`, `rating_last_requested_at` |
| `vendor_ratings` (new) | `uuid`, `vendor_id`, `order_id` (unique, nullable for legacy), `customer_id` (nullable for legacy), `stars` 1–5, `body` (nullable), `body_visibility` (`public`, `staff_only`), `status` (`visible`, `pending_moderation`, `hidden`), `vendor_reply`, `vendor_replied_at`, `source` (`order`, `legacy`), `legacy_reference`, `edited_at` |
| `projects` | + `vendor_id` (nullable FK). Index on (`source`, `status`) |
| `quotes` | + `vendor_id`, `expires_at`, `sent_at`, `commission_rate`, `quoted_destination_country`, `quoted_destination_postal_code`, `superseded_by_quote_id`. `rejection_reason` + `superseded` |
| `quote_items` / `order_items` | + `material_id` (quote only), `line_kind` (`part`, `service`, `shipping`; default `part` for existing rows) |
| `shipments` | + `source` (`easypost_label`, `vendor_tracking`), `easypost_tracker_id` (unique, nullable); parcel columns become nullable |
| (messaging tables) | `conversations.project_id` / `order_id` and the `quote_ref` message kind, already in the messaging plan |

The new tables are all for discovery and ratings. The quote → order → payout flow adds none: it reuses quotes, orders, payments, payouts and shipments.

---

## 10. AdonisJS components

- **Services:**
  - `vendor_profile_service` (publish/unpublish, moderation hook);
  - `vendor_search_service` (filters, haversine, newcomer boost, similar vendors) and `vendor_ranking.ts` (the pure scoring function);
  - `geocoding_service` (the Google Geocoding client: forward geocoding for vendors and city centers, reverse geocoding for the postal-code fallback, the 30-day cache and refresh);
  - `service_location_service` (city pages, the postal-code mapping, resolving a search to a city page, nearest indexable city);
  - `search_analytics_service` (search events, landing visits, candidates, city-page scoring);
  - `vendor_response_stats_service` (response rate and time from inquiry threads);
  - `vendor_image_service` (upload, scan, re-encode, Rekognition, publish);
  - `vendor_rating_service` (eligibility, moderation, aggregate recompute, rating requests, the customer rating, legacy import);
  - `manual_project_service` (create from inquiry, copy attachments);
  - `manual_quote_service` (draft CRUD, send, supersede, decline, expire, outlier checks);
  - branches in `checkout_service.finalizeAuthorization` and `payout_calculation_service`;
  - `vendor_tracking_service` (a tracking-only shipment + EasyPost Tracker).
- **Controllers:**
  - `VendorsController` (public search/profile);
  - `VendorRatingsController` (customer: create/edit for an order; public: list for a profile; vendor: reply/report);
  - `VendorProfileController`;
  - `VendorManualProjectsController`;
  - `VendorManualQuotesController`;
  - `VendorOrdersController`, extended with `tracking` and `cancel`;
  - `QuotesController`, extended with `decline` and a manual branch in `configure`.

  All vendor routes sit under the existing `/v1/vendor` group (auth + `isStaff` vendor check). The authorization check is always *this* vendor's project, quote or order, with a 404 otherwise, matching the codebase's convention of not revealing existence.
- **Validators:** `manualQuoteValidator` (lines: description 1–500 chars, quantity 1–100,000, unit price ≥ 0 decimal string with ≤ 2 dp, `line_kind`, optional `projectFileUuid` / `materialId`; expiry 1–90 days), `vendorProfileValidator`, `vendorTrackingValidator`.
- **Transformers:** `PublicVendorProfileTransformer`; a `ManualQuoteTransformer` (the vendor's view, including the commission and expected payout); `QuoteTransformer` extended with the customer-facing fields. The customer never sees the commission.
- **Jobs:** `ExpireManualQuotes` (hourly), `CaptureManualOrders` (hourly retry), `FlagUnconfirmedDeliveries` (daily), `SendRatingRequests` (daily), `RecomputeVendorResponseStats` (daily), `RefreshPlaceCoordinates` (daily; one row per city in use, within the 30-day limit), `RefreshPlaceIds` (monthly; IDs older than 12 months, free), `ScoreCityPages` (weekly), `LocationCandidatesDigest` (weekly), `PurgeSearchEventCoordinates` (daily). Two ace commands handle the one-off imports: `legacy:import-vendor-ratings` and `legacy:import-service-locations`.
- **New external usage:**
  - The Google Geocoding API: the `GOOGLE_GEOCODING_API_KEY` env var, called with `fetch`, so no new package.
  - The Google Search Console API: `GSC_SERVICE_ACCOUNT_KEY_BASE64` and `GSC_SITE_URL`; optional `google-auth-library`.
  - Rekognition (`rekognition:DetectModerationLabels` on the task role). The new dependency to approve is `@aws-sdk/client-rekognition`, from the same AWS SDK family already in use.
  - `sharp` is already approved. All are registered in `start/scheduler.ts` with stable `id()`s, following the existing style.
- **Docs:** update `docs/DATABASE_FLOW.md` with a "Manual quotes" lifecycle section (a manual project skips routing and captures at payment; shipping lines are exempt from commission) and `docs/VENDOR_ONBOARDING.md` (profile fields and directory visibility).

---

## 11. Changes to the messaging plan

These are recorded in the "Amendments from the manual-quote plan" section of [messaging_moderation.md](./messaging_moderation.md):

1. **Illegal and prohibited activity:** add the `prohibited.*` rule family (section 8) to the rule catalog, `prohibited_goods` to the LLM categories, and "prohibited item" to report and decline reasons. Unambiguous terms enforce at launch. The rest start in shadow mode.
2. **Moderated surfaces:** the pipeline also runs on manual quote text (`kind = quote`), vendor profile text, rating text and vendor replies, and file names. `moderation_evaluations` gains a nullable `subject_type` / `subject_id` (quote, vendor_profile, vendor_rating, project_file) alongside `message_id`, so the same explainability and case tooling cover them.
3. **`moderation_cases.source`** gets `quote_outlier`, `unconfirmed_delivery` and `prohibited_item`.
4. **The deal phase in the LLM context** now comes from the real quote states (draft/sent/superseded/accepted) defined here.
5. **Instant-quote uploads:** file-name prohibited checks apply to them too, via `needs_review`.
6. **Response statistics:** inquiry conversations record `first_customer_message_delivered_at` and `first_vendor_response_at` (a reply or a decline), so `vendor_response_stats_service` can compute the response rate and time without scanning messages.
7. **The customer risk profile** gains an input: vendors' private ratings of customers (`customer_ratings`). Low ratings from several vendors open a `behavioral` case.
8. **Public images** (vendor photo and portfolio) reuse the attachment scanning pipeline and add a Rekognition moderation check. They also get a `vendor_image` subject type for cases.

---

## 12. Build order (all before launch; follows messaging Step 1)

1. **Vendor profiles, geocoding and search** (schema, the Google geocoder with its 30-day refresh, city pages by postal code, the legacy ranking formula, the newcomer boost, the city table and endpoints, services, the price indicator, the moderation hook), plus the onboarding doc update. Photos and portfolio images follow once attachment scanning exists (messaging Step 3). Response stats follow messaging Step 1.
2. **Manual projects from inquiries**, attachment copy-in, and skip filters in the instant-quote cleanup jobs.
3. **Manual quote authoring and sending** (schema, lines, cents math, supersede, expire, outliers, moderation on send, thread system messages).
4. **Customer side** (index/show, configure with the address-match check, decline).
5. **Checkout branch** (auto-accept, capture, retry job) and the **manual payout breakdown**.
6. **Tracking-only shipments** with an EasyPost Tracker and unconfirmed-delivery cases, plus **refund issuing** (gateway `refundPayment`, vendor cancel, admin refund endpoint).
7. **Prohibited-item rules** across messages, quotes, profiles and file names (lands with messaging Step 2's rule work).
8. **Search logging and the city-page SEO loop** (search events, landing visits, candidates + weekly digest, city-page scoring, the admin endpoints). Logging itself lands with Step 1 so no search demand is lost. The digest and scoring can follow.
9. **Vendor ratings** (after delivery, moderation, aggregates, ranking input, rating-request emails, the vendor's rating of the customer), **similar-vendor suggestions**, and the **legacy import** of ratings, cities and vendor locations (re-geocoded).

Dependencies:
- Steps 2–3 need messaging Step 1 (conversations, the `quote_ref` messages).
- File copy-in needs messaging's attachment scanning (messaging Step 3). Until then a manual quote can have service-only or no-file lines.

---

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`. Migrations are run against Postgres to regenerate `database/schema.ts`, per the memory note that SQLite loses decimal types.
- **Unit:**
  - cents math for line totals, commission and payout (rounding per line, shipping exempt, zero-dollar shipping);
  - expiry clamping;
  - the outlier thresholds;
  - fixtures for each prohibited rule, including the false-positive allowlist (airsoft, Nerf, gun rack, magazine rack) and obfuscated variants ("a u t o s e a r", "g10ck sw1tch").
- **Functional:**
  - search: filters by service, technology and material; location from lat/lng, free text and city slug; ranking order; the newcomer insert at position 5; stable pagination; and **no coordinates or street address in any response**;
  - the ranking function is unit-tested against cases taken from the legacy `mysql_backend.py` formula, with the volume bonus fixed: 100 five-star reviews beats 1; an unrated vendor gets 1.05; a 50% response rate halves reputation; the proximity value at 10 km, 1,010 km and with no location;
  - the geocoder is mocked: an address change updates the vendor's place ID; vendors in the same city share one coordinate row; the refresh job refreshes coordinates before 30 days, and an expired row leaves vendors ranked on reputation; place IDs older than 12 months are refreshed, and `NOT_FOUND` triggers a re-geocode;
  - city-page resolution: by place ID (a city pick); by postal code (an address or postal-code pick); by city/state/country; by the reverse-geocode fallback, which then saves the postal code; and when nothing matches, vendors are still ranked around the coordinates, with the reverse-geocoded place and the nearest indexable city in the response;
  - search logging: an event is written with the matched and canonical locations; a logging failure doesn't fail the search; coordinates are nulled after 30 days;
  - candidates: 5 distinct sessions create a candidate; the digest doesn't repeat inside the cooldown; actioning one creates the city page and its postal codes;
  - scoring: each of supply, demand and revenue makes a page indexable on its own; served area names are capped at 15; Search Console is mocked (the click and impression thresholds, paging, the path-to-slug mapping, and an unconfigured or failed call preserving the previous demand flags); the CSV fallback is parsed;
  - response stats: only delivered inquiries count, a decline counts as a response, and the median is over the last 6;
  - images: rejected on a Rekognition hit (mocked), and unapproved images are never served;
  - rating requests: sent on day 3, 7 and 14, stopping once rated; the customer rating is visible to staff and that vendor only;
  - ratings: only the delivered order's customer, once per order, within the window; instant-quote text is never public; a hidden review leaves the aggregate; legacy import is idempotent;
  - only the thread's vendor can create a project or quote; the customer can't see drafts;
  - revision N+1 supersedes N, and paying a superseded or expired quote is refused;
  - the address must match the quoted destination;
  - paying creates an `accepted` order assigned to the vendor, the payment is captured, and the payout equals the expected commission math;
  - `routeNewOrder` is **not** called;
  - instant-quote checkout is unchanged (regression);
  - vendor tracking → a simulated signed EasyPost tracker webhook (the existing test signing approach) → delivered → payout scheduled;
  - vendor cancel → refund + payout cancelled;
  - a prohibited term in a quote blocks the send, and an instant-quote upload named `auto_sear.stl` puts the quote into `needs_review`;
  - `mail.fake()` is used for all notifications.
- **End to end locally:** `npm run dev` + `node ace queue:work`. Walk through customer inquiry → vendor project → quote → send → customer configure → pay (Stripe test mode) → vendor tracking → a simulated tracker webhook → payout.
