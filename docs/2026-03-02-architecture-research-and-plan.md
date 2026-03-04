# Architecture Research & Adjusted Pipeline Plan
**Date:** 2026-03-02
**Status:** Pending user approval — no code changed yet
**Branch:** `feature/email-outreach-pipeline`

---

## 1. Cold Email Infrastructure — The Critical Finding

**Resend cannot be used for cold outreach.** Their ToS explicitly prohibits unsolicited email. Accounts sending cold email get suspended quickly, and their shared sending infrastructure has no warmup — deliverability to cold lists is terrible regardless of ToS.

**What the top 5% actually use:**

| Use case | Tool | Why |
|---|---|---|
| Cold outreach sequences | Instantly.ai or Smartlead | Built-in warmup pools, sending limits, bounce/reply handling, multi-inbox rotation |
| Transactional (receipts, alerts) | Resend | Correct use case |

**The correct architecture:**
- Keep Resend in the project only for future transactional email (e.g., "your report is ready")
- Stage 10 (`10-outreach.mjs`) integrates with **Instantly.ai API** to enroll leads into a sequence
- Separate sending domain required: e.g., `contacto-mejoraweb.com` or `hola.mejoraweb.app` — never your main domain
- Domain needs SPF/DKIM/DMARC + 4–6 weeks warmup before first real send
- **First email is text-only + preview link** — no PDF, no images, no HTML. Plain text wins on deliverability and reply rate for cold B2B.
- PDF attaches on Day 4 follow-up only

**Legal (Spain B2B):** LSSI + GDPR allow legitimate interest for B2B cold email to business addresses (info@, contact@) when there's a genuine business reason. Natural persons require prior consent. You must include unsubscribe + address. Start with generic business emails from Outscraper — do not email mobile numbers converted to email.

**3-touch sequence that works:**
- Day 0: Plain text. Subject: observation about their site. CTA: "I built a mockup, here's a link."
- Day 4: Follow-up. Attach PDF mockup. "Wanted to make sure you saw this."
- Day 12: Break-up email. Short, no attachment. "Closing the loop — let me know if timing is off."

---

## 2. Logo & Brand Color Extraction

**Current state:** Stage 4 scrapes `img[src*=logo]` only — frequently misses logos or grabs wrong images.

**What the top 5% do (extraction hierarchy):**

```
1. JSON-LD structured data  → schema.org/Organization → logo property
2. <link rel="apple-touch-icon">  → high-res, square, always the real brand icon
3. <meta property="og:image">  → often the logo
4. img[src*=logo][src*=icon][src*=brand]  → current approach
5. Clearbit Logo API  → clearbit.com/logo?domain=example.com  → free, reliable fallback
```

**Brand color extraction:** Install `node-vibrant`. After downloading the logo image, extract the dominant palette. Use the most vibrant/saturated color (not the muted background) as the primary brand color for mockdesign.

```js
import Vibrant from 'node-vibrant'
const palette = await Vibrant.from(logoImageBuffer).getPalette()
const brandColor = palette.Vibrant?.hex || palette.Muted?.hex || '#2563eb'
```

This replaces the current `getCategoryColor()` guessing function in `6-mockdesign.mjs` with real brand colors.

---

## 3. Python vs Node.js — User Decision: MIGRATE TO PYTHON

User has more Python experience and prefers readability. Decision: migrate all 8 `.mjs` stages to Python, one by one. Migration is straightforward since the pipeline is linear and each stage is standalone.

**Migration considerations:**
- Use `uv` or `poetry` for dependency management (not bare `pip`)
- Playwright Python: `playwright` pip package — identical API, same Chromium
- Anthropic SDK Python: `anthropic` pip package — identical API
- File I/O: `openpyxl` replaces `xlsx` npm package
- HTTP: `httpx` or `requests` replaces `node-fetch`
- Async: `asyncio` + `async/await` — same pattern as Node.js
- Each stage becomes a `.py` file in `pipeline/`
- Shared utils: `pipeline/utils.py`

---

## 4. Cloud Architecture — GCP Recommended

**Target architecture (when you go cloud):**

```
Admin UI (Cloud Run Service, Python Flask/FastAPI)
  └── triggers → Cloud Run Job (pipeline runner per neighborhood)
                    └── reads/writes → GCS bucket (output/)
                    └── schedules → Cloud Tasks (15-day cleanup job)
                    └── deploys → Cloudflare Pages API (mockup hosting)
```

**Why GCP over Azure:**
- Cloud Run Jobs is purpose-built for this workload (batch, not always-on)
- GCS + Cloud CDN is simpler than Azure Blob + Azure CDN
- Playwright in Cloud Run: Chromium runs cleanly on the `us-central1` base image
- Cloud Tasks has dead-simple delayed task scheduling (15-day cleanup)
- GCP free tier is more generous for Cloud Run Jobs

**Storage:** GCS bucket with folder structure mirroring current `output/`. Cloud Run Job mounts via GCS FUSE or uses native `google-cloud-storage` SDK.

**Admin UI:** Protected by Cloud IAP (Google Identity-Aware Proxy) — zero auth code, just toggle it on. Triggers a Cloud Run Job with `--neighborhood` flag.

---

## 5. Mockup Hosting — Cloudflare Pages

**Vercel free tier:** 100 deployments/month, 3 projects max. At ~30 leads/neighborhood, you'll hit the limit in 3-4 neighborhoods.

**Cloudflare Pages (recommended):** Unlimited deployments, unlimited sites, fast global CDN. Free. Deploy via API in one POST request.

**Long-term (when on GCP):** GCS bucket + Cloud CDN custom domain (`previews.mejoraweb.app`). Eliminates third-party hosting entirely. Files auto-expire via GCS Object Lifecycle rules (15-day TTL at bucket level — no Cloud Tasks needed).

**Programmatic deploy flow for Stage 9:**
```
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects/{project}/deployments
Content-Type: multipart/form-data
Files: mockdesign.html (+ logo.png if present)
→ Returns deployment URL: {hash}.{project}.pages.dev
```

---

## Adjusted Pipeline Architecture

| Stage | File | What it does | Status |
|---|---|---|---|
| 1 | `1-scraper.py` | Outscraper + domains_service | Port from .mjs |
| 2 | `2-auditor.py` | Score leads, XLSX | Port from .mjs |
| 3 | `3-screenshot.py` | Desktop + mobile screenshots | Port from .mjs |
| 4 | `4-content.py` | Scrape content + improved logo | Port + upgrade |
| 5 | `5-prompts.py` | Build brief text | Port from .mjs |
| 6 | `6-mockdesign.py` | Claude API → HTML mockup | Port from .mjs |
| 7 | `7-htmltopng.py` | Playwright → PNG | Port from .mjs |
| 8 | `8-emailcontent.py` | Claude Haiku → email subject + body | New |
| 9 | `9-deploy.py` | Cloudflare Pages deploy + cleanup | New |
| 10 | `10-outreach.py` | Instantly.ai API enroll + `--send` flag | New |

**What gets removed:** `8-postcard.mjs` (PDF postcard killed entirely).

---

## Stage Specs for New Stages

### Stage 8 — `8-emailcontent.py`
- Reads `content.json` + manifest from XLSX
- Calls Claude Haiku to generate: subject line, plain text body (150-200 words), Day 4 follow-up subject
- Saves `{slug}_email.json`: `{ subject, body, followupSubject }`
- `--dry-run` prints the prompt without API call
- Resume-safe: skip if `_email.json` already exists

### Stage 9 — `9-deploy.py`
- At start of run: cleanup expired deployments (>15 days old) via Cloudflare API
- For each lead: deploy `mockdesign.html` (+ `logo.png` if exists) to Cloudflare Pages
- Saves deployment URL back to `{slug}_email.json` as `previewUrl`
- Resume-safe: skip if `previewUrl` already set

### Stage 10 — `10-outreach.py`
- Requires explicit `--send` flag (safety gate — never auto-sends)
- Dry-run by default: shows who would receive what, exits
- With `--send`: enrolls lead in Instantly.ai campaign via API, logs `{ sentAt, campaignId }` to `{slug}_sent.json`
- Never re-sends to leads with existing `_sent.json`

---

## Immediate Build Order (current sprint)

1. Deep research + code quality review (in progress)
2. Upgrade Stage 4 logo extraction (improved hierarchy + node-vibrant)
3. Begin Python migration, one stage at a time (start with Stage 1)
4. Build Stage 8 `8-emailcontent.py`
5. Build Stage 9 `9-deploy.py` (Cloudflare Pages)
6. Build Stage 10 `10-outreach.py` (Instantly.ai API)
7. Re-scrape María de Molina v2 (after all stages done)
8. End-to-end test → merge to main

---

## Open Questions (pending user answers)

1. **Cloudflare Pages or Vercel Pro ($20/month)?** → Research recommends Cloudflare
2. **Instantly.ai or Smartlead?** → Both ~$37/month; Instantly simpler API
3. **Separate sending domain ready?** → Needs 4–6 week warmup — longest lead time item
4. **Stage 4 logo upgrade timing** → Before next mock design run or defer to v2?
5. **Python migration confirmed** → Yes, user confirmed. Migrate one stage at a time.
