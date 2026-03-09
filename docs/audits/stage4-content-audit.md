# Stage 4 — `4-content.mjs` Audit
**Date:** 2026-03-09
**Status:** ✅ Complete — all HIGH/MEDIUM/LOW items resolved, end-to-end tested
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Stage 4 visits each Tier 1 + Tier 2 lead's website with Puppeteer, extracts structured
content (headings, colors, contact info, images), downloads the logo, and writes
`content.json` per lead. Stage 5 reads `content.json` to build the design brief.
Stage 6 reads `content.json` directly to build the Claude API prompt.

**This stage is critical:** everything stage 6 uses to customize the mockup comes from
here. Missing or low-quality data = generic AI-generated website instead of a
personalized redesign.

**Inputs:**
- `output/leads_audited_{neighborhood}.xlsx` — Tier 1 + Tier 2 worksheets via `getTargetLeads()`

**Outputs:**
- `output/content_{neighborhood}/{safeName}/content.json`
- `output/content_{neighborhood}/{safeName}/logo.png` (if found)
- `output/content_{neighborhood}.log` (full run log)

---

## Technical Audit

### 1. Error Handling & Resilience

**What was working:**
- Per-lead try/catch — one failure doesn't abort the batch.
- `finally` closes page on error.
- On error, writes `content.json` with `scrapeError` set — downstream stages always find a file.

**Issues found:**

**[HIGH] `browser.close()` not in a `finally` block.**
If any task threw outside its own try/catch (e.g., `browser.newPage()` fails), `Promise.all`
rejects and `browser.close()` is never called. Browser process leaks.
→ **Fixed:** browser wrapped in `try/finally`.

**[MEDIUM] `networkidle2` caused 20s timeouts on analytics-heavy sites.**
Many SME sites run continuous background requests (analytics, chat widgets). These never
reach `networkidle2`, always hitting the 20s timeout even when the page was visually complete.
→ **Fixed:** `domcontentloaded` + 1500ms fixed wait, same pattern as stage 3.

**[LOW] No retry on navigation failure.**
→ **Fixed:** one retry on first navigation failure.

**[LOW] Logo `fetch` had no timeout — could hang indefinitely.**
→ **Fixed:** `AbortController` with 5s timeout on logo fetch.

---

### 2. Environment & Config Validation

**What was working:**
- Input file checked with clear error + hint.
- No API keys required.

**Issues found:**

**[LOW] No `--lead` flag for single-lead testing.**
→ **Fixed:** `--lead <safeName>` flag added, same pattern as stages 3, 6, 8, 9.

---

### 3. Data Integrity & Schema Validation

**Issues found:**

**[HIGH] `emails` parsed with comma-split instead of `JSON.parse()`.**
Stage 1 stores emails as a JSON array string (`'["a@b.com","c@d.com"]'`). The old code
did `String(lead.emails).split(',')` which produced garbage output with brackets and
quotes in the email strings.
→ **Fixed:** `JSON.parse(lead.emails || '[]')` with try/catch fallback.

**[MEDIUM] `description` (Google Maps) not passed through to content.json.**
The most reliable, human-curated description of the business — available in the audited
XLSX but dropped at stage 4. Stage 6's prompt would be far more specific with this context.
→ **Fixed:** `description` added to `contentData` from XLSX row.

**[MEDIUM] `working_hours` not passed through to content.json.**
Real business hours in the mockup is one of the highest-impact personalization improvements.
→ **Fixed:** `working_hours` added to `contentData` from XLSX row.

**[MEDIUM] `cms_detected` not passed through to content.json.**
Useful context for stage 6: "this is a Jimdo site from 2012" changes what issues to address.
→ **Fixed:** `cms_detected` added to `contentData` from XLSX row.

---

### 4. Performance & Bottlenecks

**Issues found:**

**[HIGH — dropped] 5 downloaded images were never used by any downstream stage.**
Stage 6's `buildMockPrompt()` doesn't reference image files. Stage 5 doesn't reference them.
The `images/` directory contained files no stage read.
→ **Fixed:** image downloads removed entirely. Logo download kept (stage 6 references `./logo.png`).

**[MEDIUM] `networkidle2` bottleneck** — see §1 above.

---

### 5. Rate Limiting & Politeness

**No issues found.** `pLimit(3)` + different domains = no per-domain concerns.

---

### 6. Logging & Observability

**Issues found:**

**[MEDIUM] No timestamps on log lines.**
→ **Fixed:** `log()` / `logError()` functions added with ISO timestamps.

**[MEDIUM] No log file.**
→ **Fixed:** `output/content_{neighborhood}.log` written via `appendFileSync`.

**[LOW] Success log line too sparse.**
→ **Fixed:** now logs sections count, logo found/missing, color found/missing, email count.

---

### 7. Idempotency

**Issues found:**

**[HIGH] No resume safety — re-scraped all leads on every run.**
→ **Fixed:** checks if `content.json` exists and `scrapeError` is null before scraping.
Skips with `↩ already done` log line. Same pattern as stages 3, 6, 8, 9.

---

### 8. Output Contract

**What stage 5 and 6 consume from content.json:**

| Field | Stage 5 | Stage 6 | Before | After |
|---|---|---|---|---|
| `name` | ✓ | ✓ | ✓ | ✓ |
| `category` | ✓ | ✓ | ✓ | ✓ |
| `full_address` | ✓ | ✓ | ✓ | ✓ |
| `phone` | ✓ | ✓ | ✓ | ✓ |
| `sections[]` | ✓ | ✓ (8 max) | ✓ | ✓ |
| `colors` | ✓ | ✓ | partial | ✓ extended |
| `logoUrl` | ✓ | ✓ | ✓ | ✓ |
| `contactInfo.emails` | ✓ | — | broken (comma-split) | ✓ fixed |
| `contactInfo.phones` | ✓ | — | ✓ | ✓ |
| `pitch_angle` | ✓ | ✓ | ✓ | ✓ |
| `description` | — (pending §5 audit) | — (pending §6 audit) | **MISSING** | ✓ added |
| `working_hours` | — (pending §5 audit) | — (pending §6 audit) | **MISSING** | ✓ added |
| `cms_detected` | — | — (pending §6 audit) | **MISSING** | ✓ added |
| `bodyParagraphs[]` | — | ✓ | **MISSING** | ✓ added |
| `serviceLists[][]` | — | ✓ | **MISSING** | ✓ added |
| `testimonials[]` | — | ✓ | **MISSING** | ✓ added |
| `jsonLd[]` | — | ✓ | **MISSING** | ✓ added |
| `socialLinks{}` | — | ✓ | **MISSING** | ✓ added |
| `metaKeywords` | — | ✓ | **MISSING** | ✓ added |
| `ogImage` | — | ✓ | **MISSING** | ✓ added |
| `subpagesCrawled[]` | — | — | **MISSING** | ✓ added |

`description`, `working_hours`, and `cms_detected` are now in content.json. Stages 5 and 6
must be updated during their own audits to consume these fields.

---

### 9. Dependency Audit

**`puppeteer`** — no known critical CVEs.
**`p-limit`** — no known CVEs.

**[HIGH — tracked in pending-cross-stage.md] Stage 5 still uses `xlsx` HIGH CVE.**
Not in scope for this stage — will be fixed during stage 5 audit.

---

### 10. Dead Code & Unused Imports

**[MEDIUM — resolved] Image download block was dead output.**
No downstream stage read the downloaded images. Removed entirely.
`imagesDir` creation also removed (no longer needed).

---

## Stage-Specific Audit

### Logo detection

**Before:** `isLogo` heuristic flagged every image inside a `<header>` as a logo candidate,
including hero backgrounds, social icons, and nav images. `findLogo()` would return the
first CDN-filtered match, which may not be the actual logo.

**After:** Improved heuristic — an image is a logo candidate if:
- `src` or `alt` contains "logo", OR
- It's inside a `[class*="logo"]` or `[id*="logo"]` container, OR
- It's inside an `<a href="/">` (homepage link), OR
- It's a small image (< 300px wide) inside a `<header>`

Large hero images inside headers are no longer flagged as logos.

### Image downloads

**Decision: removed.** Stage 6 doesn't use downloaded images. The logo is the only
image that matters (referenced as `./logo.png` in the HTML mockup). Downloading 5 large
background JPEGs per lead added disk usage and fetch time with zero downstream value.

### Color extraction

**Before:** Only read `body.backgroundColor` (almost always white), `header.backgroundColor`
(often transparent), and first `<a>` color. Missed actual brand colors.

**After:** Also reads:
- `buttonBg` — background color of first button/CTA element
- `primaryVar` — CSS custom property (`--primary`, `--brand-color`, `--primary-color`,
  `--color-primary`, `--accent-color`) from `:root`

These are where modern sites store their actual brand colors. Stage 6's `getCategoryColor()`
now has more signal to work with before falling back to category defaults.

### Content completeness for stage 6

Three fields that were previously dropped now flow through:
- `description` — Google Maps business description (human-curated, specific)
- `working_hours` — real business hours (JSON string from Outscraper)
- `cms_detected` — CMS type from stage 2 audit

These are passed through from the audited XLSX. Stages 5 and 6 must be updated in their
own audits to use them.

### Subpage crawl

**Motivation:** Most SME sites have 90% of their useful content on "Servicios", "Nosotros",
or "Clientes" pages — not the homepage. A homepage-only scrape produced thin content.json
files with only Flash error messages (INTELMA) or 3 generic marketing sentences (Area2).

**Implementation:**
- `scoreNavLinks()` scores all `<nav>/<header>/<menu>` links by SUBPAGE_CONTENT_KW
  (services, productos, nosotros, about, portfolio, galeria, cliente, etc.)
- Links matching SUBPAGE_SKIP_KW (contacto, privacidad, blog, login, tienda, sitemap,
  lang=, /en/, etc.) are excluded
- Top 2 scoring same-domain links are crawled with `domcontentloaded` + 1s wait
- `mergePageData()` deduplicates sections by heading, paragraphs by content, merges all
  arrays. Homepage `colors` kept as primary (header most representative)
- `subpagesCrawled[]` in output records which pages were visited

**Result (test run):**
- INTELMA: 0 subpages crawled (Flash site, no crawlable nav links scoring > 0)
- Area2: 2 subpages (empresa-quienes-somos.php + clientes.php) — added OBJETO/MISIÓN sections
- Telelectric: 2 subpages (quienes-somos + servicios) — added company history paragraph

### Content enrichment (bodyParagraphs, serviceLists, testimonials, etc.)

**`bodyParagraphs`:** `<p>` tags with >80 chars, outside nav/header/footer/cookie banners.
Max 8. Captures prose description that doesn't live in heading+sibling structure.

**`serviceLists`:** `<ul>`/`<li>` groups outside nav, 2–50 items, 10–200 chars each.
Captures structured service/product lists. May include some footer nav items — acceptable
noise for LLM consumption.

**`testimonials`:** `<blockquote>` and elements with class/id containing "testimon", "review",
"quote", "valoracion", or "opinion". Captures customer quotes for social proof context.

**`partnerNames`:** `<img>` alt text near headings containing "client", "partner",
"colabor", "referencia". Captures logo alt text of notable clients.

**`jsonLd`:** All `<script type="application/ld+json">` blocks. Often contains LocalBusiness
schema with name, address, phone, openingHours — highly reliable structured data.

**`socialLinks`:** Links to facebook, instagram, twitter, linkedin, youtube domains.

**`ogImage`:** `<meta property="og:image">` — best available photo of the business.

### LLM in stage 4?

**Decision: no LLM in stage 4 itself.** Stage 4's job is data extraction — Puppeteer +
regex is the right tool. Adding an LLM call here adds cost and latency for a task that
is fundamentally DOM reading.

**Where an LLM would help:** passing richer data to stage 6. With `description`,
`working_hours`, and better color/section data now flowing through, stage 6 already gets
much better input. A Haiku pre-processing step that summarizes page content into a
structured brief could be added as a stage 4.5 after the first campaign validates the need.

---

## Summary Table

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | `browser.close()` not in finally — leaks browser on uncaught error | HIGH | ✅ Fixed |
| 2 | `emails` parsed with comma-split instead of JSON.parse — garbage output | HIGH | ✅ Fixed |
| 3 | No resume safety — re-scraped all leads on every run | HIGH | ✅ Fixed |
| 4 | 5 downloaded images never used by any downstream stage | MEDIUM | ✅ Removed |
| 5 | `networkidle2` caused 20s timeouts on analytics-heavy sites | MEDIUM | ✅ Fixed |
| 6 | `description` (Google Maps) not in content.json | MEDIUM | ✅ Fixed |
| 7 | `working_hours` not in content.json | MEDIUM | ✅ Fixed |
| 8 | `cms_detected` not in content.json | MEDIUM | ✅ Fixed |
| 9 | No timestamps on log lines | MEDIUM | ✅ Fixed |
| 10 | No log file — observability lost after process exits | MEDIUM | ✅ Fixed |
| 11 | `isLogo` heuristic flagged every header image as logo candidate | MEDIUM | ✅ Fixed |
| 12 | Color extraction missed brand colors (buttons, CSS custom props) | MEDIUM | ✅ Fixed |
| 13 | No `--lead` flag for single-lead testing | LOW | ✅ Fixed |
| 14 | Logo `fetch` had no timeout — could hang indefinitely | LOW | ✅ Fixed |
| 15 | No retry on navigation failure | LOW | ✅ Fixed |
| 16 | Stage 5 still uses `xlsx` HIGH CVE | HIGH | ⏳ Tracked in pending-cross-stage.md |
| 17 | Thin content: only homepage scraped — subpages with rich service info ignored | MEDIUM | ✅ Fixed |
| 18 | `bodyParagraphs` missing — sections miss prose text that lives in `<p>` tags | MEDIUM | ✅ Fixed |
| 19 | `serviceLists` missing — structured `<ul>`/`<li>` service names not captured | MEDIUM | ✅ Fixed |
| 20 | `testimonials` missing — customer reviews/quotes not captured | LOW | ✅ Fixed |
| 21 | `partnerNames` missing — client/partner logos with alt text not captured | LOW | ✅ Fixed |
| 22 | `jsonLd` missing — JSON-LD structured data (LocalBusiness schema) ignored | MEDIUM | ✅ Fixed |
| 23 | `socialLinks` missing — Facebook/Instagram/LinkedIn URLs not captured | LOW | ✅ Fixed |
| 24 | OG tag fallbacks not used for title/description/image | LOW | ✅ Fixed |
| 25 | `metaKeywords` not captured — useful signal for LLM context | LOW | ✅ Fixed |
| 26 | `isLogo` heuristic matched 17×17 nav icons via `<a href="/">` | MEDIUM | ✅ Fixed (30px min) |
