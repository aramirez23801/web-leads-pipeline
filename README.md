# web-leads-pipeline

Neighborhood-by-neighborhood lead generation pipeline for Madrid local businesses. Scrapes Google Maps, audits websites for technical issues, scores by opportunity, and prepares outreach materials.

## Overview

| Stage | Script             | What it does                                           |
| ----- | ------------------ | ------------------------------------------------------ |
| 1     | `1-scraper.mjs`    | Scrapes businesses from Google Maps via Outscraper API |
| 2     | `2-auditor.mjs`    | Crawls websites, scores technical issues, tiers leads  |
| 3     | `3-screenshot.mjs` | Takes mobile + desktop screenshots of Tier 1 & 2 leads |
| 4     | `4-content.mjs`    | Extracts colors, logo, copy, and contact info          |
| 5     | `5-prompts.mjs`    | Generates structured client briefs for redesign work   |
| 6     | `6-postcards.mjs`  | Generates printable A5 postcard PDFs                   |

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/web-leads-pipeline
cd web-leads-pipeline
npm install
cp .env.example .env
# Edit .env with your API keys and contact info
```

## Configuration

Copy `.env.example` to `.env` and fill in:

- `OUTSCRAPER_API_KEY` — get from [outscraper.com](https://outscraper.com)
- `NEIGHBORHOOD_NAME` — default neighborhood (e.g. `maria_de_molina`)
- `ORIGIN_LAT` / `ORIGIN_LON` — coordinates for distance calculations
- `YOUR_NAME`, `YOUR_PHONE`, `YOUR_WHATSAPP` — used in postcard PDFs

## Usage

### Run a full pipeline for a neighborhood

```bash
# Default neighborhood (from .env)
npm run scrape
npm run audit
npm run screenshot

# Specific neighborhood
npm run scrape -- --neighborhood retiro --lat 40.4153 --lon -3.6844
npm run audit -- --neighborhood retiro
npm run screenshot -- --neighborhood retiro
```

### Individual stages

```bash
npm run scrape:dry        # Test scraper with 1 query, 3 results
npm run audit:dry         # Audit first 10 domains only
npm run content           # Scrape colors, logos, copy
npm run briefs            # Generate client briefs
npm run postcards         # Generate postcard PDFs
```

### Run everything at once

```bash
npm run pipeline
```

## Output files

All output goes to `output/` (gitignored). Per neighborhood:

| File                     | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `businesses_{n}.xlsx`    | Raw scraped businesses                                      |
| `leads_audited_{n}.xlsx` | Scored and tiered leads                                     |
| `outreach_{n}.xlsx`      | Clean call sheet (Tier 1 + 2 only)                          |
| `screenshots_{n}/`       | Mobile + desktop screenshots                                |
| `content_{n}/`           | Per-lead content folders with `content.json` and `brief.md` |
| `briefs_{n}/`            | All briefs in one folder                                    |
| `postcards_{n}/`         | Printable postcard PDFs                                     |
| `scraper_{n}.log`        | Scraper run log                                             |

`neighborhoods.json` tracks all scraped areas with costs and contact counts.

## Scoring model

Leads are scored 0–100 based on website issues:

| Issue                                     | Points |
| ----------------------------------------- | ------ |
| DNS fail / connection refused (dead site) | +50    |
| Timeout / connection reset                | +35    |
| Other crawl error                         | +20    |
| Missing viewport (not mobile-friendly)    | +40    |
| No SSL certificate                        | +25    |
| Outdated copyright year                   | +15    |
| Dead tracking tags                        | +10    |
| Heavy page (30+ images)                   | +10    |

Score is capped at 100, then multiplied by a review count bonus:

- 50+ reviews → ×1.2
- 10–49 reviews → ×1.1
- <10 reviews → ×1.0

**Tiers:**

- Tier 1 (HOT): score ≥ 60
- Tier 2 (WARM): score ≥ 35
- Tier 3 (COOL): score ≥ 15
- Tier 4 (SKIP): score < 15

## Cost

Outscraper charges ~$3 per 1,000 results with a 500-result free tier per query. A full 30-category neighborhood scrape costs roughly **$7**.

The scraper has a hard stop at $18 per run.
