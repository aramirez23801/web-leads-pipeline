# Stage 6 — `6-mockdesign.mjs` Audit
**Date:** 2026-03-10
**Status:** 🔍 In progress
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Stage 6 reads `design_prompt.md` per lead and sends it verbatim to Claude Sonnet to generate
a complete single-file HTML mockup. The output is what the business owner sees — it must be
good enough that they think "I want this for my business."

**Inputs:**
- `output/leads_audited_{neighborhood}.xlsx` — Tier 1 + Tier 2 via `getTargetLeads()`
- `output/content_{neighborhood}/{safeName}/design_prompt.md`
- `docs/design-prompt-guide.md` ← **doesn't exist yet — critical gap**

**Outputs:**
- `output/content_{neighborhood}/{safeName}/mockdesign.html`

---

## Technical Audit

### 1. Error Handling & Resilience

**[MEDIUM] `RateLimitError` waits 60s but doesn't retry the failed lead.**
After the 60s wait, the code increments `errors++` and moves to the next lead. The rate-limited
lead is silently lost. Correct behavior: retry the same lead once after the backoff. Pattern:
wrap the API call in a retry loop (max 2 attempts).

**[MEDIUM] Truncation detection incomplete — truncated HTML written to disk.**
The code warns when `outputTokens >= 24000` but still writes the file and increments `processed`.
The correct check is `message.stop_reason === 'max_tokens'` — this means the output was
cut off mid-generation. A truncated HTML file renders as a broken page in stage 7.
Fix: check `stop_reason`, throw if `'max_tokens'`, do not write the file.

**[LOW] No timeout on the streaming call.**
`client.messages.stream()` has no explicit timeout. If the API connection drops mid-stream,
`stream.finalMessage()` may never resolve. Low probability but worth wrapping with a timeout.

---

### 2. Environment & Config Validation

✅ `ANTHROPIC_API_KEY` checked at startup — good.
✅ `INPUT_FILE` existence checked — good.
✅ `--lead` mode validates `design_prompt.md` exists — good.

**[LOW] `MAX_TOKENS = 26000` — unexplained magic number.**
`claude-sonnet-4-6` supports up to 64K output tokens. 26K is correct and safe for a 600-900 line
HTML file (~15-20K tokens output), but deserves a comment explaining the reasoning.

---

### 3. Data Integrity & Schema Validation

**[HIGH] `### 4. Services / Specializations` heading missing from `design_prompt.md`.**
Bug introduced in the stage 5 UI/UX improvements when renumbering sections. The section
content (`- 3–6 service cards...`) is present but the `### 4.` heading line was dropped in
the edit. Without the heading, the LLM doesn't know this is a distinct page section — it reads
as dangling bullet points after the trust bar. Fix in `5-prompts.mjs`.

**[LOW] No minimum size check on `design_prompt.md`.**
A file smaller than 1KB indicates something went wrong upstream (empty content.json, scrape
error). Should warn and skip rather than sending a near-empty prompt to the API.

---

### 4. Performance

**[LOW] `leads.indexOf(lead)` is O(n) — used in sleep check.**
`leads.indexOf(lead) < leads.length - 1` traverses the array to find the current lead's
position. Replace with a loop index variable.

---

### 5. Rate Limiting & Politeness

`SLEEP_MS = 1200` is adequate for batch Sonnet calls.
**[MEDIUM] Rate limit retry** — see §1 above.

---

### 6. Logging & Observability

**[LOW] No log file.**
Stage 6 is the most expensive stage (API costs, long duration) but has no persistent log.
Stages 4, 5, 8, 9 all write `output/{name}_{neighborhood}.log`. Add log file here.

**[LOW] No timestamps on log lines.**
Inconsistent with stages 4, 5, 8, 9 which all use ISO timestamps via `log()` helper.

**[LOW] No accumulated cost total in summary block.**
Per-lead cost is logged but the summary only shows counts. Add `totalCost` accumulator
and print it in the summary: `Cost: $X.XXXX`.

---

### 7. Idempotency

✅ Checks `mockdesign.html` existence — skip if exists.
✅ `--lead` bypasses skip check for single-lead re-generation.
✅ Sleep skipped for last lead — correct.

---

### 8. Output Contract

✅ Validates `<!DOCTYPE` or `<html` prefix — good.
**[MEDIUM] Truncation** — see §3 above. A `stop_reason === 'max_tokens'` file should not
be written (or written with a `.truncated` flag) so stage 7 can detect and skip it.

Stage 7 expects `mockdesign.html` — format contract is correct.

---

### 9. Dependency Audit

**[HIGH] `xlsx` still in `package.json` — HIGH severity CVE (prototype pollution + ReDoS).**
All pipeline code was migrated to `exceljs` during stage 3 audit, but `xlsx` was never
removed from `package.json`. It's still installed and flagged by `npm audit`.
Fix: `npm uninstall xlsx`.

**[LOW/INFO] `basic-ftp < 5.2.0` — Critical CVE in transitive dep (puppeteer → basic-ftp).**
The vulnerability is in `downloadToDir()` which we never call. `npm audit fix` will update
`basic-ftp` to ≥5.2.0 via a non-breaking transitive update.

**[LOW] `pdf-lib`, `@pdf-lib/fontkit` — dead deps from deleted `8-postcard.mjs`.**
Already tracked in `pending-cross-stage.md`. Remove with `npm uninstall pdf-lib @pdf-lib/fontkit`.

---

### 10. Dead Code & Unused Imports

✅ `buildMockPrompt()` and `getCategoryColor()` removed in stage 5 work.
✅ `readContentJson()` removed.
✅ No dead imports.

---

## Stage-Specific Audit — Quality & UI/UX

### CRITICAL: `design-prompt-guide.md` doesn't exist

This is the defining gap of this audit. The LLM in stage 6 currently receives only
`design_prompt.md` — which has business data, high-level page structure, and some quality
rules, but **no concrete CSS patterns, no component implementations, no precise design
system tokens**.

The difference between a "looks okay" mockup and a "Stripe-quality" mockup is not the structure
description — it's the implementation patterns. An LLM that knows:

> "Use `translateY(-4px)` on card hover"

...produces a different result than one that has the exact CSS:
```css
.card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.08);
}
```

**What's missing from the current prompt (gaps relative to FRONTEND_GUIDELINES.md):**

| Missing | Impact |
|---|---|
| CSS design system tokens (spacing, shadows, transitions, radii) | LLM uses arbitrary values |
| Font loading pattern (preconnect + `font-display: swap`) | Fonts block render or FOUC |
| Section heading pattern (eyebrow + H2 + subtitle with CSS) | Generic, flat headings |
| Button component (exact CSS, two variants) | Inconsistent, often low-contrast CTAs |
| Service card component pattern | Cards look different each generation |
| Trust bar component pattern | Often omitted or poorly executed |
| Contact section two-column layout (info left, form right on desktop) | Form takes full width on desktop |
| Accessibility baseline (skip link, `:focus-visible`, `rel="noopener noreferrer"`) | Fails a11y baseline |
| Animation pattern (IntersectionObserver entrance) | Either missing or over-animated |

### Architecture: how `design-prompt-guide.md` integrates into stage 6

**Current flow:**
```
design_prompt.md (per-lead) → Claude Sonnet → mockdesign.html
```

**Target flow:**
```
design-prompt-guide.md (shared) + design_prompt.md (per-lead) → Claude Sonnet → mockdesign.html
```

Stage 6 reads both files and sends them as one combined message:
```
[design-prompt-guide.md contents]

---

[design_prompt.md contents]
```

**Why this architecture is correct:**
- If the guide is updated, `design_prompt.md` files don't need to be regenerated (stage 5 not re-run)
- The per-lead prompt stays focused on business-specific data
- The guide is version-controlled and maintainable independently
- LLM sees the universal quality rules first, then the specific brief — correct hierarchy

### What `design-prompt-guide.md` must contain (and must NOT contain)

`FRONTEND_GUIDELINES.md` is 919 lines written for human developers building multi-page sites
with build toolchains. For a single-file HTML LLM-generated mockup:

**INCLUDE:**
- CSS design system with exact property values (copy-paste ready)
- Font loading with `preconnect` + `font-display: swap`
- Section heading HTML/CSS pattern (eyebrow + H2 + subtitle)
- Button component CSS (primary + secondary)
- Card component CSS with hover
- Contact section two-column desktop layout
- Skip link + `:focus-visible` + `rel="noopener noreferrer"`
- Entrance animation pattern (IntersectionObserver)
- Never-do list (specific to single-file HTML mockup)

**DO NOT INCLUDE:**
- Section 0 (discovery questions — irrelevant, LLM has all data from design_prompt.md)
- Section 8 (performance — WebP, preload, Core Web Vitals — build-time concerns, not mockup)
- Section 14 (pre-launch checklist — for real delivery, not a proposal mockup)
- Section 12 (SEO — canonical tags, sitemaps, robots.txt — not relevant for single file)
- Anything assuming a multi-page site or build tool

**Target length:** 400–500 lines. Dense, concrete, implementation-ready.

---

## Summary Table

### Technical Issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | `RateLimitError` waits 60s but doesn't retry the failed lead | MEDIUM | ⬜ Pending |
| 2 | Truncation: `stop_reason === 'max_tokens'` not checked — writes broken HTML | MEDIUM | ⬜ Pending |
| 3 | `xlsx` still in `package.json` — HIGH CVE (never removed after migration) | HIGH | ⬜ Pending |
| 4 | `pdf-lib`, `@pdf-lib/fontkit` dead deps — tracked in pending-cross-stage.md | LOW | ⬜ Pending |
| 5 | `basic-ftp` transitive CVE — fixable with `npm audit fix` | LOW | ⬜ Pending |
| 6 | No log file — most expensive stage has no persistent log | LOW | ⬜ Pending |
| 7 | No timestamps on log lines — inconsistent with other stages | LOW | ⬜ Pending |
| 8 | No accumulated cost total in summary block | LOW | ⬜ Pending |
| 9 | `leads.indexOf(lead)` O(n) — replace with loop index | LOW | ⬜ Pending |
| 10 | No minimum size check on `design_prompt.md` | LOW | ⬜ Pending |
| 11 | MAX_TOKENS comment missing | LOW | ⬜ Pending |

### Quality / UI/UX Issues (stage-specific)

| # | Issue | Severity | Status |
|---|---|---|---|
| 12 | `design-prompt-guide.md` doesn't exist — shared UI/UX standards never injected | CRITICAL | ⬜ Pending |
| 13 | Stage 6 only reads `design_prompt.md` — no guide injection mechanism | CRITICAL | ⬜ Pending |
| 14 | `### 4. Services / Specializations` heading missing from `design_prompt.md` (stage 5 bug) | HIGH | ✅ Fixed in stage 5 (heading restored in buildDesignPrompt()) |
| 15 | No CSS design system tokens (spacing, shadows, transitions, radii) in prompt | HIGH | ⬜ Pending (in guide) |
| 16 | No font loading pattern (`preconnect` + `font-display: swap`) | MEDIUM | ⬜ Pending (in guide) |
| 17 | No section heading pattern (eyebrow + H2 + subtitle CSS) | MEDIUM | ⬜ Pending (in guide) |
| 18 | No button component (exact CSS, two variants) | MEDIUM | ⬜ Pending (in guide) |
| 19 | No contact section two-column layout spec | MEDIUM | ⬜ Pending (in guide) |
| 20 | No accessibility baseline (skip link, `:focus-visible`, `rel="noopener noreferrer"`) | MEDIUM | ⬜ Pending (in guide) |
| 21 | No card component CSS | MEDIUM | ⬜ Pending (in guide) |
| 22 | Trust bar component has no implementation pattern | LOW | ⬜ Pending (in guide) |
