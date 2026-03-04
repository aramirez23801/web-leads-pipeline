# Deep Research + Fact-Check Report
**Date:** 2026-03-02
**Status:** Research complete — awaiting user decisions before code changes

---

## CRITICAL CORRECTIONS (fact-checker found errors in original research)

### 1. `headless: 'shell'` — DO NOT CHANGE IT
The original research said this was deprecated and should be changed to `headless: true`. **This is wrong.**
`headless: 'shell'` is valid and intentional in Puppeteer v22+. It uses the lighter `chrome-headless-shell` binary. Stages 3 and 4 correctly use Puppeteer with `headless: 'shell'`. Stages 7 and 8 correctly use Playwright with `headless: true`. These are different libraries with different APIs. Do not change stages 3 and 4.

### 2. WhatsApp Business API for cold outreach — DO NOT DO THIS
The original research recommended WhatsApp as "dramatically underused for cold outreach." **This is actively harmful advice.**
WhatsApp's Business Policy explicitly requires opt-in consent before initiating any message. Sending cold outreach via WhatsApp Business API violates their policy, risks permanent account ban, and may violate GDPR/LOPD. Rejected.

### 3. Spanish freelancer web design pricing — MUCH HIGHER THAN STATED
The original research said €200-800. **Fact-checked: the real market rate is €1,200-3,000+ for an SME website project.** This significantly changes the pricing analysis — €299 is not "below freelancers," it is 4-10x below market rate, which is a serious credibility risk with prospects.

### 4. Outscraper domains_service cost — HIGHER THAN STATED
Original estimate: $0.001-$0.002/record. **Fact-checked: actual combined cost is ~$0.006/lead** ($0.003 scraping + $0.003 email extraction). The current CLAUDE.md estimate of $3.63/neighborhood predates domains_service and is now ~$9-15/neighborhood. Update cost estimates.

### 5. Cold email reply rate expectations — LOWER FOR THIS ICP
Original: 5-10% reply rate. **Fact-checked: for a "created demand" offer to Spanish SMEs who didn't ask for a website, realistic target is 2-5% reply rate, 1-3% positive interest.** The 5-10% figure applies to tight B2B ICPs where the prospect has a known, active pain point. Web redesign is a created-demand product.

---

## CONFIRMED BUGS IN CURRENT CODE

### HIGH PRIORITY
**`4-content.mjs` line 162 — `Object.assign` overwrites Outscraper emails:**
```js
// BUG: this overwrites contactInfo.emails from Outscraper with scraped emails
Object.assign(contentData, extracted);
// FIX (before v2 re-scrape):
const mergedEmails = [
  ...(contentData.contactInfo.emails || []),
  ...(extracted.contactInfo?.emails || []),
].filter(Boolean);
const { contactInfo: _, ...rest } = extracted;
Object.assign(contentData, rest);
contentData.contactInfo.emails = [...new Set(mergedEmails)];
```

### MEDIUM PRIORITY
**`2-auditor.mjs` line 171 — copyright range pattern matches any year range (false positives):**
```js
// BUG: copyright prefix is optional (?) — will match any year range in page body
const rangePattern = /(?:©|&copy;|copyright)?\s*(?:19|20)\d{2}\s*[-–—]\s*((?:19|20)\d{2})/gi;
// FIX: remove ? to require copyright symbol, or restrict to footerText only
const rangePattern = /(?:©|&copy;|copyright)\s*(?:19|20)\d{2}\s*[-–—]\s*((?:19|20)\d{2})/gi;
```

### LOW PRIORITY
**`4-content.mjs` — no resume check:** If the stage crashes mid-run, it starts from scratch.
```js
// Add at the top of each lead task (before browser launch):
if (existsSync(join(leadDir, 'content.json'))) {
  completed++;
  console.log(`[${completed}/${leads.length}] SKIP ${name} — content.json exists`);
  return;
}
```

---

## CODE QUALITY ASSESSMENT — CONFIRMED GOOD

| Stage | Assessment |
|---|---|
| `utils.mjs` | Solid. sanitizeName keeps accented chars correctly. findLogo CDN filter is correct. getTargetLeads dedup by URL is correct. |
| `1-scraper.mjs` | Good. Budget hard-stop, retry logic, dedup Map — all correct. The `async: false` with 202 fallback is a valid hybrid. |
| `2-auditor.mjs` | Good. pLimit(5) is appropriately conservative. Cache chain prevents corruption. One confirmed bug (rangePattern) is minor. |
| `3-screenshot.mjs` | Good. headless: 'shell' is correct for Puppeteer. Cookie dismissal is a reasonable best-effort. |
| `4-content.mjs` | Good overall. Object.assign bug is the main issue. No resume check is a minor gap. |
| `5-prompts.mjs` | Solid. Dual-use (human review + design context) is fine. |
| `6-mockdesign.mjs` | Solid. Output validation check is good. 1200ms sleep is correct at 50 RPM limit. |
| `7-htmltopng.mjs` | Solid. Animation forcing is correct for the .reveal pattern. |
| `8-postcard.mjs` | Good. JSON stripping approach is correct. Haiku system prompt quality is good. |

---

## SCORING MODEL — IMPROVEMENT RECOMMENDATIONS

Current model has correct signals but suboptimal weights:

| Signal | Current | Recommended |
|---|---|---|
| missing_viewport | +40 | +35 |
| no_ssl | +25 | +30 |
| dns_fail | +50 | +50 (keep) |
| timeout | +35 | +35 (keep) |
| outdated_copyright | +15 | +10 |
| has_dead_tags | +10 | +10 (keep) |
| heavy_page | +10 | +5 (weak proxy) |

**New signals worth adding (medium priority):**
- No `tel:` link on mobile — direct revenue loss signal for SME (restaurants, dentists)
- No `<form>` element — no contact form = losing leads
- Core Web Vitals via PageSpeed API — most credible signal for non-technical owners

**Review multiplier improvement:**
```js
// Current (too conservative):
const multiplier = reviews >= 50 ? 1.2 : reviews >= 10 ? 1.1 : 1.0;
// Recommended:
const multiplier = reviews >= 100 ? 1.35 : reviews >= 30 ? 1.25 : reviews >= 10 ? 1.15 : 1.0;
```

---

## PIPELINE PERFORMANCE (corrected estimates)

| Stage | Wall time (30 leads) | API Cost (30 leads) |
|---|---|---|
| Stage 1 (scraper) | ~5 min/neighborhood | ~$9-15 (with domains_service) |
| Stage 2 (auditor) | ~15-20 min | $0 |
| Stage 3 (screenshot) | ~5-8 min | $0 |
| Stage 4 (content) | ~5-8 min | $0 |
| Stage 5 (prompts) | < 1 min | $0 |
| Stage 6 (mockdesign) | ~15-25 min (serial) → ~6-9 min (pLimit(3)) | ~$3-4.50 |
| Stage 7 (htmltopng) | ~2-4 min | $0 |
| Stage 8 (postcard) | ~1-2 min | ~$0.03 |
| **Total** | **~50-70 min** | **~$12-20/neighborhood** |

---

## INDUSTRY COMPARISON — KEY FINDINGS

### Lead sources (current: Google Maps + Outscraper)
**Verdict: Correct source for this ICP.** No better alternative for Spanish local SMEs at this price point. Missing: Registro Mercantil (BORME) for newly registered businesses — zero cost, zero-scraping lead source that competitors are not using.

### Audit scoring
**Verdict: Calibrated for sales pitch, not SEO completeness — this is correct.** The pitch angle ("your website is broken/ugly/not mobile-friendly") maps correctly to the detected signals. Don't over-engineer toward SEO tool territory.

### Personalization
**Verdict: Full HTML mockup per lead IS a genuine differentiator.** Nobody at this price point does this. The conversion premium for visual personalization (seeing their own site redesigned) is real. The unique-URL-per-lead tracking (Cloudflare Pages) is the next capability to add.

### Cold email
**Correct approach:**
- Email 1: Plain text only, 3-4 sentences, preview link. NO PDF. Subject: 2-5 words, personalized.
- Email 2 (Day 3-4): Follow-up, still plain text, can add PDF link.
- Email 3 (Day 10-12): Breakup email. Short. Often highest reply rate.
- Best days: Tuesday/Thursday (general best practice, no Spain-specific data exists)
- Realistic reply rate: 2-5% total, 1-3% positive interest (Spanish SME, created-demand offer)

### Pricing
**€299 is 4-10x below Spanish web design market rates (€1,200-3,000+ for freelancers).** This creates a credibility risk. Options:
1. Keep €299 as "precio de lanzamiento" with explicit time limit and move up after first 5 clients
2. Anchor to €799 with "first client discount to €299"
3. Reframe: free mockup, paid implementation starting €299

---

## ARCHITECTURE RECOMMENDATIONS

### Python migration
**When:** After v1 is complete and at least 3 neighborhoods have run end-to-end.
**Order:** Migrate stage by stage, starting with the simplest (stage 5 prompts). Keep Node.js stages running until Python equivalent is tested.
**Best Python equivalents:**
- `xlsx` → `openpyxl` (more verbose but complete)
- `pLimit` → `asyncio.Semaphore` (native, elegant)
- `puppeteer` → `playwright.async_api` (first-class Python support)
- `cheerio` → `BeautifulSoup4 + lxml` (faster and more ergonomic)
- `@anthropic-ai/sdk` → `anthropic` (feature-parity official SDK)

### Stage 6 parallelization (medium priority)
Change serial loop to `pLimit(3)`. At 1,200ms sleep per call and 3 concurrent, effective rate is ~2.5 RPM × 3 = 7.5 RPM (well under 50 RPM limit). Wall time drops from ~25 min to ~9 min for 30 leads.

### Pipeline manifest (low priority)
Add a `pipeline/manifest.json` recording which stage last ran, when, and for which neighborhood. Detects orphaned stage runs.

---

## BUSINESS VALIDATION

### The product is real and the market need is real.
Madrid has thousands of SMEs with broken or outdated websites. The pipeline is technically sound for identifying them. The main gaps are:
1. **Credibility at €299** (solvable with proof/portfolio after first 5 clients)
2. **Email infrastructure** (need separate outreach domain + Instantly.ai/Smartlead)
3. **Email extraction quality** (depends on v2 domains_service data — first data will tell)

### Reframe the offer
From: "rediseño web por €299"
To: "más clientes desde Google — su web nueva en 7 días"
The website is the mechanism; more customers is the product.

### Primary objections (ranked by frequency)
1. "Ya tenemos web" — answer: show them the PDF postcard (before vs. after)
2. "Tenemos un sobrino que lleva la web" — reframe: "le arreglamos lo que está roto ahora mismo"
3. "€299 parece muy barato" — answer: "precio de lanzamiento, la web tendrá X valor real"
4. "¿Quién son ustedes?" — solved only with portfolio after first 5 clients

---

## OPEN DECISIONS FOR USER

1. **Pricing strategy:** Keep €299 as-is, anchor to higher, or "free mockup → paid implementation"?
2. **Stage 4 logo upgrade timing:** Before v2 scrape or after?
3. **Python migration start:** After v1 complete (recommended) or start now with first stages?
4. **Cloudflare Pages vs Vercel Pro:** Confirmed Cloudflare is recommended (better limits, free)
5. **Cold outreach infrastructure:** Instantly.ai or Smartlead? Separate domain ready?
6. **New stages naming:** 8-emailcontent.py, 9-deploy.py, 10-outreach.py — confirmed?
