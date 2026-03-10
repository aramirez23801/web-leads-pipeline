# Stage 5 — `5-prompts.mjs` Audit
**Date:** 2026-03-10
**Status:** ✅ Complete — all items resolved, end-to-end tested
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does (after redesign)

Stage 5 reads each Tier 1 + Tier 2 lead's `content.json` and assembles a complete,
rich `design_prompt.md` per lead. Stage 6 reads this file and sends it directly to
the Claude API — no prompt construction in stage 6.

**Before redesign:** Stage 5 wrote `brief.md` — a human-readable markdown brief that
stage 6 never read. Stage 6 built its own thin prompt from `content.json` using only
`sections[]` (max 8). All rich data added in stage 4 was ignored.

**After redesign:** Stage 5 is the prompt engineering stage. Everything the LLM needs
to produce a personalized, high-quality mockup is assembled here. Stage 6 focuses
only on API call + HTML validation.

**Inputs:**
- `output/leads_audited_{neighborhood}.xlsx` — Tier 1 + Tier 2 via `getTargetLeads()`
- `output/content_{neighborhood}/{safeName}/content.json`

**Outputs:**
- `output/content_{neighborhood}/{safeName}/design_prompt.md` — the exact prompt
  string that stage 6 will send to Claude Sonnet

---

## Critical Finding (pre-checklist)

**Stage 5 output (`brief.md`) was never read by stage 6 — completely orphaned.**

Stage 6 read `content.json` directly and built its own `buildMockPrompt()` internally,
using only:
- `content.sections[]` (max 8 headings/content)
- `content.name`, `content.category`, `content.phone`, `content.full_address`
- `content.pitch_angle`
- `content.logoUrl`
- `content.colors.bodyBg` (almost always white → fallback to category default)

Everything added in stage 4 — `bodyParagraphs`, `serviceLists`, `testimonials`,
`jsonLd`, `socialLinks`, `working_hours`, `metaKeywords`, `ogImage`, `partnerNames`,
`colors.buttonBg`, `colors.primaryVar`, `rating`, `reviews`, `description` — was
completely ignored by stage 6.

Additionally, `FRONTEND_GUIDELINES.md` was never injected into any prompt. It existed
but was completely unused at runtime.

**Resolution:** Stage 5 now writes `design_prompt.md`. Stage 6 reads that file directly.
Prompt construction logic removed from stage 6 entirely.

---

## Technical Audit

### 1. Error Handling & Resilience

**Issues found:**

**[LOW] No timestamps on log lines.**
→ **Fixed:** `log()` / `logError()` helpers with ISO timestamps.

**[LOW] No log file.**
→ **Fixed:** `output/content_{neighborhood}_prompts.log` written via `appendFileSync`.

**[LOW] `loadLeadMap()` silently returned empty Map on XLSX failure.**
→ **Fixed:** Now uses `getTargetLeads()` — same pattern as all other downstream stages.
XLSX is required; fails with a clear message if missing.

---

### 2. Environment & Config Validation

No env vars required (no API calls). Input/output path checks added.

**[LOW] No `--lead` flag for single-lead testing.**
→ **Fixed:** `--lead <safeName>` flag added, same pattern as stages 3, 4, 6, 8, 9.

---

### 3. Data Integrity & Schema Validation

**[HIGH] Still used `xlsx` package (HIGH CVE).**
→ **Fixed:** Migrated to `exceljs` via `getTargetLeads()`.

**[HIGH] Read from 'All Leads' worksheet — processed Tier 3 and Tier 4 SKIP leads.**
Downstream stages (6, 7, 8, 9) only process Tier 1 + Tier 2, so these briefs were
generated for leads that would never get a mockup.
→ **Fixed:** Now uses `getTargetLeads()` which reads 'Tier 1 Hot Leads' + 'Tier 2 Warm Leads'.

**[MEDIUM] `description`, `working_hours`, and all new stage 4 fields not used.**
→ **Fixed:** All content.json fields now consumed — see §8 Output Contract below.

---

### 4. Performance

Pure file I/O, no blocking operations. No concerns.

---

### 5. Rate Limiting

No external calls. N/A.

---

### 6. Logging & Observability

**[LOW] No timestamps. Non-standard console format.**
→ **Fixed:** ISO timestamps, `[PROMPTS]` prefix, standard `═══` summary block.

**[LOW] No log file.**
→ **Fixed:** Full log written to `output/content_{neighborhood}_prompts.log`.

---

### 7. Idempotency

**[LOW] No resume check — regenerated all briefs on every run.**
→ **Fixed:** Skips lead if `design_prompt.md` already exists. Same pattern as other
stages. `--lead` flag bypasses skip check (allows single-lead re-generation).

---

### 8. Output Contract

**Architectural change: `brief.md` → `design_prompt.md`**

Stage 5 now writes the complete, verbatim prompt string that stage 6 will send to
Claude. Stage 6's `buildMockPrompt()` function was deleted.

The `design_prompt.md` includes all of the following, assembled from content.json:

**Business identity block:**
- Name, category, address, phone, email (from `contactInfo.emails`)
- Google rating + review count → formatted as trust signal for hero
- `description` (Google Maps, when populated)
- `cms_detected` + `pitch_angle` → what problems to solve / context

**Content block (all from content.json):**
- `sections[]` — structured headings + content (up to 8, same as before)
- `bodyParagraphs[]` — prose about the business (up to 8)
- `serviceLists[][]` — structured service/product names
- `testimonials[]` — customer quotes (when captured)
- `partnerNames[]` — notable clients/partners
- `jsonLd[]` — structured data (LocalBusiness schema, opening hours)
- `socialLinks` — Facebook/Instagram/LinkedIn for footer
- `metaKeywords` — SEO signals the business uses for itself

**Design decisions block:**
- Primary color with corrected priority:
  1. `colors.buttonBg` (actual brand color, e.g. Telelectric's teal)
  2. `colors.primaryVar` (CSS custom property)
  3. `getCategoryColor()` fallback by business category
  (Old code checked `bodyBg` first — almost always white, always fell through)
- `working_hours` parsed and formatted into human-readable schedule
  (e.g. "Lun–Vie: 7:00–15:00 | Sáb–Dom: Cerrado")
- Logo: `./logo.png` if available, else styled text
- Font pairing recommendation from category (from FRONTEND_GUIDELINES.md §3.2)
- Industry-specific section requirements (from FRONTEND_GUIDELINES.md §10)

**Design constraints block:**
- Key rules from FRONTEND_GUIDELINES.md: 8pt grid, color architecture, hero
  structure, button copy, CTA rules, typography minimums
- What to avoid (dark backgrounds, emoji icons, fake stat counters, etc.)
- Quality bar: "think Stripe or a well-designed local business site"

**Output spec:**
- Single HTML file, embedded CSS + minimal JS, no external deps except Google Fonts
- Spanish throughout
- 600–900 lines — complete is more important than elaborate
- Start response with `<!DOCTYPE html>`, no markdown fences

**Pending for stage 6 audit:**
- `design-prompt-guide.md` — a condensed, LLM-optimized derivative of
  `FRONTEND_GUIDELINES.md` specifically for prompt injection. Currently the relevant
  sections are inlined directly. This file will be extracted and maintained separately
  during the stage 6 audit.
  _Origin: stage 5 audit §8 — tracked in pending-cross-stage.md_

---

### 9. Dependency Audit

**[HIGH] `xlsx` → `exceljs`.**
→ **Fixed.** `import XLSX from 'xlsx'` removed. `getTargetLeads()` from utils.mjs used.

No other dependencies added (no new packages).

---

### 10. Dead Code & Unused Imports

**[MEDIUM] `brief.md`, `BRIEFS_DIR`, `copyFileSync` — entire brief system removed.**
The central `output/briefs_{neighborhood}/` folder and per-lead `brief.md` are
eliminated. The `design_prompt.md` per lead is the new output artifact.

**[LOW] `detectKeepItems()` — removed.**
Generated "keep" suggestions (booking, WhatsApp, etc.) that never reached stage 6.
Integrations are detected from `socialLinks` in the new prompt.

**[LOW] `listIssues()` / `ISSUE_LABELS` — removed.**
`pitch_angle` from content.json already summarizes the issues in natural language.
Redundant translation layer eliminated.

**[LOW] `SCREENSHOTS_DIR` — removed.**
Was only used to print screenshot paths in the brief that nobody read.

---

## Stage-Specific Notes

### Color priority fix

Old `getCategoryColor()` in stage 6 (now moved/corrected in stage 5):
```js
// WRONG: checks bodyBg first — almost always white → always falls through
const bg = colors?.bodyBg || ''
if (isUsableColor(bg)) return bg
```

New priority:
```js
// RIGHT: buttonBg is where modern sites store their actual CTA color
if (isUsableColor(colors?.buttonBg)) return colors.buttonBg
if (isUsableColor(colors?.primaryVar)) return colors.primaryVar
if (isUsableColor(colors?.headerBg)) return colors.headerBg
// ... then category defaults
```

### Working hours formatting

`working_hours` arrives as a JSON string from Outscraper:
```json
{"lunes":["7:00-15:00"],"martes":["7:00-15:00"],...,"sábado":["Cerrado"]}
```

Stage 5 groups consecutive days with the same hours and formats as:
`"Lun–Vie: 7:00–15:00 | Sáb–Dom: Cerrado"`

Stage 6 never had this — the footer showed no hours. Now it can.

### FRONTEND_GUIDELINES.md injection

The most relevant sections for prompt use are injected inline:
- §2.3 Industry Color Psychology
- §3.2 Font Pairings by Industry
- §6.4 Hero Section structure (mandatory elements)
- §10 Industry-Specific Rules (for the business's category)
- §11.1 CTA Rules
- §15 Common Mistakes

The full 900-line file is NOT injected (token cost, irrelevant sections for a
single-file mockup). A `design-prompt-guide.md` condensed version will be extracted
during the stage 6 audit.

---

## Summary Table

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | `brief.md` output never read by stage 6 — stage 5 was an orphan | CRITICAL | ✅ Fixed (Option B: writes `design_prompt.md`) |
| 2 | Stage 6 `buildMockPrompt()` ignored most of content.json | HIGH | ✅ Fixed (logic moved to stage 5, all fields used) |
| 3 | `getCategoryColor()` checked `bodyBg` first (always white) — real brand colors ignored | HIGH | ✅ Fixed (buttonBg → primaryVar → category default) |
| 4 | `FRONTEND_GUIDELINES.md` never injected into any prompt | HIGH | ✅ Fixed (relevant sections inlined in prompt) |
| 5 | `xlsx` HIGH CVE | HIGH | ✅ Fixed (migrated to exceljs via getTargetLeads) |
| 6 | Read 'All Leads' worksheet — processed Tier 3/4 leads | MEDIUM | ✅ Fixed (getTargetLeads() — Tier 1 + Tier 2 only) |
| 7 | `description`, `working_hours`, all new stage 4 fields unused | MEDIUM | ✅ Fixed (all fields in design_prompt.md) |
| 8 | No resume check | LOW | ✅ Fixed (skip if design_prompt.md exists) |
| 9 | No `--lead` flag | LOW | ✅ Fixed |
| 10 | No timestamps, no log file | LOW | ✅ Fixed |
| 11 | `detectKeepItems()`, `listIssues()`, `SCREENSHOTS_DIR` dead code | LOW | ✅ Removed |
| 12 | Font weights missing from typography — LLM loaded arbitrary weights | LOW | ✅ Fixed (headingWeights + bodyWeights added to getFontPairing()) |
| 13 | Hero visual direction vague ("CSS geometric pattern") — no category guidance | LOW | ✅ Fixed (getHeroVisual() per category: trades, medical, legal, etc.) |
| 14 | Trust bar missing — no section between hero and services for 3–4 key facts | LOW | ✅ Fixed (Section 3: trust bar with rating, hours, certifications from content) |
| 15 | `design-prompt-guide.md` — condensed LLM-optimized guidelines | MEDIUM | ⏳ Deferred to stage 6 audit |
