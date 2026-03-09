# Stage 3 — `3-screenshot.mjs` Audit
**Date:** 2026-03-09
**Status:** Audit only — no changes made yet
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Stage 3 takes desktop and mobile screenshots of all Tier 1 leads and high-scoring Tier 2
leads (score ≥ 50) from the audited XLSX. Screenshots are used as visual reference for the
sales process and, in v2, as input to LLM-based design scoring.

**Inputs:**
- `output/leads_audited_{neighborhood}.xlsx` — from stage 2
  (read via `getTargetLeads()` in utils.mjs)

**Outputs:**
- `output/screenshots_{neighborhood}/{safeName}_mobile.png`
- `output/screenshots_{neighborhood}/{safeName}_desktop.png`
- `output/screenshots_{neighborhood}/manifest.json` — per-lead metadata
- `output/screenshots_{neighborhood}/errors.log` — per-run error log

**Key parameters:**
- `CONCURRENCY = 3` — simultaneous Puppeteer pages
- `TIMEOUT_MS = 20000` — 20s navigation timeout
- Lead filter: Tier 1 all + Tier 2 with score ≥ 50

---

## General Audit

### 1. Error Handling & Resilience

**What's working well:**
- Per-lead try/catch — one failure doesn't abort the batch.
- `finally` block closes the page even on error.
- Placeholder PNG created when navigation fails — downstream stages always find a file.
- `browser.close()` called after `Promise.all` resolves.

**Issues found:**

**[HIGH] `utils.mjs` still imports `xlsx` (HIGH CVE) — affects all stages.**
`getTargetLeads()` in `utils.mjs` uses `XLSX.readFile()` from the vulnerable `xlsx` library.
Stage 2 was migrated to `exceljs`, but `utils.mjs` was not. Since every downstream stage
(3, 4, 5, 6, 8, 9, 10) calls `getTargetLeads()`, the HIGH CVE is still present in the
entire pipeline. This must be fixed in `utils.mjs` to eliminate the vulnerability.

**[MEDIUM] `networkidle2` causes unnecessary timeouts and slowness.**
`networkidle2` waits until there are no more than 2 network requests for 500ms. Many SME
sites run analytics polling, chat widgets, or ad scripts that fire continuously — these
sites never reach `networkidle2` and will always hit the 20s timeout, even if the page
is visually complete after 2-3s. `domcontentloaded` with a short fixed wait is much more
reliable for screenshot purposes.

**[LOW] No retry on navigation failure.**
A single timeout or connection reset results in a placeholder image with no retry attempt.
One retry with a shorter timeout would catch the majority of transient failures.

**[LOW] `browser.close()` not guarded — uncaught error in `Promise.all` would skip it.**
If a task throws outside its try/catch (e.g., `browser.newPage()` fails), `Promise.all`
rejects and `browser.close()` is never called. Should be in a try/finally block.

---

### 2. Environment & Config Validation

**What's working well:**
- Input file existence checked with clear error + hint.
- No API keys required for this stage.

**Issues found:**

**[LOW] No `--lead` flag for testing a single lead.**
To test stage 3 changes you must run against all target leads. A `--lead <safeName>` flag
(same pattern as stages 6, 8, 9) would allow testing a single business without a full run.

**[LOW] No `--dry-run` flag.**
No paid API calls here, but a dry-run that opens and closes the browser without
navigating would confirm Puppeteer launches correctly in a new environment.

---

### 3. Data Integrity & Schema Validation

**Issues found:**

**[MEDIUM] Manifest is missing fields needed by future LLM design scoring.**
The manifest currently stores: `name`, `safeName`, `url`, `tier`, `score`, `mobilePath`,
`desktopPath`, `phone`, `category`, `full_address`, `pitch_angle`, `success`.

Fields absent from manifest that will be needed:
- `emails` — for v2 outreach correlation
- `description` — for LLM context in design scoring
- `working_hours` — for mockup personalization
- `google_id` — for admin dashboard linking
- `cms_detected` — useful context for LLM design scorer ("this is a Jimdo site")
- `missing_h1`, `missing_meta_desc` — audit signals to include in LLM prompt

These are all available in the audited XLSX. Including them in the manifest now costs
nothing and avoids a re-run when v2 LLM scoring is implemented.

**[LOW] No validation that `url` is non-empty before launching Puppeteer.**
If `final_url` and `website` are both empty/null, Puppeteer navigates to `undefined`
and produces a confusing error. Should skip the lead with a clear logged message.

---

### 4. Performance & Bottlenecks

**What's working well:**
- `pLimit(3)` — conservative concurrency, avoids memory spikes.
- Fonts and media blocked — meaningfully speeds up page loads.

**Issues found:**

**[MEDIUM] Two fixed 1000ms sleeps per lead, regardless of page state.**
After cookie dismissal: 500ms wait. After viewport change: 1000ms wait. After desktop
viewport set: 1000ms wait. That's 2500ms of guaranteed idle time per lead on top of
actual load time. For a 200-lead batch: ~8 minutes of pure sleeping. A
`waitForNetworkIdle` with a short timeout or `waitForSelector('body')` after viewport
change would be more accurate and faster.

**[LOW] Placeholder creation uses fixed 375×812 dimensions for both mobile AND desktop.**
`createPlaceholder` always creates a 375×812 image. The desktop placeholder should be
1440×900. When a human opens the folder to review leads, desktop placeholder looks
like a tiny mobile image.

---

### 5. Rate Limiting & Politeness

**What's working well:**
- CONCURRENCY=3 means only 3 sites accessed simultaneously. Since they're all different
  domains, no per-domain rate limiting is needed.
- No delay needed between different domains.

**No issues found.** Puppeteer's Chrome User-Agent is realistic.

---

### 6. Logging & Observability

**What's working well:**
- Per-lead success/failure console output with index.
- Error log file with timestamps.

**Issues found:**

**[MEDIUM] Error log cleared on every run (`writeFileSync(ERROR_LOG, '')`).**
Stages 1 and 2 use append-only logs. Stage 3 destroys previous errors on re-run.
If you re-run to fix a specific lead, the previous error history is lost.
Should use `appendFileSync` with a run-start separator, same pattern as other stages.

**[LOW] No timestamps in main console.log lines.**
Stage 2 prefixes every line with ISO timestamp via `log()`. Stage 3 uses bare
`console.log`. Makes it impossible to measure per-lead screenshot time.

**[LOW] Summary block uses `console.log` inconsistently — errors use `console.error`.**
`logError()` writes to `console.error`, but the `✗` lines in the main loop use
`console.log`. Both should go to the same stream for consistent log capture.

---

### 7. Idempotency

**Issues found:**

**[HIGH] No resume safety — re-running restarts from scratch.**
If interrupted mid-run (e.g., at lead 80 of 200), re-running re-screenshots leads 1–79
that already succeeded. Should check if `mobilePath` and `desktopPath` both exist before
navigating — skip and log "already done" if both present. This is the same resume pattern
used by stages 4, 6, 8, 9.

**[MEDIUM] Manifest is rebuilt from scratch on every run.**
If interrupted and re-run, the manifest only contains leads processed in the latest run,
losing entries from previous runs. Should load existing manifest at startup and merge
new results, similar to how the cache works in stage 2.

---

### 8. Output Contract

**What downstream stages consume:**

| Stage | What it reads from stage 3 |
|---|---|
| Stage 4 | Doesn't read stage 3 output directly — reads XLSX via `getTargetLeads()` |
| Stage 5 | References `{SCREENSHOTS_DIR}/{safeName}_mobile.png` and `_desktop.png` in the design brief text |
| Stage 6 | Doesn't read screenshots directly |
| Stage 7 | Reads HTML from stage 6, not screenshots |
| v2 LLM scoring | Will read screenshots for design quality assessment |

**Key finding:** Stage 5 references screenshot paths by constructing them from `safeName`.
It does not read the manifest. If the screenshot file doesn't exist (failed lead), stage 5
just includes a broken path in the brief — the placeholder image handles this gracefully.

**The manifest is currently only used internally within stage 3.** No downstream stage
reads it today. This makes it lower priority to fix, but it should be kept complete for
future use (admin dashboard, v2 LLM scoring).

---

### 9. Dependency Audit

**[HIGH] `utils.mjs` imports `xlsx` — HIGH severity CVE.**
`npm audit` confirms: `xlsx` has Prototype Pollution + ReDoS vulnerabilities with no
upstream fix. `utils.mjs` must be migrated to `exceljs` to complete the migration
started in stages 1 and 2.

**`puppeteer`** — no known critical CVEs at current version.
**`sharp`** — no known CVEs.
**`p-limit`** — no known CVEs.

**[INFO] `basic-ftp` critical CVE (transitive dependency from Playwright).**
Same as noted in stage 1 audit — zero practical risk, we use no FTP. Can be cleared
with `npm audit fix` if it becomes noise.

---

### 10. Dead Code & Unused Imports

**No dead code found.** All imports used. All functions called.

---

## Stage-Specific Audit

### 1 & 2. Full Page vs. Viewport — The Key Decision

**Current behaviour:** `fullPage: false` — captures only what fits in the configured
viewport (375×812 mobile, 1440×900 desktop). This is what a first-time visitor sees
above the fold.

**The problem:** The hero section is almost always the best-designed part of a site. A
restaurant built in 2012 on Jimdo often has a reasonable-looking hero image with the
business name and phone number. The problems — broken layout, table-based columns,
missing mobile navigation, 2003-era typography — appear when you scroll down. A
viewport-only screenshot would show only the hero and might score the site as
"adequate", missing the full picture.

**The user's stated purpose:** "this will be used for the LLM to review the current
style the website has, this helps a lot to customize a website. We are enhancing the
websites but not rebranding their companies."

For this purpose, full-page screenshots are significantly more informative. They reveal:
- The complete content structure (how many sections, what types)
- Navigation, hero, body, footer — the full design vocabulary
- Whether the site is 2 sections or 10 (depth of investment)
- Typography, color usage, and visual hierarchy across the full page

**The counter-argument:** Full-page screenshots of long pages can be huge. A blog
homepage might scroll to 8,000px. LLM vision APIs have image size limits. The file
could exceed what Claude's vision model can handle in a single call.

**Recommendation: Full page with height cap.**

Take `fullPage: true`, then use `sharp` to crop to a maximum height:
- Desktop: cap at **5,000px** (covers a typical SME homepage: hero + 3-4 sections + footer)
- Mobile: cap at **6,000px** (mobile sites are taller due to single-column layout)

This gives the LLM enough context to assess the full design without massive files.
A 1440×5000 PNG at default quality is ~2-4MB — within Claude vision limits after
resize. A 375×6000 mobile PNG is similar.

At these caps, nearly all SME homepages are captured in full. Only blogs and very long
landing pages are cropped — and for those, the first 5000px is still representative.

**Implementation:** After `page.screenshot({ fullPage: true })`, use `sharp` to read
the PNG, check height, and crop if above the cap. `sharp` is already imported.

---

## Summary Table

| # | Issue | Severity | Type |
|---|---|---|---|
| 1 | `utils.mjs` still uses `xlsx` HIGH CVE — affects all downstream stages | HIGH | Security |
| 2 | No resume safety — re-running re-screenshots already-completed leads | HIGH | Idempotency |
| 3 | `fullPage: false` — viewport only, misses most of the page design | HIGH | Coverage |
| 4 | `networkidle2` causes timeouts on sites with continuous background requests | MEDIUM | Reliability |
| 5 | Error log cleared on every run — previous errors lost | MEDIUM | Observability |
| 6 | Manifest rebuilt from scratch — incomplete after interrupted run | MEDIUM | Idempotency |
| 7 | Manifest missing fields needed for v2 LLM scoring (emails, description, cms_detected, etc.) | MEDIUM | Data integrity |
| 8 | Two fixed 1000ms sleeps per lead — ~8 min wasted on 200 leads | MEDIUM | Performance |
| 9 | `browser.close()` not in finally — can leak browser on uncaught error | LOW | Reliability |
| 10 | No retry on navigation failure — transient errors become permanent failures | LOW | Reliability |
| 11 | No `--lead` flag for single-lead testing | LOW | Usability |
| 12 | Desktop placeholder wrong size (375×812 instead of 1440×900) | LOW | Correctness |
| 13 | No timestamps in main log lines | LOW | Observability |
| 14 | No URL validation before launching Puppeteer | LOW | Reliability |
| 15 | `basic-ftp` critical CVE — transitive, zero practical risk | INFO | Security |
