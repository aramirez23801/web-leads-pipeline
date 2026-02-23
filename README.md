# Outscraper Leads

A 6-stage lead generation and sales pipeline automation tool for web design services targeting local businesses in Madrid. It scrapes businesses from Google Maps via the Outscraper API, audits their websites for technical issues, scores and tiers them by opportunity, captures screenshots, extracts website content, generates AI website-building prompts (for [Lovable.dev](https://lovable.dev)), and produces print-ready A5 sales postcards.

Built for a specific use case: finding local Spanish businesses near María de Molina 31, Madrid with outdated or broken websites, then generating pitch materials to sell them a modern redesign at €299.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Pipeline Stages](#pipeline-stages)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Usage](#usage)
- [Output Files](#output-files)
- [Data Models](#data-models)
- [Scoring Algorithm](#scoring-algorithm)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Architecture Decisions](#architecture-decisions)
- [Known Limitations](#known-limitations)
- [Extending the Project](#extending-the-project)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## How It Works

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  1. SCRAPER  │───>│  2. AUDITOR  │───>│ 3. SCREENSHOT│───>│ 4. CONTENT   │───>│  5. PROMPTS  │───>│ 6. POSTCARDS │
│              │    │              │    │              │    │    SCRAPE     │    │              │    │              │
│ Google Maps  │    │ Crawl sites  │    │ Mobile +     │    │ Extract text │    │ Lovable.dev  │    │ A5 PDF sales │
│ via          │    │ Score & tier │    │ desktop      │    │ logos, colors│    │ generation   │    │ pitch cards  │
│ Outscraper   │    │ leads        │    │ captures     │    │ contact info │    │ prompts      │    │              │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       ↓                   ↓                   ↓                   ↓                   ↓                   ↓
   .xlsx file         .xlsx file         .png files          .json files         .txt files          .pdf files
   (raw leads)        (scored leads)     (screenshots)       (content)           (prompts)           (postcards)
```

Each stage reads the output of the previous stage. Stages are run manually in sequence. The pipeline is **not** a single command — you run each `.mjs` script individually.

---

## Pipeline Stages

### Stage 1: Scraper (`scraper.mjs`)

Queries the Outscraper Google Maps Search API for 30 Spanish business categories near a fixed GPS coordinate (María de Molina 31, Madrid). Deduplicates by `google_id`, filters for businesses with websites, calculates haversine distance from the origin, and exports to an XLSX spreadsheet.

- **Input**: Outscraper API (live)
- **Output**: `output/businesses_near_maria_de_molina.xlsx`
- **API cost**: ~$7 per full run (30 queries × 500 results, $3/1000 records after 500 free tier)
- **Budget safeguard**: Hard stop at $18 to prevent overspend

### Stage 2: Auditor (`auditor.mjs`)

Reads the Stage 1 XLSX, deduplicates by hostname, crawls each homepage with `fetch()`, and applies 4 technical filters:

| Filter | What it checks | Score weight |
|--------|---------------|-------------|
| Missing viewport | No `<meta name="viewport">` tag — not mobile-responsive | +40 |
| No SSL | Final URL is `http://` or doesn't redirect HTTP→HTTPS | +25 |
| Outdated copyright | Copyright year in footer < 2023 | +15 |
| Dead HTML tags | Uses `<frameset>`, `<font>`, `<marquee>`, etc. | +10 |

Crawl errors (DNS failure, timeouts, connection refused) also add to the score. Results are cached in `crawl_cache.json` for resume capability.

- **Input**: `output/businesses_near_maria_de_molina.xlsx`
- **Output**: `output/leads_audited.xlsx` (sheets: All Leads, Tier 1 Hot Leads, Tier 2 Warm Leads, Summary)
- **Concurrency**: 5 parallel crawls with 200ms delay

### Stage 3: Screenshots (`screenshot.mjs`)

Uses Puppeteer (headless Chrome) to capture mobile (375×812 @2x) and desktop (1440×900) screenshots of Tier 1 and high-score Tier 2 leads. Automatically dismisses cookie consent banners. Creates placeholder images for sites that fail to load.

- **Input**: `output/leads_audited.xlsx`
- **Output**: `output/screenshots/*.png` + `output/screenshots/manifest.json`
- **Concurrency**: 3 parallel browser pages

### Stage 4: Content Scrape (`scrape-content.mjs`)

Uses Puppeteer to extract structured content from each lead's website: title, meta description, heading/paragraph sections, footer text, images (downloads logo + 5 largest images), computed colors (background, header, link), phone numbers (Spanish format), and email addresses.

- **Input**: `output/leads_audited.xlsx`
- **Output**: `output/content/{safeName}/content.json` + images, `output/content/all_content.json`
- **Concurrency**: 3 parallel browser pages

### Stage 5: Lovable Prompts (`lovable-prompts.mjs`)

Reads the aggregated content JSON from Stage 4 and generates a detailed [Lovable.dev](https://lovable.dev) prompt for each lead. The prompt includes business info, extracted website content, color scheme, design requirements (mobile-first, Spanish language, WhatsApp CTA), and Google rating as social proof.

- **Input**: `output/content/all_content.json`
- **Output**: `output/prompts/{safeName}_lovable_prompt.txt` + `output/prompts/index.json`

### Stage 6: Postcards (`postcards.mjs`)

Generates print-ready A5 (148×210mm) PDF postcards for Tier 1 leads only. Each postcard includes a header question in Spanish, the lead's mobile screenshot, a mockup placeholder for the redesigned version, a translated pitch based on detected issues, a CTA with pricing (€299 + IVA), and contact info.

- **Input**: `output/screenshots/manifest.json` + `output/leads_audited.xlsx`
- **Output**: `output/postcards/{safeName}_postcard.pdf` + `output/postcards/all_postcards.pdf`

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Node.js 18+ (ES modules) | Script execution |
| API client | Native `fetch()` | Outscraper REST API calls |
| Web scraping | Puppeteer | Headless Chrome for screenshots and content extraction |
| HTML parsing | Cheerio | Server-side DOM analysis for audit filters |
| Image processing | Sharp | Image resizing, placeholder SVG-to-PNG |
| Spreadsheet | xlsx (SheetJS) | Read/write Excel files |
| PDF generation | pdf-lib + @pdf-lib/fontkit | Create A5 postcard PDFs |
| Concurrency | p-limit | Throttle parallel async operations |
| Environment | dotenv | Load `.env` variables |

**No database** — all data is stored as XLSX, JSON, and cache files in the `output/` directory.

---

## Prerequisites

- **Node.js 18+** (for native `fetch()` and ES module support)
- **An Outscraper API key** — get one at [outscraper.com](https://outscraper.com). The free tier includes 500 records/month. Beyond that, it costs $3 per 1,000 records.
- **~2 GB free disk** for the `output/` directory (screenshots, images, PDFs)
- **Chrome/Chromium** — Puppeteer downloads its own bundled Chromium during `npm install`

---

## Setup

```bash
# Clone the repo
git clone https://github.com/<your-username>/outscraper-leads.git
cd outscraper-leads

# Install dependencies
npm install

# Create your .env file
echo "OUTSCRAPER_API_KEY=your_key_here" > .env
```

---

## Usage

Run each stage sequentially. Each script reads the output of the previous one.

### Full pipeline

```bash
# Stage 1: Scrape businesses from Google Maps (~$7 API cost)
node scraper.mjs

# Stage 2: Audit websites and score/tier leads
node auditor.mjs

# Stage 3: Take mobile + desktop screenshots
node screenshot.mjs

# Stage 4: Extract website content, logos, images
node scrape-content.mjs

# Stage 5: Generate Lovable.dev prompts
node lovable-prompts.mjs

# Stage 6: Generate A5 PDF postcards
node postcards.mjs
```

### Test / dry run

```bash
# Stage 1 dry run: 1 query, 3 results (minimal API cost)
node scraper.mjs --dry-run

# Stage 2 limited run: audit only 10 domains
node auditor.mjs 10
```

### Resume interrupted audit

The auditor caches crawl results in `output/crawl_cache.json`. If the process crashes or is interrupted, re-running `node auditor.mjs` will skip already-crawled domains and continue from where it left off.

To force a clean re-crawl, delete the cache:

```bash
rm output/crawl_cache.json
```

---

## Output Files

After a full pipeline run, the `output/` directory contains:

```
output/
├── businesses_near_maria_de_molina.xlsx   # Stage 1: Raw business data from Outscraper
├── leads_audited.xlsx                     # Stage 2: Scored & tiered leads (4 sheets)
├── crawl_cache.json                       # Stage 2: Crawl result cache (for resume)
├── scraper_log.txt                        # Stage 1: Execution log
├── screenshots/                           # Stage 3
│   ├── manifest.json                      #   Metadata for all screenshot results
│   ├── errors.log                         #   Screenshot failure log
│   ├── {safeName}_mobile.png              #   375×812 @2x mobile screenshots
│   └── {safeName}_desktop.png             #   1440×900 desktop screenshots
├── content/                               # Stage 4
│   ├── all_content.json                   #   Aggregated content for all leads
│   └── {safeName}/                        #   Per-business folder
│       ├── content.json                   #     Extracted page data
│       ├── logo.png                       #     Downloaded logo (if found)
│       └── images/                        #     Up to 5 largest images
│           └── image_1.png
├── prompts/                               # Stage 5
│   ├── index.json                         #   Quick-reference index
│   └── {safeName}_lovable_prompt.txt      #   Full Lovable.dev generation prompt
└── postcards/                             # Stage 6
    ├── all_postcards.pdf                  #   Combined PDF of all postcards
    └── {safeName}_postcard.pdf            #   Individual A5 postcard PDFs
```

The `output/` directory is gitignored. All output is regenerable by re-running the pipeline.

### XLSX sheets in `leads_audited.xlsx`

| Sheet | Contents |
|-------|----------|
| All Leads | Every audited business sorted by score (desc) then distance (asc) |
| Tier 1 Hot Leads | Score >= 65 — sites with multiple critical issues or dead sites |
| Tier 2 Warm Leads | Score 40–64 — sites with one major issue |
| Summary | Aggregate stats: counts per tier, crawl success rate, avg score |

---

## Data Models

### Lead record (from Outscraper API — Stage 1)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Business name |
| `full_address` | string | Full street address |
| `website` | string | Business website URL |
| `phone` | string | Phone number |
| `category` | string | Primary Google Maps category |
| `subtypes` | string[] | Additional category labels |
| `rating` | number | Google Maps rating (1–5) |
| `reviews` | number | Review count |
| `latitude` / `longitude` | number | GPS coordinates |
| `google_id` | string | Unique Google Places identifier |
| `place_id` | string | Google Place ID |
| `working_hours` | object | Opening hours (JSON) |
| `description` | string | Business description from Google |
| `distance_meters` | number | Haversine distance from origin (computed) |

### Audited lead (Stage 2 additions)

| Field | Type | Description |
|-------|------|-------------|
| `tier` | `"Tier 1"` \| `"Tier 2"` \| `"Tier 3"` \| `"Tier 4"` | Opportunity tier |
| `opportunity_score` | 0–100 | Composite technical debt score |
| `missing_viewport` | boolean | No `<meta name="viewport">` tag |
| `no_ssl` | boolean | Site doesn't use HTTPS |
| `copyright_year` | number \| null | Latest copyright year found in footer |
| `outdated_copyright` | boolean | Copyright year < 2023 |
| `has_dead_tags` | boolean | Uses obsolete HTML elements |
| `dead_tags_found` | string | Comma-separated list of dead tags |
| `crawl_error` | string \| null | Error type if crawl failed |
| `final_url` | string | URL after redirects |
| `pitch_angle` | string | Auto-generated sales pitch in English |

### Extracted content (Stage 4)

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Page `<title>` |
| `metaDescription` | string | Meta description tag content |
| `sections` | `{heading, content}[]` | H1/H2/H3 headings with following paragraph text |
| `footerText` | string | Footer element text content |
| `images` | `{src, alt, width, height, isLogo}[]` | All `<img>` elements with metadata |
| `colors` | `{bodyBg, headerBg, linkColor}` | Computed CSS colors |
| `contactInfo.phones` | string[] | Spanish phone numbers found on page |
| `contactInfo.emails` | string[] | Email addresses found on page |
| `logoUrl` | string \| null | URL of the detected logo image |

---

## Scoring Algorithm

Each lead gets an **opportunity score** from 0 to 100 (capped). Higher scores = worse websites = better sales opportunities.

```
score = 0

// Crawl failure (mutually exclusive, highest wins)
if DNS_FAIL or CONNECTION_REFUSED  → score += 50
else if TIMEOUT                    → score += 30
else if ANY_OTHER_CRAWL_ERROR      → score += 20

// Technical filters (additive)
if MISSING_VIEWPORT                → score += 40
if NO_SSL                          → score += 25
if COPYRIGHT_YEAR < 2023           → score += 15
if HAS_DEAD_HTML_TAGS              → score += 10

score = min(score, 100)
```

### Tier assignment

| Tier | Score range | Label | Meaning |
|------|------------|-------|---------|
| Tier 1 | >= 65 | HOT | Multiple critical issues or dead site. Highest priority. |
| Tier 2 | 40–64 | WARM | One major issue (e.g., no viewport OR no SSL). Strong pitch. |
| Tier 3 | 15–39 | COOL | Minor issues. Modernization pitch possible. |
| Tier 4 | < 15 | SKIP | Site appears modern. Low priority. |

---

## Configuration

All configuration is hardcoded in the respective script files. Key values:

### `scraper.mjs`

| Constant | Value | Description |
|----------|-------|-------------|
| `ORIGIN_LAT` / `ORIGIN_LON` | `40.437750`, `-3.681861` | GPS origin (María de Molina 31, Madrid) |
| `BUDGET_LIMIT` | `18` | Hard stop at $18 API spend |
| `FREE_TIER` | `500` | Free records/month on Outscraper |
| `COST_PER_1000` | `3` | Dollars per 1,000 records beyond free tier |
| `FETCH_TIMEOUT` | `300000` | 5-minute timeout per API request |
| `BATCH_DELAY` | `5000` | 5-second delay between API batches |
| `BATCHES` | 3 arrays × 10 queries | 30 Spanish business category search queries |

### `auditor.mjs`

| Constant | Value | Description |
|----------|-------|-------------|
| `CONCURRENCY` | `5` | Parallel crawl limit |
| `DELAY_MS` | `200` | Delay between crawl tasks |
| `TIMEOUT_MS` | `15000` | Per-site crawl timeout |

### `screenshot.mjs` / `scrape-content.mjs`

| Constant | Value | Description |
|----------|-------|-------------|
| `CONCURRENCY` | `3` | Parallel Puppeteer pages |
| `TIMEOUT_MS` | `20000` | Per-page navigation timeout |

### `postcards.mjs`

| Constant | Value | Description |
|----------|-------|-------------|
| A5 dimensions | `148×210mm` (419.6×595.4pt) | Postcard page size |
| `MARGIN` | `28pt` | Page margin |
| CTA price | `€299 + IVA` | Hardcoded pricing in postcard |
| Contact | `[TU TELÉFONO]` | Placeholder — replace before printing |

---

## API Reference

### Outscraper Google Maps Search API

**Base URL**: `https://api.outscraper.cloud`

**Endpoints used**:

1. **Search**: `GET /google-maps-search`
   - Query params: `query`, `limit`, `coordinates`, `language`, `region`, `dropDuplicates`, `fields`, `async`
   - Auth header: `X-API-KEY: <your_key>`
   - Returns: `{ data: [...] }` — array of business records (possibly nested arrays, one per query)

2. **Poll** (for async requests): `GET /requests/{requestId}`
   - Used when the search endpoint returns `202 Accepted`
   - Polls every 30s, max 20 attempts

**Error handling**:
- `401`: Invalid API key → hard exit
- `402`: Billing issue → hard exit
- `204`: No results → returns empty
- `429`: Rate limited → waits 60s, retries up to 3 times
- `202`: Async queued → switches to polling

**API docs**: [outscraper.com/api-documentation](https://outscraper.com/api-documentation/)

---

## Architecture Decisions

**Why file-based, not a database?** This is a batch processing tool, not a web app. Runs once (or weekly), processes data in stages, outputs files. A database would add unnecessary complexity.

**Why separate scripts, not one pipeline?** Each stage can fail independently. If screenshots fail, you don't need to re-crawl 2,000 domains. Stages are idempotent — re-running uses cached data where available.

**Why Puppeteer for screenshots AND content?** Cheerio (used in the auditor) can't execute JavaScript. Many Spanish business sites are built with WordPress/Wix/Squarespace which render content client-side. Puppeteer ensures we see what visitors see.

**Why both `fetch()` and Puppeteer for crawling?** The auditor (Stage 2) uses native `fetch()` for speed — it only needs raw HTML to check for `<meta>` tags and `<font>` elements. The content scraper (Stage 4) needs Puppeteer because it extracts computed CSS colors and JS-rendered content.

**Why hardcoded to Madrid?** This is a personal sales tool, not a SaaS product. The GPS coordinates, search queries, postcard language, and pricing are all specific to one sales operation in Madrid.

---

## Known Limitations

1. **Location hardcoded**: All 30 search queries target "María de Molina Madrid." To use in another city, you need to edit `BATCHES` and `ORIGIN_LAT`/`ORIGIN_LON` in `scraper.mjs`.

2. **Language hardcoded**: Postcards, pitches, and Lovable prompts are in Spanish. The auditor and scraper work in any language, but downstream stages assume Spanish.

3. **No automated scheduling**: Scripts run manually. To automate, use Windows Task Scheduler or cron.

4. **Puppeteer is heavy**: Stages 3 and 4 launch a headless Chrome instance. On low-memory machines, reduce `CONCURRENCY` to 1–2.

5. **Copyright detection is heuristic**: The regex looks for `©` followed by a 4-digit year. It won't catch years embedded in images or heavily obfuscated footers.

6. **SSL check has edge cases**: The auditor checks if `http://` redirects to `https://`. Some sites use HSTS headers but don't redirect — these may be incorrectly flagged.

7. **No incremental updates**: Re-running Stage 1 fetches all 30 categories again (full API cost). There's no diff mechanism to only fetch new businesses.

8. **Postcard mockup is a placeholder**: The "after" section on postcards shows a green bordered rectangle labeled "MOCKUP." You need to manually replace this with an actual redesign screenshot before printing.

9. **Phone number on postcards**: The CTA shows `[TU TELÉFONO]`. Replace this with your actual phone number in `postcards.mjs` line 228 before generating.

---

## Extending the Project

### Change the target city

Edit `scraper.mjs`:

```js
// Replace these with your target coordinates
const ORIGIN_LAT = 40.437750;  // your latitude
const ORIGIN_LON = -3.681861;  // your longitude

// Replace search queries with your categories + city
const BATCHES = [
  ['restaurantes <your city>', 'abogados <your city>', ...],
  ...
];
```

### Change the scoring weights

Edit `auditor.mjs`, function `scoreResult()` (line 204):

```js
function scoreResult(result) {
  let score = 0;
  if (result.missing_viewport) score += 40;  // change these weights
  if (result.no_ssl) score += 25;
  // ...
}
```

### Change the postcard pricing / contact

Edit `postcards.mjs`:
- Line 218: Change `€299 + IVA` to your pricing
- Line 228: Replace `[TU TELÉFONO]` with your phone number
- Line 238: Replace `Kevin León — Diseño Web Profesional` with your name/brand

### Add new audit filters

In `auditor.mjs`, add checks inside `analyzeHtml()` (line 145) and add score weight in `scoreResult()` (line 204).

---

## Troubleshooting

### `ERROR: Set OUTSCRAPER_API_KEY in .env`

Your `.env` file is missing or the key is not set. Create it:

```bash
echo "OUTSCRAPER_API_KEY=your_actual_key" > .env
```

### `ERROR 401: Invalid API key`

Your Outscraper API key is incorrect or expired. Check at [outscraper.com/dashboard](https://outscraper.com/dashboard).

### `HARD STOP: Estimated cost exceeds $18 limit`

The scraper hit its budget safeguard. This is normal if you've already used some of your free tier quota this month. Increase `BUDGET_LIMIT` in `scraper.mjs` if needed.

### Puppeteer fails to launch

If `screenshot.mjs` or `scrape-content.mjs` fail with Chrome errors:

```bash
# Re-install Puppeteer's bundled Chrome
npx puppeteer browsers install chrome
```

### Audit stalls or crashes

Re-run `node auditor.mjs` — it will resume from the cache. If a specific domain is hanging, find it in `output/crawl_cache.json` and manually add an entry to skip it.

### Out of memory during screenshots

Reduce concurrency in `screenshot.mjs`:

```js
const CONCURRENCY = 1;  // was 3
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OUTSCRAPER_API_KEY` | Yes | Your Outscraper API key. Get one at [outscraper.com](https://outscraper.com) |

---

## License

ISC
