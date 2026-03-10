# Stage 7 — `7-htmltopng.mjs` Audit
**Date:** 2026-03-11
**Status:** ✅ Complete — all items resolved, end-to-end tested
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Renders each lead's `mockdesign.html` via Playwright (Chromium) and outputs screenshots.
Currently produces 3 files per lead: `mockdesign_full.png`, `mockdesign_preview.png`,
`mockdesign.pdf`. **PDF dropped per user decision** — only the 2 PNGs are needed downstream.

**Inputs:**
- `output/leads_audited_{neighborhood}.xlsx` — Tier 1 + Tier 2 via `getTargetLeads()`
- `output/content_{neighborhood}/{safeName}/mockdesign.html` — stage 6 output

**Outputs:**
- `output/content_{neighborhood}/{safeName}/mockdesign_full.png` — full-page screenshot
- `output/content_{neighborhood}/{safeName}/mockdesign_preview.png` — above-the-fold (1440×900)

---

## Technical Audit

### 1. Error Handling & Resilience

**[MEDIUM] Browser not closed on fatal error.**
`browser.close()` at line 181 is only reached if the loop completes normally. If
`chromium.launch()` succeeds but something throws before or during the loop, the browser
process leaks. `page.close()` in `finally` is correct — but the outer `browser.close()`
needs its own `try/finally` wrapper to guarantee cleanup.

**[LOW] No retry on transient render errors.**
Page errors log and move on — correct for local file rendering. Re-runs will catch skipped
leads once the skip check is fixed (see §3).

---

### 2. Environment & Config Validation

✅ `INPUT_FILE` existence checked at startup — good.
✅ `--lead` mode validates `mockdesign.html` exists — good.
✅ No env vars required — Playwright uses bundled Chromium. Nothing to validate.

---

### 3. Data Integrity & Schema Validation

**[MEDIUM] Skip check includes `pdfPath` — breaks after PDF removal.**
`existsSync(fullPath) && existsSync(previewPath) && existsSync(pdfPath)` — once PDF is
dropped, no existing lead will ever have `mockdesign.pdf`, so every lead gets re-rendered
on every run. Fix: check only `fullPath` and `previewPath`.

**[LOW] No minimum file size check on output PNGs.**
A PNG smaller than ~50KB indicates a render failure (blank/crashed page). Should warn and
skip writing rather than silently saving a broken file.

---

### 4. Performance

✅ `SETTLE_MS = 800` + `waitForTimeout(300)` = 1.1s per lead — intentional, appropriate for
font loading and animation settle.
✅ Single browser, sequential processing — correct. Playwright parallelism would risk memory
pressure on 200–400 leads.

---

### 5. Rate Limiting & Politeness

N/A — all local file rendering, no external requests.

---

### 6. Logging & Observability

**[LOW] No log file.**
All other post-stage-4 stages write a persistent log. Stage 7 only logs to stdout.

**[LOW] No timestamps on log lines.**
Inconsistent with stages 4, 5, 6, 8, 9 which all use ISO timestamps via a `log()` helper.

**[LOW] Errors not written to log file.**
Lead errors go to stderr but are never persisted.

---

### 7. Idempotency

**[MEDIUM] Skip check broken after PDF removal** — see §3.
✅ `page.close()` in `finally` — correct, no leaked pages.
✅ Browser launched once, closed once — correct.

---

### 8. Output Contract

**[HIGH] PDF removal — output contract change.**
`mockdesign.pdf` dropped. No downstream stage consumes it (stage 9 deploys only
`mockdesign.html` + `mockdesign_preview.png`). Safe to remove.

✅ `mockdesign_full.png` — full-page, kept.
✅ `mockdesign_preview.png` — viewport-only (1440×900, above-the-fold crop), kept.
   Correct for a "preview" thumbnail shown to business owners and linked from emails.

---

### 9. Dependency Audit

✅ `playwright` — local rendering only, no network calls, no CVEs from this package
   relevant to this usage.
✅ No env vars, no API keys, no external services.
ℹ️  `import 'dotenv/config'` intentionally omitted — no env vars needed. Fine.

---

### 10. Dead Code & Unused Imports

**[MEDIUM] All PDF-related code is dead after removal:**
- `pdfPath` variable
- `page.pdf({...})` call
- `pdfKB` variable
- `pdf: ${pdfKB}KB` in log line
- `pdf: ${resolve(pdfPath)}` in `--lead` output
- `pdfPath` in skip check
- Header comment lines referencing `mockdesign.pdf`

---

## Summary Table

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Browser not closed on fatal error — no outer try/finally | MEDIUM | ✅ Fixed (browser/context close wrapped in try/finally) |
| 2 | Skip check includes `pdfPath` — breaks idempotency after PDF removal | MEDIUM | ✅ Fixed (checks fullPath + previewPath only) |
| 3 | All PDF code becomes dead — pdfPath, page.pdf(), pdfKB, comments | MEDIUM | ✅ Fixed (all PDF references removed) |
| 4 | No log file — inconsistent with stages 4–6, 8, 9 | LOW | ✅ Fixed (output/htmltopng_{neighborhood}.log) |
| 5 | No timestamps on log lines | LOW | ✅ Fixed (log() / logError() helpers with ISO timestamps) |
| 6 | No minimum size check on output PNGs | LOW | ✅ Fixed (throws if PNG < 50KB — blank render guard) |
| 7 | IntersectionObserver-gated elements blank in screenshot — wrong selector `.reveal` | BUG | ✅ Fixed (targets `[data-animate], .reveal, .fade-in`) |
| 8 | Low resolution output — default deviceScaleFactor: 1 | QUALITY | ✅ Fixed (browser context with deviceScaleFactor: 2) |

## Test Results

```
node pipeline/7-htmltopng.mjs --neighborhood maria_de_molina --lead telelectric-electricistas_24horas
```

- Full PNG: 1440×3311px, 881.5KB (2× resolution, all sections visible) ✅
- Preview PNG: 1440×900px, 246.0KB ✅
- Duration: 3s ✅
- Second run: SKIP (idempotency confirmed) ✅
- Log file written: output/htmltopng_maria_de_molina.log ✅
