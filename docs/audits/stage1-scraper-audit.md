# Stage 1 — `1-scraper.mjs` Audit
**Date:** 2026-03-09
**Status:** Audit only — no changes made yet
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Stage 1 is the entry point of the entire pipeline. It queries the Outscraper Google Maps
API to scrape local businesses in a given Madrid neighborhood, enriches them with email
addresses via Outscraper's `domains_service`, deduplicates results, filters to businesses
that have a website, calculates their distance from a configurable origin point, and writes
the final list to an XLSX file that feeds into stage 2.

**Inputs:** None (API call, driven by CATEGORIES list and config)
**Outputs:**
- `output/businesses_{neighborhood}.xlsx` — primary output, consumed by stage 2
- `output/scraper_{neighborhood}.log` — append-only log file
- `neighborhoods.json` — tracker file with run metadata (skipped on `--dry-run`)

**CLI flags:** `--neighborhood`, `--lat`, `--lon`, `--dry-run`
**Cost:** ~$9-15 per neighborhood full run (with `domains_service=true`)

---

## General Audit

### 1. Error Handling & Resilience

**What's working well:**
- `fetchWithRetry` handles the full HTTP status surface: 401 (fatal), 402 (fatal),
  204 (no results), 429 (rate limited, 60s backoff), 202 (async poll), and generic
  non-ok with retry. Good coverage.
- `pollForResults` has a hard cap of 20 iterations (~10 minutes total) before giving up.
- Timeout handling uses `AbortSignal.timeout()` correctly.
- `updateNeighborhoodTracker` wraps JSON parsing in try/catch — safe against a corrupt
  `neighborhoods.json`.
- Top-level `.catch` on `runScraper()` with `process.exit(1)` — clean fatal exit.

**Issues found:**

**[MEDIUM] Silent batch failure — failed batches return `[]` and execution continues.**
When `fetchWithRetry` exhausts all retries (timeout or repeated HTTP errors), it returns
an empty array. The main loop treats this identically to a batch that legitimately returned
zero results. There is no way to tell from logs or the final output whether a batch
succeeded with zero results or silently failed. Example: if batch 2 (abogados, dentistas,
etc.) times out 3 times, all those leads are silently dropped and the script continues
to batch 3.

**[LOW] `pollForResults` loop has no break on unrecoverable poll errors.**
If the poll endpoint consistently returns non-ok HTTP responses, the loop retries all
20 iterations without considering the response code. A 401 or 410 during polling would
spin 20 times before giving up.

**[LOW] `async: false` vs `202` handler contradiction.**
`buildUrl` sends `async=false`, which tells Outscraper to respond synchronously. However,
`fetchWithRetry` still handles `202 Accepted` responses by polling. The comment notes this
is defensive programming, which is reasonable, but it should be documented more explicitly.
Outscraper docs say large requests may be forced async regardless of the flag.

---

### 2. Environment & Config Validation

**What's working well:**
- `OUTSCRAPER_API_KEY` is validated at startup — fails fast with a clear error.
- Coordinate fallbacks are hardcoded (María de Molina defaults) — acceptable.

**Issues found:**

**[LOW] `ORIGIN_LAT`/`ORIGIN_LON` from env not validated as numbers.**
`parseFloat(process.env.ORIGIN_LAT)` silently produces `NaN` if the env value is a
non-numeric string or blank. The `|| 40.437750` fallback only triggers if the value is
falsy (empty string), not if it's `NaN`. A `.env` with `ORIGIN_LAT=` would produce `NaN`
and be silently used as coordinates, generating malformed API requests.

**[LOW] Default neighborhood not surfaced to the user on startup.**
If `--neighborhood` is not passed and `NEIGHBORHOOD_NAME` is not set, the script
silently defaults to `maria_de_molina`. A log line at startup would prevent confusion.
(It does log the neighborhood name, but not that it's the hardcoded default.)

---

### 3. Data Integrity & Schema Validation

**Issues found:**

**[MEDIUM] Deduplication fallback key uses a non-existent field.**
```js
const key = record.google_id || record.place_id || `${record.name}_${record.full_address}`;
```
The raw Outscraper API response uses `address` as the field name, not `full_address`.
The `full_address` rename happens only in the XLSX row mapping (line 384: `full_address: r.address`).
At the point of deduplication (line 337), `record.full_address` is always `undefined`.
The fallback key becomes `"BUSINESS NAME_undefined"` for any record missing both
`google_id` and `place_id`. In practice, Outscraper almost always includes `google_id`,
so this is low-impact — but it is a latent bug that could cause missed deduplication if
google_id is absent.

**[MEDIUM] No filtering of closed businesses.**
Outscraper returns a `business_status` field (`OPERATIONAL`, `CLOSED_TEMPORARILY`,
`CLOSED_PERMANENTLY`). This field is not in FIELDS and not filtered anywhere. Permanently
or temporarily closed businesses will pass through all 10 pipeline stages, generate a
mockup, and receive a cold email. This is wasteful and could be embarrassing if the email
reaches a defunct business or its former owner.

**[LOW] `website` field not validated as a URL.**
Some Outscraper results include Facebook pages, Instagram URLs, or malformed strings in
the `website` field. The only filter is `record.website && record.website.trim() !== ''`.
Facebook/Instagram URLs are not useful for the pipeline (we can't build a mockup of a
social media page) and will waste downstream stage compute.

**[LOW] `emails` serialized as comma-joined string, losing array structure.**
```js
emails: Array.isArray(r.emails) ? r.emails.join(', ') : (r.emails || ''),
```
Stage 4 re-splits this with a regex. A structured format (JSON array string, or separate
`email_1`/`email_2` columns) would be cleaner and less brittle to edge cases like email
addresses that contain commas. Current format works but is fragile.

---

### 4. Performance & Bottlenecks

**No significant issues found for neighborhood-scale scraping.**
- At 1,594 records (current María de Molina), the `Map`-based deduplication and in-memory
  sort are trivially fast.
- `XLSX.writeFile` is synchronous but runs once at the end — acceptable for a CLI tool.
- Sequential batch execution is intentional to avoid rate limits.

**[LOW] `domains_service=true` runs even on dry-run.**
Dry-run limits to 3 results (`limit=3`) but still calls `domains_service`, which Outscraper
charges for. The docs suggest `domains_service` has its own per-record cost separate from
the base scraping cost. A dry-run probably doesn't cost anything meaningful (3 records),
but it's impure: a dry-run should be truly free. Consider sending `domains_service: false`
in dry-run mode.

**[LOW] No pagination — hard cap of 500 results per query.**
If a category (e.g., `restaurantes`) has more than 500 businesses within the area, the
excess are silently dropped. Outscraper supports cursor-based pagination, but it is not
implemented. For dense Madrid neighborhoods and popular categories, this is a real data
coverage gap.

---

### 5. Rate Limiting & Politeness

**What's working well:**
- 5-second delay between batches (`BATCH_DELAY`).
- 60-second backoff on 429 responses.
- `dropDuplicates: true` sent to API — reduces returned record count and cost.
- `limit=500` per query — reasonable cap.

**[LOW] `BATCH_DELAY` of 5 seconds is conservative but undocumented.**
This value was likely chosen empirically. No comment explains why 5 seconds specifically
or what Outscraper's actual rate limit is. If Outscraper raises its rate limit, this
could be tightened. If they lower it, 5s may not be enough. Worth documenting the source.

---

### 6. Logging & Observability

**What's working well:**
- Timestamped logs to both console and file.
- Per-batch progress logged (count received, new unique, cumulative, cost).
- Final stats block at end.
- Summary sheet in XLSX.

**Issues found:**

**[LOW] Actual query strings not logged.**
The log shows `batch.length` but not the actual query strings sent. If a batch produces
unexpected results, there's no way to know from the log which queries were run. The full
URL cannot be logged (exposes API key), but the queries list should be.

**[LOW] Failed batches not distinguished from empty batches in logs.**
When a batch returns `[]`, the log says "0 received, 0 new unique". This is identical
whether the batch genuinely returned zero results or silently failed after retries.

**[LOW] Log file never rotated — appends indefinitely.**
Each run appends to `scraper_{neighborhood}.log`. A neighborhood scraped monthly will
accumulate logs forever. Not a critical issue but worth noting for long-running use.

**[LOW] Categories with zero results not specifically surfaced.**
The Summary sheet shows categories that appeared in results, but not categories that
returned zero results. Knowing which categories failed to return anything is useful for
diagnosing coverage gaps.

---

### 7. Idempotency

**[MEDIUM] Not idempotent by design — re-run overwrites the output file.**
`XLSX.writeFile(wb, XLSX_PATH)` unconditionally overwrites `businesses_{neighborhood}.xlsx`.
This is intentional (re-scrape = fresh data), but it creates a risk: if stages 2–9 have
already processed the existing XLSX and a re-run of stage 1 is triggered (e.g. to add
categories), all downstream processed output becomes orphaned from a different data version.

No backup of the previous file is created. No warning is emitted if a file already exists.
This is not a bug per se, but it is a sharp edge for production use.

---

### 8. Output Contract

Stage 2 reads `businesses_{neighborhood}.xlsx` sheet `'Businesses'` via
`XLSX.utils.sheet_to_json`. The primary field it uses is `website`. It passes through
most other fields when building its enriched output.

**Issues found:**

**[LOW] `output_file` path in `neighborhoods.json` is hardcoded-absolute.**
The stored path (`/Users/andres/web-leads-pipeline/output/...`) reflects the machine path
at time of write. This is computed correctly at runtime via `__dirname`, but on a different
machine or after a project move, the stored path would be stale/wrong. Low impact since
nothing reads this path programmatically yet, but worth fixing if `neighborhoods.json`
is ever used for pipeline orchestration.

**[LOW] Tracker `with_website` counts pre-sort filtered records, not the saved XLSX rows.**
If both values differ due to a future filter, the tracker and XLSX would be out of sync.
Currently they match.

---

### 9. Dependency Audit

`npm audit` returned 2 vulnerabilities:

**[HIGH] `xlsx@0.18.5` — Prototype Pollution + ReDoS**
- CVE: GHSA-4r6h-8v6p-xvw6 (Prototype Pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS)
- No fix available from the maintainer (library effectively unmaintained since 2023)
- **Risk in this project**: We only parse our own generated XLSX files (not user-uploaded
  files), so prototype pollution from untrusted input is not triggered. The ReDoS risk
  only manifests on parsing, not writing. Practical risk is LOW, but the library status
  is a long-term concern. Migration to `exceljs` should be considered before production.

**[CRITICAL] `basic-ftp` — Path Traversal in `downloadToDir()`**
- Transitive dependency (comes from Playwright or Puppeteer).
- We do not use FTP anywhere in the pipeline. Zero practical risk.
- Fixable via `npm audit fix`.

**[LOW] Dead dependencies in `package.json`:**
- `pdf-lib` and `@pdf-lib/fontkit` — used in the now-deleted `8-postcard.mjs`. These
  packages are listed as dependencies but are not imported by any remaining stage.

---

### 10. Dead Code & Unused Imports

**Issues found:**

**[LOW] `located_in` requested in FIELDS but never saved.**
```js
const FIELDS = [..., 'located_in', ...];
```
`located_in` is requested from Outscraper (used to identify businesses inside malls or
shared premises) but is not written to any XLSX column. This increases response payload
size slightly with no benefit.

**[LOW] `photos_count` requested in FIELDS but never saved.**
Same situation as `located_in`. Potentially useful for scoring (businesses with photos
are more active on Google Maps) but currently discarded.

---

## Specific Stage Audit

### 1. Are We Parsing All Important Information from Outscraper?

**Fields requested in FIELDS but not saved to XLSX:**
| Field | Value for pipeline |
|---|---|
| `located_in` | Identifies mall/shared-space businesses — useful filter |
| `photos_count` | Proxy for listing activity — useful for scoring in stage 2 |

**Fields available from Outscraper but not requested at all:**
| Field | Value for pipeline | Priority |
|---|---|---|
| `business_status` | Filter `CLOSED_PERMANENTLY` / `CLOSED_TEMPORARILY` | **HIGH** |
| `verified` | Google-verified listings are higher quality leads | MEDIUM |
| `price_level` | `$` / `$$` / `$$$` — relevant for stage 2 scoring | MEDIUM |
| `main_category` | Outscraper's primary category (more reliable than `category`) | LOW |
| `owner_title` / `owner_id` | Personalization — not useful for pipeline | NOT NEEDED |
| `booking_appointment_link` | Could identify bookable businesses | LOW |
| `reservations` | Same | LOW |

**Naming confusion — `address` vs `full_address`:**
Outscraper has two distinct fields: `address` (short form) and `full_address` (complete
formatted address including building number, street, postal code). We request `address`
but store it as `full_address` in the XLSX. If the actual `full_address` field from
Outscraper contains more complete data (it typically does), we're missing it. This should
be verified against a raw API response.

**CATEGORIES list — potential gaps:**
The 30-category list is solid for Madrid SMEs. Some potentially valuable additions:
- `centros de estética` / `centros de belleza` (beauty centers — currently only `peluquerías`)
- `clínicas de fisioterapia` (more specific than `fisioterapia`)
- `guarderías` / `colegios` (education — currently `academias` only)
- `centros médicos` (broader than `clínicas`)
- `tiendas de informática` / `electrónica`
- `cerrajeros` (locksmiths — common trade in Madrid)

However, adding categories has direct cost impact (~$0.30 per additional category per run).
Any additions should be deliberate.

### 2. Are We Correctly Saving All Important Data?

**Issues with current saved fields:**

- `emails` as a comma-joined string loses the array structure. While stage 4 handles
  re-splitting, edge cases (e.g., email addresses with commas in display names) could
  cause incorrect splits. Consider saving as JSON array string: `JSON.stringify(r.emails)`.

- `working_hours` is saved as JSON string (`JSON.stringify(r.working_hours)`). This is
  never used downstream. Could be dropped to reduce XLSX bloat, or formatted more
  readably (e.g., "Mo-Fr 09:00-18:00").

- `description` from Outscraper is the Google Maps business description. This is passed
  through to downstream stages and is potentially very valuable for stage 5 (prompts) and
  stage 8 (email copy). Currently stage 5 and 8 read from `content.json` (scraped website),
  not this description. Connecting Google Maps description to email personalization could
  improve output quality.

- No `business_status` field saved — highest priority missing field.

### 3. Are We Updating All Related Files Correctly?

**`neighborhoods.json` tracker:**
- Stats saved: `scraped_at`, `lat`, `lon`, `total_businesses`, `with_website`,
  `estimated_cost_usd`, `output_file`, `contacts_made`.
- Missing: no record of which categories were scraped, which (if any) returned zero
  results, how many were filtered out as closed, or the FIELDS version used.
- `output_file` stored as an absolute path — not portable (see §8 above).
- `contacts_made` is preserved across scrapes (not reset) — this is correct behavior.

**Dry-run does not update the tracker — correct.**
**No backup of existing XLSX on overwrite — could be improved.**

### 4. Are We Over or Under Doing Anything?

**Overdoing:**
- `BATCH_DELAY = 5_000ms` may be more conservative than necessary. If Outscraper's rate
  limit allows it, 2–3 seconds would cut run time by ~30–45 seconds per neighborhood.
- `working_hours` serialized as JSON — large field, never used downstream, adds XLSX bloat.
- `domains_service=true` on dry-run — small cost leak, should be disabled for dry-runs.

**Underdoing:**
- No filtering of closed businesses (`business_status` not requested or checked).
- No filtering of social-media-only websites (Facebook, Instagram URLs in `website` field).
- No URL-level deduplication at this stage (only google_id dedup). Two GMB listings for
  the same physical business with the same website would both survive to stage 2, which
  does URL-dedup — so this is handled downstream, but slightly wasteful.
- No pagination support — categories with 500+ results are silently capped.
- No `--category` flag to re-scrape a single category without re-running all 30.

---

## Summary Table

| # | Issue | Severity | Type |
|---|---|---|---|
| 1 | No `business_status` filter — closed businesses pass through | MEDIUM | Missing feature |
| 2 | Silent batch failure — failed batch indistinguishable from empty | MEDIUM | Reliability |
| 3 | Dedup fallback key uses `record.full_address` (undefined in raw data) | MEDIUM | Bug (latent) |
| 4 | `xlsx` high-severity CVE — no upstream fix available | HIGH | Security/Deps |
| 5 | `domains_service=true` runs on dry-run (should be free) | LOW | Cost |
| 6 | No pagination — 500 result cap per category | LOW | Coverage |
| 7 | Actual query strings not logged | LOW | Observability |
| 8 | `ORIGIN_LAT`/`ORIGIN_LON` from env not validated as numbers | LOW | Reliability |
| 9 | `located_in` and `photos_count` in FIELDS but never saved | LOW | Dead code |
| 10 | `website` not validated as real URL (social media profiles pass through) | LOW | Data quality |
| 11 | `emails` saved as comma-string, not array — fragile for edge cases | LOW | Data quality |
| 12 | `address` vs `full_address` API naming confusion | LOW | Data integrity |
| 13 | Dead dependencies: `pdf-lib`, `@pdf-lib/fontkit` | LOW | Dependencies |
| 14 | `basic-ftp` critical CVE (transitive, no practical risk) | LOW | Dependencies |
| 15 | `output_file` in tracker stored as absolute path | LOW | Portability |
| 16 | No XLSX backup on re-run (overwrites silently) | LOW | Safety |
| 17 | `working_hours` large JSON blob — never used downstream | INFO | Bloat |
| 18 | Google Maps `description` not connected to downstream personalization | INFO | Opportunity |
| 19 | CATEGORY list has gaps (estética, cerrajeros, centros médicos, etc.) | INFO | Coverage |

---

## Recommended Changes (to discuss before implementation)

**High priority:**
1. Add `business_status` to FIELDS and filter `CLOSED_PERMANENTLY` / `CLOSED_TEMPORARILY`
   records before writing to XLSX.
2. Filter `website` field: drop records whose website is a social media domain
   (facebook.com, instagram.com, twitter.com, linkedin.com).
3. Fix dedup fallback key: use `record.address` instead of `record.full_address`.
4. Log actual query strings per batch (not the full URL).

**Medium priority:**
5. Disable `domains_service` on dry-run.
6. Add `verified` and `photos_count` to FIELDS and save them — useful for stage 2 scoring.
7. Distinguish batch failure (returned `[]` on error) from empty batch (zero results)
   in logs and optionally in final stats.
8. Validate `ORIGIN_LAT`/`ORIGIN_LON` env values as numbers at startup.

**Lower priority / discuss:**
9. Evaluate `address` vs `full_address` API field — verify via a raw API response.
10. Remove `located_in`, `working_hours` from FIELDS (or save them — pick one).
11. Remove dead dependencies (`pdf-lib`, `@pdf-lib/fontkit`) from `package.json`.
12. Consider migrating from `xlsx` to `exceljs` before production (no active CVE fix).
13. Add `--category` CLI flag for single-category re-scrape.
14. Add pagination support for categories with 500+ results.
