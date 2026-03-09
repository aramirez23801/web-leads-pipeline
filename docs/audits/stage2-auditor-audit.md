# Stage 2 — `2-auditor.mjs` Audit
**Date:** 2026-03-09
**Status:** Audit complete — fixes in progress on `audit/stage2-auditor-fixes` branch
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Stage 2 is the most critical gate in the pipeline. It determines which businesses are
worth contacting. It crawls every unique business website from stage 1's output, analyzes
the HTML for technical problems, scores each site from 0–100 (higher = worse website =
better sales opportunity), assigns a tier (1–4), and writes two output files consumed by
all downstream stages.

**This stage is the filter. If a good-website business passes through it, we waste
mockup compute, Cloudflare deployments, and cold email quota on a non-lead. If a
bad-website business is scored too low, we miss a real opportunity.**

**Inputs:**
- `output/businesses_{neighborhood}.xlsx` — from stage 1

**Outputs:**
- `output/leads_audited_{neighborhood}.xlsx` — all leads with scores, tiers, and audit signals
- `output/outreach_{neighborhood}.xlsx` — Tier 1 + Tier 2 only, simplified columns for manual review
- `output/crawl_cache_{neighborhood}.json` — resume cache (hostname → crawl result)

**CLI:**
- `node pipeline/2-auditor.mjs` — full run
- `node pipeline/2-auditor.mjs 10` — limit to first 10 domains (testing)
- `--neighborhood <name>` — override neighborhood

**Key parameters:**
- `CONCURRENCY = 5` — simultaneous crawls
- `DELAY_MS = 200` — 200ms delay between fresh requests
- `TIMEOUT_MS = 15000` — 15s per crawl before abort

---

## General Audit

### 1. Error Handling & Resilience

**What's working well:**
- `crawlUrl` maps low-level errors to clean categories: `timeout`, `dns_fail`,
  `connection_refused`, `connection_reset`, `ssl_error`, `http_XXX`, generic.
- `readInputXlsx` fails fast with clear error + hint if input file is missing.
- Cache loading silently returns empty Map on parse error — acceptable.
- `cacheSaveChain` (serialized writes every 10 records) prevents cache corruption on
  concurrent writes. Clever pattern, correctly implemented.
- Top-level `main().catch()` with `process.exit(1)`.

**Issues found:**

**[MEDIUM] Crawl errors are cached permanently — no TTL or staleness.**
If a site was temporarily down during the audit (server restart, DNS propagation), it
gets cached as `dns_fail` or `timeout` and will stay that way forever. Re-running stage 2
will serve the stale failure from cache without re-attempting the crawl. A business that
fixed their site between runs would still show as a dead site.

No `--force` flag to bypass cache. No per-entry timestamp in cache to detect staleness.

**[LOW] No retry on transient crawl errors.**
A `connection_reset` or `timeout` is retried 0 times. A single network hiccup on a
healthy site results in a permanent cached failure. Chromium's user-facing behavior
would retry — we don't.

**[LOW] `analyzeHtml` is declared `async` but has no `await` inside.**
`async function analyzeHtml(html, finalUrl)` — Cheerio's `load()` is synchronous.
The function returns a resolved promise wrapping a synchronous result. Harmless but
misleading — callers `await` something that never awaits.

---

### 2. Environment & Config Validation

**What's working well:**
- No API keys required for this stage (pure web crawling).
- Input file existence checked before processing.

**Issues found:**

**[LOW] No validation that input XLSX has expected columns.**
`XLSX.utils.sheet_to_json(ws)` silently returns rows with whatever columns exist. If
stage 1's schema changed (e.g., a column rename), stage 2 would silently receive
`undefined` for affected fields and produce output with empty values, with no error.

**[LOW] No check that `NEIGHBORHOOD` is registered in `neighborhoods.json`.**
Stage 1 now enforces this. Stage 2 doesn't — it just tries to open the XLSX. If the
file exists from a previous run on a different machine, it would process it regardless
of whether the neighborhood config is consistent.

---

### 3. Data Integrity & Schema Validation

**Issues found:**

**[HIGH] New stage 1 fields are silently dropped — not passed through to output.**
`buildOutputRow` only passes a fixed set of fields. The new fields added in the stage 1
audit are completely lost after stage 2:

| Field | Lost after stage 2? | Impact |
|---|---|---|
| `description` | ✅ Lost | Stages 5+8 can't use it for personalization |
| `working_hours` | ✅ Lost | Stages 5+6 can't use it for brief/mockup |
| `business_status` | ✅ Lost | Stages downstream can't verify status |
| `verified` | ✅ Lost | No scoring use + lost for admin dashboard |
| `photos_count` | ✅ Lost | Not used in scoring, not passed through |
| `subtypes` | ✅ Lost | Could be useful for personalization |
| `located_in` | ✅ Lost | Context lost |
| `latitude` / `longitude` | ✅ Lost | Potential map view in admin dashboard |
| `place_id` | ✅ Lost | Admin dashboard could link to GMB profile |

Downstream stages (3–9) read from `leads_audited_{neighborhood}.xlsx`, not from the
raw scraper XLSX. Any field not passed through by stage 2 is permanently unavailable
to all downstream stages.

**[MEDIUM] `emails` field passed through as raw JSON string without note.**
Stage 1 now stores `emails` as `'["a@b.com","c@d.com"]'`. Stage 2 passes it through
unchanged via `biz.emails ?? ''`. This is correct behavior, but stage 2 also writes it
to `outreach_{neighborhood}.xlsx` where a human might open it and see confusing JSON.
No documentation in the output that this field requires `JSON.parse()`.

---

### 4. Performance & Bottlenecks

**What's working well:**
- `pLimit(5)` concurrency control — correct use of p-limit.
- One crawl per unique domain (deduplication before crawling) — avoids redundant requests.
- Cache prevents re-crawling on resume — correct.

**Issues found:**

**[LOW] Response time not captured.**
We set a 15s timeout but never measure how long the crawl actually took. Response time
is a direct proxy for website performance — a site that takes 8s to respond has a real
performance problem. This data is available essentially for free (start/end timestamps
around the `fetch` call) and would be a meaningful scoring signal.

**[LOW] Cheerio loads entire HTML into memory for all 5 concurrent crawls.**
At CONCURRENCY=5, we could have 5 large HTML documents in memory simultaneously.
For typical SME sites (<500KB HTML), this is fine. For CMS-heavy sites (1–2MB), this
could spike to ~10MB. Not a practical problem at neighborhood scale but worth noting.

---

### 5. Rate Limiting & Politeness

**What's working well:**
- 200ms delay between fresh requests (per-domain).
- Realistic Chrome User-Agent.
- One crawl per domain (dedup).
- `redirect: 'follow'` correctly handles HTTP → HTTPS redirects.

**Issues found:**

**[INFO] No robots.txt checking.**
We don't check `robots.txt` before crawling. For business websites we're auditing
(not indexing), this is legally and ethically acceptable — we're acting as a potential
client browsing their site. Not a practical issue.

---

### 6. Logging & Observability

**What's working well:**
- Per-domain log with all audit signals visible.
- Progress milestone every 50 domains.
- Tier counts in summary block.
- Cache hit count at startup.

**Issues found:**

**[MEDIUM] No log file — everything goes to stdout.**
For a 1,500-domain run taking 30–60 minutes, all output goes to the terminal. If the
terminal closes, the log is gone. Stage 1 writes a persistent `.log` file; stage 2
should do the same.

**[LOW] No timestamps in log lines.**
Stage 1 prefixes every line with ISO timestamp. Stage 2 uses bare `[idx/total]` format.
Makes it impossible to measure per-domain crawl time or identify slow periods in a run.

**[LOW] Cache hit/miss ratio not logged at end.**
We log `cachedCount` at the start ("Found N cached results") but don't include this
in the final summary block. Useful to know how much of the run was fresh vs. cached.

---

### 7. Idempotency

**What's working well:**
- Cache-based resume: re-running after an interruption picks up where it left off.
- Cached domains are skipped completely — no redundant crawls.

**Issues found:**

**[MEDIUM] No way to force-refresh stale cache entries.**
No `--force` flag or `--max-age` parameter. If you want to re-crawl a site (because
it was down last time, or because you suspect the cache is stale), you must manually
edit `crawl_cache_{neighborhood}.json` or delete it entirely.

**[MEDIUM] `DRY_RUN_LIMIT` name is misleading — it still writes output files.**
Running `node pipeline/2-auditor.mjs 10` is described as a "dry run" in the CLI docs,
but it writes `leads_audited_{neighborhood}.xlsx` with only 10 domains, potentially
overwriting a complete run. It also caches those 10 results. This is a `--limit` flag,
not a dry-run.

**[LOW] Output XLSXs always overwritten, no backup.**
Same concern as stage 1 — part of the agreed output restructure.

---

### 8. Output Contract

**What `getTargetLeads()` in utils.mjs reads:**
`tier`, `opportunity_score`, `final_url`, `website` — all present. ✓

**What downstream stages (3–9) assume is in the audited XLSX:**
Stages read `leads_audited_{neighborhood}.xlsx` expecting all relevant business data.
The dropped fields (§3 above) mean stages 5, 6, 8 cannot access `description` or
`working_hours` — the highest-value personalization fields from stage 1.

**Missing from output that stages will need:**
- `description` — explicitly planned for stages 5+8
- `working_hours` — explicitly planned for stages 5+6
- `verified`, `photos_count` — planned for scoring improvement

---

### 9. Dependency Audit

**[HIGH] `xlsx@0.18.5` — same HIGH CVE as stage 1.**
Stage 1 was migrated to `exceljs`. Stage 2 still uses `xlsx` for both reading the
input XLSX (produced by exceljs now) and writing the output XLSX. Both operations
must be migrated to `exceljs` for consistency and CVE resolution.
Note: exceljs can read files written by any standard XLSX library.

**All other dependencies** (`cheerio`, `p-limit`, `dotenv`) — no known issues.

---

### 10. Dead Code & Unused Imports

**[LOW] `analyzeHtml` is async for no reason.**
No actual async operations inside. Minor but should be corrected for clarity.

**No other dead code found.** The `OUTREACH_FILE` path is used. All imports are used.

---

## Specific Stage Audit

### 1. Is the Audit Logic Correct?

#### Current signals and scoring weights

| Signal | Points | Assessment |
|---|---|---|
| `dns_fail` / `connection_refused` | +50 | ✅ Correct — dead website |
| `timeout` / `connection_reset` | +35 | ✅ Correct — broken/extremely slow |
| other `crawl_error` | +20 | ✅ Correct — some error |
| `missing_viewport` | +40 | ✅ Correct — strongest reliable signal |
| `no_ssl` | +25 | ✅ Correct — browsers show "Not Secure" |
| `outdated_copyright` | +15 | ⚠️ Indirect proxy — see below |
| `has_dead_tags` | +10 | ✅ Correct for very old sites |
| `heavy_page` (>30 images) | +10 | ❌ Wrong metric — see below |

**Review multiplier:** 50+ reviews → 1.2x, 10+ → 1.1x, else 1.0x — ✅ Reasonable.

#### Tier thresholds

| Tier | Threshold | Typical trigger |
|---|---|---|
| Tier 1 (HOT) | ≥60 | missing_viewport + no_ssl (65), or dns_fail + multiplier |
| Tier 2 (WARM) | ≥35 | missing_viewport alone (40), or dns_fail without reviews |
| Tier 3 (COOL) | ≥15 | outdated_copyright alone (15), or dead_tags + heavy_page (20) |
| Tier 4 (SKIP) | <15 | No technical issues found |

**[MEDIUM] Dead website (dns_fail) scores 50 → Tier 2, not Tier 1 for most businesses.**
A business whose website is completely unreachable (dns_fail = 50) scores as Tier 2
unless they have 50+ reviews (1.2× → 60 = Tier 1). A dead website is arguably always
a Tier 1 lead regardless of review count — they have literally zero web presence.
Threshold or signal weight should be adjusted.

**[MEDIUM] `outdated_copyright` is an unreliable proxy.**
Copyright year in the footer is a reasonable signal, but:
- Many sites remove copyright entirely → null = no penalty (undercounting)
- Some CMS auto-update the copyright year without updating actual content
  (WordPress footer widgets often show current year automatically)
- Threshold hardcoded to 2023. As years pass, `currentYear - 2` or `currentYear - 3`
  would be more appropriate than a static value.

**[MEDIUM] `heavy_page` (>30 images) is the wrong metric.**
Page weight and load speed are real issues but image count is not a reliable proxy:
- A photography portfolio or restaurant menu site legitimately has 30+ images
- A site with 5 uncompressed BMP files is far heavier than one with 50 lazy-loaded WebPs
- Better proxies: response time from our crawl (already available implicitly), or checking
  for absence of `loading="lazy"` on images below the fold

**[LOW] `has_dead_tags` only catches the most extreme cases.**
`frameset`, `frame`, `center`, `font`, `marquee`, `blink`, `applet` = genuine 1990s–2000s
relics. But a bad website built in 2015 using Bootstrap 2, jQuery 1.x, and table layouts
would score 0 on this signal because it doesn't use these tags. Consider adding:
- Inline style abuse: `style=""` attribute count > threshold
- Table-based layout: `<table>` used for layout (has no `border`, `cellpadding` etc.)
- Old jQuery: script src containing `jquery-1.` or `jquery-2.`

---

### 2. Are We Using All Available Information from Parsing?

#### From the HTML — detected but not scored

| Signal | Currently detected? | Currently scored? | Value |
|---|---|---|---|
| Viewport meta tag | ✅ | ✅ | — |
| SSL | ✅ | ✅ | — |
| Copyright year | ✅ | ✅ | — |
| Dead HTML tags | ✅ | ✅ | — |
| Image count | ✅ | ✅ (crude) | — |

#### From the HTML — not detected at all

| Signal | Detection method | Value for scoring |
|---|---|---|
| **Page title quality** | `$('title').text()` | "Home" or blank = bad SEO, signal of neglect |
| **H1 presence** | `$('h1').length` | Missing H1 = broken SEO basics |
| **Meta description** | `$('meta[name="description"]')` | Missing = neglected site |
| **Contact info in page** | Phone number regex, `<a href="tel:">` | No phone = lost conversions |
| **Contact form presence** | `$('form').length` | No form = no lead capture |
| **CTA presence** | Buttons/links with "contact", "llamar", "reservar", "pedir" text | No CTA = losing customers |
| **Response time** | Timestamp delta around fetch | Direct performance signal |
| **CMS detection** | Generator meta, script URLs, CSS class patterns | Critical — see §3 below |
| **Page word count** | `$('body').text().split(/\s+/).length` | <200 words = thin content |
| **Favicon presence** | `$('link[rel*="icon"]')` | Missing = basic hygiene failure |
| **Google Analytics / GTM** | Script src patterns | Absence = owner doesn't track traffic |
| **Schema markup** | `$('[type="application/ld+json"]')` | Missing LocalBusiness schema = SEO gap |
| **Social media links** | `<a href>` containing facebook/instagram/etc | No social = disconnected presence |
| **Old jQuery version** | Script src `jquery-1.` or `jquery-2.` | Technical debt signal |
| **Inline style abuse** | `$('[style]').length` relative to total elements | Signs of amateurish build |
| **Mobile menu** | `$('.hamburger, .navbar-toggle, [data-toggle="collapse"]')` | No mobile nav = not responsive in practice |
| **SSL expiry / mixed content** | `http://` in src/href attributes on https pages | Mixed content = browser warnings |

#### From Outscraper data (available in XLSX, not used in scoring)

| Field | Currently used? | Potential use |
|---|---|---|
| `rating` | ❌ (only `reviews` used in multiplier) | Low rating + bad website = higher priority? |
| `photos_count` | ❌ | 0 photos on GMB = neglected online presence |
| `verified` | ❌ | Verified = owner is reachable, worth contacting |
| `distance_meters` | Sort only, not scored | Closer businesses = easier to build trust? |
| `description` | ❌ | Not scored, not passed through |
| `subtypes` | ❌ | Could inform scoring by business type |

---

### 3. Are We Scoring Correctly?

**The current system catches the most egregious cases** (no viewport, no SSL, dead site)
but **misses the majority of "bad but technically functional" websites** that are our
actual target market. A site built in 2018 on a free WordPress theme, with no CTAs,
no H1, no schema markup, no mobile menu, and a 6-second load time would score:
- viewport tag present (0)
- SSL present (0)
- Copyright 2024 (0)
- No dead tags (0)
- <30 images (0)
- **Total: 0 → Tier 4 (SKIP)**

That is a false negative. That site needs a new website. We'd skip it.

**Missing signal categories that would fix this:**

1. **SEO basics** (title, H1, meta description) — proxy for how much owner cares
2. **Conversion basics** (CTA, phone in header, contact form) — proxy for website effectiveness
3. **CMS/platform detection** — see §4 below
4. **Performance signal** (response time from our crawl)
5. **Content depth** (word count, freshness beyond copyright year)

---

### 4. CMS Detection — High-Value Signal

Knowing what CMS a site uses is one of the most actionable signals for deciding whether
to contact a business. Recommended scoring impact:

| CMS / Platform | Detection pattern | Scoring implication |
|---|---|---|
| **Wix** | Generator meta `Wix.com`, script `static.wixstatic.com` | Lower priority — Wix sites look reasonable but are very limited. Still potential client. |
| **Squarespace** | Generator meta `Squarespace`, `squarespace.com` in scripts | Lower priority — generally well-designed |
| **Webflow** | `webflow.com` in scripts or `wf-` CSS classes | Skip — usually good design |
| **WordPress + Divi/Elementor** | `et-pb`, `elementor` CSS classes | Medium — could be good or terrible |
| **WordPress (default/old theme)** | `wp-content/` + no premium builder classes | Higher priority — often neglected |
| **Wix ADI** | Wix + very sparse content | High priority — owner used 5-minute setup |
| **Jimdo** | `jimdo.com` scripts | High priority — typically outdated |
| **1&1/IONOS** | `1and1.com` or `mywebsite.com` references | High priority — generic builder |
| **No CMS (static HTML)** | No recognizable CMS signals | Very high priority if combined with other issues |

CMS detection requires zero additional network requests — it's in the HTML we already
have. It's a free, high-signal addition.

---

### 5. Design Quality — Can We Use an LLM?

**Short answer: Yes, and affordable. Deferred to v2 — see decision below.**

**The problem with current scoring:** All 5 signals are purely technical and parseable
from HTML. They completely miss visual/design quality:
- A site with viewport + SSL + fresh copyright + no dead tags + <30 images scores 0
  (Tier 4 SKIP) even if it has 2003-era visual design, impossible-to-read fonts,
  no images, no structure, and is built in Comic Sans.
- We'd skip it. That's a real opportunity missed.

**Proposed approach (for v2):**
After stage 3 generates desktop + mobile screenshots, run a Claude Haiku call per domain:

```
You are auditing a Spanish SME website for a web design agency.
Look at this screenshot and rate the design quality on a 1–5 scale:

1 = Clearly outdated or amateurish (clip art, table layout, 1990s/2000s aesthetic,
    no images, plain HTML, impossible to use on mobile)
2 = Old but functional (generic WordPress theme from 2010s, dated styling,
    no design investment, stock photos used poorly)
3 = Adequate but generic (free modern template, nothing distinctive,
    stock photos but fits the mold)
4 = Modern and professional (custom design, good typography, clear hierarchy,
    brand colors used consistently)
5 = Excellent (would stand alongside top-tier agency work, builds immediate trust)

Also note the primary design weakness in one sentence.

Respond ONLY with JSON: {"design_score": N, "design_weakness": "one sentence"}
```

**Cost:** ~$0.001 per call at Haiku prices. 1,000 domains = ~$1.
**Value:** Catches the cases that no regex can — directly answers the concern about
"wrongly done websites or bad design."
**Subjectivity concern:** Mitigated by constraining to a structured rubric.
A design_score of 1 or 2 should add +15 to +25 points to the opportunity score.

#### Why it's deferred — architecture options evaluated

Three options were considered:

**Option A — Swap stage 2 (auditor) ↔ stage 3 (screenshot):**
Screenshot all businesses first, then audit with LLM scoring.
- Stage 1 produces ~1,500 businesses / ~800-1,000 unique domains.
- Current stage 3 only screenshots Tier 1+2 leads (~200-400 domains).
- Swapping means Puppeteer visits all ~1,000 unique domains including dead ones.
- Dead sites produce blank/error screenshots — wasted compute, wrong signal.
- Some sites redirect headless browsers to CAPTCHA pages — false "terrible design" scores.
- 3-5x more screenshot work before any filtering. Rejected.

**Option B — Add stage 2.5 (design enricher) after stage 3:**
HTML audit → screenshot Tier 1-3 leads only → LLM re-scores → updates audited XLSX.
- Cleaner than A: screenshots only lead-quality sites.
- But: Tier 4 false negatives (visually terrible but HTML-ok) never get screenshots,
  so still not rescued. Adds a new stage for an unproven benefit. Rejected for v1.

**Option C — Defer to v2 (chosen):**
Fix all other scoring signals now (SEO basics, CMS detection, response time, dead-site
weight, heavy_page fix). These collectively catch the majority of false negatives:
- CMS detection: Jimdo/1&1 site with viewport+SSL goes from 0 → flagged priority lead
- SEO basics: no H1 + no meta description goes from 0 → +15 points → Tier 3 minimum
- Response time: 8s load time adds a real performance signal
- Dead site fix: dns_fail → 60 (Tier 1) regardless of review count

**Decision:** After the first María de Molina campaign we'll have ground truth on
whether "technically fine, visually 2010" sites are actually converting. If they are,
implement Option B (stage 2.5) with real data to guide the scoring weights.

**Implementation note:** The `design_score` column is reserved as `null` in the
output schema from this audit — the slot is ready when we implement this in v2.

#### Output schema note
`design_score` (number | null) — always null until v2 LLM enrichment is built.
`design_weakness` (string | null) — always null until v2 LLM enrichment is built.

---

## Summary Table

| # | Issue | Severity | Type |
|---|---|---|---|
| 1 | New stage 1 fields silently dropped — description, working_hours, verified, photos_count, etc. lost | HIGH | Data loss |
| 2 | `xlsx` HIGH CVE — must migrate to exceljs | HIGH | Security |
| 3 | Crawl errors cached permanently — no TTL, no --force flag | MEDIUM | Reliability |
| 4 | Scoring misses most "bad but functional" websites — false negatives | MEDIUM | Business logic |
| 5 | Dead website (dns_fail) scores 50 → Tier 2, not always Tier 1 | MEDIUM | Scoring |
| 6 | `heavy_page` (>30 images) is a wrong metric for page weight | MEDIUM | Scoring |
| 7 | `outdated_copyright` threshold hardcoded to 2023 — will age | MEDIUM | Scoring |
| 8 | No design quality signal — Tier 4 for visually terrible sites | MEDIUM | Coverage |
| 9 | No CMS detection — Wix/Squarespace vs abandoned WordPress not distinguished | MEDIUM | Coverage |
| 10 | No response time measurement from crawl | MEDIUM | Coverage |
| 11 | No log file — all output lost when terminal closes | MEDIUM | Observability |
| 12 | No SEO basics check (title, H1, meta description) | LOW | Coverage |
| 13 | No conversion signals (CTA, phone in header, contact form) | LOW | Coverage |
| 14 | `DRY_RUN_LIMIT` name misleading — still writes files, still caches | LOW | UX |
| 15 | No --force flag to bypass cache for specific domains | LOW | Usability |
| 16 | `analyzeHtml` async with no await — misleading | LOW | Code quality |
| 17 | No input schema validation — silent on missing/renamed columns | LOW | Reliability |
| 18 | No timestamps in log lines | LOW | Observability |
| 19 | `emails` shown as raw JSON string in outreach XLSX | LOW | UX |
| 20 | No check that neighborhood is registered in neighborhoods.json | LOW | Config |
| 21 | `rating` from Outscraper not used in scoring | INFO | Coverage |
| 22 | LLM-based visual design scoring using stage 3 screenshots | INFO | Enhancement — deferred to v2, `design_score` column reserved as null |
| 23 | Old jQuery / inline style abuse detection | INFO | Coverage |
| 24 | Schema.org / LocalBusiness markup detection | INFO | Coverage |
