# Stage 1 — `1-scraper.mjs` Audit
**Date:** 2026-03-09
**Status:** ✅ Complete — all actionable stage-1 items resolved
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Stage 1 is the entry point of the entire pipeline. It queries the Outscraper Google Maps
API to scrape local businesses in a given Madrid neighborhood, enriches them with email
addresses via Outscraper's `domains_service`, deduplicates results, filters out closed
businesses and social-media-only websites, calculates distance from the neighborhood
origin, and writes the final list to an XLSX file consumed by stage 2.

**Inputs:** None (API-driven). Coordinates loaded from `neighborhoods.json`.
**Outputs:**
- `output/businesses_{neighborhood}.xlsx` — primary output, consumed by stage 2
- `output/scraper_{neighborhood}.log` — append-only log file
- `neighborhoods.json` — neighborhood registry + run history (skipped on `--dry-run`)

**CLI flags:**
- `--neighborhood <name>` — which neighborhood to scrape (required if not in .env)
- `--lat <lat> --lon <lon>` — only needed when registering a new neighborhood for the first time
- `--category <keyword>` — scrape a single category without a full run
- `--dry-run` — 1 query, 3 results, no tracker update, domains_service disabled

**Cost:** ~$9-15 per full neighborhood run (with `domains_service=true`, 37 categories)

---

## Output Schema (`businesses_{neighborhood}.xlsx`, sheet `Businesses`)

| Column | Type | Notes |
|---|---|---|
| `distance_meters` | number | Haversine distance from origin, sorted ascending |
| `name` | string | Business name |
| `website` | string | Real business URL — social media domains filtered out |
| `phone` | string | |
| `emails` | JSON string | Array: `["a@b.com"]` — use `JSON.parse()` downstream |
| `category` | string | Primary Google Maps category |
| `subtypes` | string | Comma-separated subcategories |
| `full_address` | string | From `r.address` — Outscraper does not return a separate `full_address` field |
| `street` | string | |
| `county` | string | District/borough |
| `country_code` | string | e.g. `ES` |
| `postal_code` | string | |
| `city` | string | |
| `rating` | number | Google Maps rating |
| `reviews` | number | Review count |
| `latitude` | string | |
| `longitude` | string | |
| `google_id` | string | Primary dedup key |
| `place_id` | string | Secondary dedup key |
| `business_status` | string | `OPERATIONAL` only — closed already filtered |
| `verified` | boolean | Google-verified listing |
| `photos_count` | number | Useful for stage 2 scoring |
| `located_in` | string | Shopping centre / building name if applicable |
| `working_hours` | JSON string | `{"lunes":["9:00-18:00"],...}` — use in stage 5 brief + stage 6 mockup |
| `description` | string | Google Maps business description — use in stages 5 and 8 |
| `query_source` | string | Which search query returned this record |

---

## Decisions Log

| # | Issue | Severity | Decision | Status |
|---|---|---|---|---|
| 1 | No `business_status` filter — closed businesses passed through | MEDIUM | Filter CLOSED_PERMANENTLY + CLOSED_TEMPORARILY before XLSX write | ✅ Fixed |
| 2 | Social media URLs passed through as `website` | MEDIUM | Block facebook, instagram, linkedin, twitter, tiktok, youtube, pinterest | ✅ Fixed |
| 3 | Dedup fallback key used `record.full_address` (undefined on raw API object) | MEDIUM | Changed to `record.address` | ✅ Fixed |
| 4 | Silent batch failure — exhausted retries returned `[]` same as empty result | MEDIUM | Throw on exhausted retries; batch loop catches per-batch and continues; failures counted + logged | ✅ Fixed |
| 5 | `emails` saved as comma-joined string | LOW | Now saved as `JSON.stringify(array)` — downstream stages must `JSON.parse()` | ✅ Fixed — ⚠️ stage 4 must be updated |
| 6 | `business_status`, `verified`, `photos_count`, `located_in` not saved | LOW | Added to FIELDS + rows mapping | ✅ Fixed |
| 7 | `address` vs `full_address` naming confusion | LOW | Both requested; confirmed Outscraper only returns `address` (no separate `full_address` field); fallback always used, data is correct | ✅ Verified + logged |
| 8 | `description` (Google Maps) not connected to downstream stages | LOW | Already saved in XLSX. Stages 5 and 8 must read it | ✅ Saved — ⚠️ stages 5+8 pending |
| 9 | `xlsx` HIGH-severity CVE — unmaintained library | HIGH | Migrated stage 1 to `exceljs` | ✅ Fixed |
| 10 | `domains_service=true` ran on dry-run (cost leak) | LOW | Disabled for dry-run | ✅ Fixed |
| 11 | Query strings not logged per batch | LOW | Logged at batch start | ✅ Fixed |
| 12 | `ORIGIN_LAT`/`ORIGIN_LON` env vars — no NaN validation + wrong location for data | LOW | Removed from .env entirely. Coordinates now live in `neighborhoods.json` registry | ✅ Fixed |
| 13 | Category list had gaps | LOW | Expanded from 30 to 37 categories, reorganised by sector | ✅ Fixed |
| 14 | No `--category` flag for single-category re-scrape | LOW | Implemented with substring match | ✅ Fixed |
| 15 | `output_file` in tracker stored as absolute path | LOW | Now stored as relative path — portable across machines | ✅ Fixed |
| 16 | `working_hours` saved but never used downstream | INFO | Kept — stage 5 (design brief) and stage 6 (HTML mockup) should use it | ✅ Saved — ⚠️ stages 5+6 pending |
| 17 | Neighborhood coords in `.env` — wrong place for data | ARCH | Moved to `neighborhoods.json` registry; `--lat`/`--lon` only needed on first registration | ✅ Fixed |
| 18 | `neighborhoods.json` was a flat stats dump, no run history | ARCH | Promoted to full registry with `runs[]` append-only history — foundation for admin dashboard | ✅ Fixed |

---

## Open Items (genuinely deferred — not blocking)

### Pagination — 500 result cap per category
**Status:** ⏳ Deferred — needs Outscraper API docs verification
Categories with more than 500 businesses in the area are silently capped. Most Madrid
neighborhood categories will be well under 500, so this is low practical risk for now.
Before implementing, verify the correct pagination parameter (`skip`, `cursor`, or other)
against Outscraper's actual API docs to avoid introducing subtle bugs.

### Output folder restructure
**Status:** ⏳ Deferred — cross-cutting, all stages affected
Re-running stage 1 overwrites `businesses_{neighborhood}.xlsx` with no backup.
Agreed proposed structure (see `docs/audits/pending-cross-stage.md`) — implement as a
single migration after all stages are audited, as part of pre-admin-tool work.

### Dead dependencies — `pdf-lib`, `@pdf-lib/fontkit`
**Status:** ⏳ Pending — package.json level, not stage-specific
These were used by the deleted `8-postcard.mjs`. Remove from `package.json` when
cleaning up after all stage audits are complete.

### `basic-ftp` critical CVE
**Status:** ℹ️ No action needed
Transitive dependency from Playwright/Puppeteer. We use no FTP anywhere.
Zero practical risk. Can be cleared via `npm audit fix` if it becomes noise.

---

## Field Notes

**`full_address` finding:** During dry-run testing it was confirmed that Outscraper does
*not* return a separate `full_address` field. The `address` field already contains the
complete formatted address (`Calle Mayor 1, 28001 Madrid`). Our row mapping correctly
falls back to `r.address`, and data quality is good.

**`description` sparsity:** The Google Maps `description` field is often empty — many
SMEs do not fill it in. Stages 5 and 8 should treat it as supplementary data, not primary
input. Only Goiko-type chains consistently have descriptions.

**`emails` in dry-run:** Always `[]` in dry-run because `domains_service=false`.
This is correct and expected. Emails only populate in full runs.
