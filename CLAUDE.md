## Active Branch
Currently working on: `feature/email-outreach-pipeline`
Merge target: `main` — only merge when all new stages are tested end-to-end.

---

## Pipeline Architecture
10-stage Node.js ESM pipeline. Each stage is a standalone `.mjs` file in `pipeline/`.
All stages share `pipeline/utils.mjs` for common utilities.

| Stage | File | Status | What it does |
|-------|------|--------|--------------|
| 1 | `1-scraper.mjs` | ✓ Done | Outscraper + domains_service email extraction |
| 2 | `2-auditor.mjs` | ✓ Done | Score/tier leads, write XLSX |
| 3 | `3-screenshot.mjs` | ✓ Done | Desktop + mobile screenshots |
| 4 | `4-content.mjs` | ✓ Done | Scrape content, download logo/images |
| 5 | `5-prompts.mjs` | ✓ Done | Build design brief text |
| 6 | `6-mockdesign.mjs` | ✓ Done | Claude API → HTML mockup per lead |
| 7 | `7-htmltopng.mjs` | ✓ Done | Playwright → full PNG + preview PNG + PDF |
| 8 | `8-emailcontent.mjs` | In progress | Claude Haiku → email subject + body |
| 9 | `9-deploy.mjs` | Pending | Cloudflare Pages direct upload, adds previewUrl |
| 10 | `10-outreach.mjs` | Pending | CSV export per neighborhood, --send gate |

`8-postcard.mjs` is DELETED. No postcard PDF. Email content + Cloudflare preview link instead.
Never modify stages 1-7 unless explicitly asked — they are stable and tested.

---

## Engineering Philosophy

Code quality matters more than speed of delivery. Build it right the first time.

### While developing each stage
- Write the smallest testable unit first. Verify it works. Then expand.
- Use `--dry-run` and `--lead` flags liberally — never run full batch to test a change.
- Never commit broken or untested code to the branch.
- Commit each stage separately with a clear message.

### After each stage is working — before moving on
- Re-read the entire stage file top-to-bottom looking for: correctness, edge cases,
  resource leaks, unhandled rejections, missing `finally` blocks (browser/page cleanup).
- **Resume safety:** can the stage be interrupted mid-run and re-run without duplicating
  work or corrupting output? Every stage must skip already-completed leads.
- **Idempotency:** running the same stage twice on the same input produces the same output.
- **Security review:** no API keys in logs, filenames sanitized before writing to disk,
  no trust of external data, no silent data loss.

### Code quality rules
- No dead code: if something is commented out or unused, delete it.
- No duplicate logic: add shared functions to `utils.mjs`, never copy-paste across stages.
- Consistent error handling: try/catch with meaningful messages. Non-critical failures
  (image download, logo fetch) should log and continue — never abort the batch.
- After any significant change, grep for the old pattern to confirm it's fully replaced.

### Testing approach
- Small feature → test it immediately with `--dry-run` or `--lead <single-lead>`
- New stage complete → run against 3-5 real leads before running the full neighborhood
- Big milestone (e.g., all 10 stages built) → full end-to-end test on v2 data
- Before merge → full e2e pass on v2 data, all 10 stages, zero errors

---

## Design Principles
- Each stage reads its own input, writes its own output — no shared state between runs
- Neighborhood-configurable via `--neighborhood` CLI flag or `NEIGHBORHOOD_NAME` in .env
- All output goes to `output/` (gitignored)
- Always add `--dry-run` support to any stage that calls external paid APIs or sends emails
- Fail fast with clear error messages if input files don't exist
- Resume-safe: always check if output already exists before re-processing a lead

---

## Key Technologies
- **Claude API:** `claude-sonnet-4-6` (stage 6 mockdesign), `claude-haiku-4-5` (stage 8 email copy)
- **Puppeteer:** `headless: 'shell'` — valid Puppeteer v22+, uses chrome-headless-shell binary.
  Used in stages 3 and 4 only. DO NOT change to `headless: true` — different binary.
- **Playwright:** `headless: true` — used in stage 7 only (HTML→PNG/PDF rendering)
- **Cloudflare Pages:** Direct Upload API for stage 9. Free tier, commercial use allowed,
  unlimited direct upload deployments. URL: `https://{8hex}.{project}.pages.dev`
- **Outscraper:** Google Maps scraping + `domains_service=true` for email extraction
- **p-limit:** concurrency control. Never use raw `Promise.all` on large lists.

**DO NOT USE:**
- Resend for cold outreach (ToS explicitly prohibits it — account will be suspended)
- WhatsApp Business API for cold outreach (requires prior opt-in consent — policy violation)
- Vercel Hobby plan for this project (commercial use prohibited)

---

## Code Style
- ESM modules (`.mjs`), `dotenv/config` at top, no TypeScript
- Shared utilities in `pipeline/utils.mjs` — add new shared functions there, never duplicate
- Console output format: `[STAGE_NAME] message`, with final `═══` summary block
- Always validate input files exist before processing, `exit(1)` with helpful message if not

---

## Project Philosophy
Real business (mejoraweb.app). Data quality = conversion rate.
María de Molina = v1 proof of concept. All subsequent neighborhoods = production quality.
Always ask: "is this good enough to send to a real business owner?"

**Offer framing:** "más clientes desde Google — su web nueva en 7 días"
(More customers is the product. The website is the mechanism.)

**Pricing:** Anchor to €799, first-client discount to €299 ("precio de lanzamiento").
€299 alone is a credibility risk — Spanish freelancers charge €1,200-3,000+ for the same work.

---

## Cold Email Strategy
- **Sending domain:** NEVER use `mejoraweb.app` for cold email. Separate domain required.
  See `docs/2026-03-02-sending-domain-setup.md` for full setup steps.
  **Register the sending domain now** — 4-6 week warmup is the longest lead-time item.
- **Platform:** Instantly.ai or Smartlead (~$37/month). No API integration in v1 — CSV upload.
- **Sequence:** Day 0 plain text + preview link → Day 4 follow-up → Day 12 break-up
- **Email 1 must be:** plain text only, 150-200 words, no images, no PDF, no HTML
- **Realistic reply rate:** 2-5% total, 1-3% positive (Spanish SME, created-demand offer)
- **Legal (Spain B2B):** LSSI + GDPR legitimate interest applies to business email addresses
  (info@, contacto@, hola@). Must include company name, address, and unsubscribe in every email.

---

## Data Quality Stack (v2 — single Outscraper run)
ONE run per neighborhood. No second passes. Everything in one request:

Outscraper batch scrape WITH domains_service enrichment:
  → name, phone, website, category, rating, reviews, coords
  → full_address, street, borough, postal_code, city, state, country_code
  → emails scraped from business website via domains_service=true

Hunter.io: deferred — Outscraper domains_service covers Spanish SME generic emails
(contact@, info@, hola@) which is sufficient for v1 outreach. Add Hunter later if
email hit rate is below 40%.

---

## Address Fallback (apply everywhere downstream)
```js
const address = row.full_address || row.street ||
  [row.city, row.postal_code].filter(Boolean).join(', ') || '—';
```
Applied in: 4-content.mjs, 5-prompts.mjs.
Verify when building: 6-mockdesign.mjs (check), 9-deploy.mjs, 10-outreach.mjs.

---

## Scraper Rules
- NEVER run full scrape to test changes — always `--dry-run` first (3 results, 1 query)
- Full scrape = ~$9-15/neighborhood (with domains_service) — requires explicit user confirmation
- Dry-run is free, use it liberally to verify field coverage before committing to full run
- María de Molina v2 re-scrape: run AFTER all pipeline stages are complete and tested
- v1 data (current) is for development/testing only — do not use for real outreach

---

## Environment Variables
```
OUTSCRAPER_API_KEY=          # Stage 1 scraper
ANTHROPIC_API_KEY=           # Stage 6 (claude-sonnet-4-6) + Stage 8 (claude-haiku-4-5)
CLOUDFLARE_ACCOUNT_ID=       # Stage 9 deploy
CLOUDFLARE_API_TOKEN=        # Stage 9 deploy — needs Pages:Edit permission
CLOUDFLARE_PAGES_PROJECT=    # Stage 9 deploy — e.g. "mejoraweb-mockups"
FROM_EMAIL=                  # andres@mejoraweb.app (reference only — not used for cold email)
```

---

## Build Order (remaining — feature/email-outreach-pipeline)
```
✓ 1.  Fix scraper: domains_service, FIELDS, dry-run verified
✓ 2.  Fix address fallback in stages 4 and 5
✓ 3.  Build stage 6: mockdesign (Claude API → HTML)
✓ 4.  Build stage 7: htmltopng (Playwright → PNG + PDF)
✓ 5.  Build + delete stage 8-postcard (replaced)
  6.  Fix bugs: 4-content.mjs email merge + 2-auditor.mjs copyright regex   ← NEXT
  7.  Build stage 8: emailcontent (Claude Haiku → subject + body)
  8.  Build stage 9: deploy (Cloudflare Pages direct upload + cleanup)
  9.  Build stage 10: outreach (CSV export, --send gate)
  10. Update package.json scripts
  11. Re-scrape María de Molina v2 (dry-run first, then full ~$9-15)
  12. Full e2e test on v2 data → merge to main
```

---

## Branch
`feature/email-outreach-pipeline` → merge to `main` only after full end-to-end test.
Commit each stage separately. Never commit `.env` or `output/` files.

## Reference Docs
- `docs/2026-03-02-v1-v2-roadmap.md` — full roadmap, stage specs, V2 improvements
- `docs/2026-03-02-sending-domain-setup.md` — step-by-step sending domain setup
- `docs/2026-03-02-deep-research-and-factcheck.md` — code review, confirmed bugs, DO NOT DO list
- `docs/2026-03-02-architecture-research-and-plan.md` — architecture decisions and rationale
