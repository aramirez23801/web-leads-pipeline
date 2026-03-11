# Pending Cross-Stage TODOs

**Last updated:** 2026-03-11 (stage 7 audit complete)
**Purpose:** Items identified during stage audits that must be fixed in a different stage.
Review this file at the start of each stage audit.

---

## Stage 2 — `2-auditor.mjs`

✅ Stage 2 audit complete. All items resolved.

- [x] **Migrate from `xlsx` to `exceljs`** — done (Phase 1)
- [x] **Use `photos_count` in opportunity scoring** — decision: passed through as column, not scored.
      `photos_count` is a GMB activity signal but not a reliable proxy for website quality.
      Downstream stages and admin dashboard can use it for filtering.
- [x] **Use `verified` in opportunity scoring** — decision: passed through as column, not scored.
      Verified = owner is reachable, but doesn't correlate with website quality. Available in output.

---

## Stage 3 — `3-screenshot.mjs`

✅ Stage 3 audit complete. All items resolved.

- [x] **`getTargetLeads()` score filter removed** — previously filtered Tier 2 leads with
      score < 50, creating a confusing "Tier 2 but excluded" gap. Now includes all Tier 1 +
      all Tier 2 leads. Tier assignment in stage 2 is the single decision boundary for
      downstream stages.

---

## Stage 4 — `4-content.mjs`

✅ Stage 4 audit complete. All items resolved.

- [x] **Parse `emails` as JSON array, not comma-split** — fixed, uses `JSON.parse()`.

---

## Stage 5 — `5-prompts.mjs`

✅ Stage 5 audit complete. All items resolved.

- [x] **Use `description` (Google Maps) in design prompt** — included in `design_prompt.txt`.
- [x] **Use `working_hours` in design prompt** — parsed + formatted as human-readable schedule.
- [x] **Migrate from `xlsx` to `exceljs`** — done, uses `getTargetLeads()`.
- [x] **Output changed from `brief.md` to `design_prompt.txt`** — stage 6 reads this directly.
      All content.json fields now consumed: `bodyParagraphs`, `serviceLists`, `testimonials`,
      `jsonLd`, `socialLinks`, `metaKeywords`, `rating`/`reviews`, `buttonBg`, `primaryVar`, etc.
- [x] **FRONTEND_GUIDELINES.md** — relevant sections inlined in prompt (industry rules,
      color psychology, font pairings, hero structure, CTA rules, common mistakes).

---

## Stage 6 — `6-mockdesign.mjs`

✅ Stage 6 audit complete. All items resolved.

- [x] **Remove `buildMockPrompt()`** — done (stage 5 audit)
- [x] **Create `docs/design-prompt-guide.md`** — done. 522-line UI/UX principles guide.
      Stage 6 reads it at startup and prepends it to every per-lead prompt.
      _Origin: stage 5 audit §8 — resolved in stage 6 audit_

---

## Stage 8 — `8-emailcontent.mjs`

- [x] **Use `description` (Google Maps) in email copy**
      Added to `buildProblemPrompt()` in stage 8 audit. When present, Google Maps description
      is passed as additional context to Haiku for more specific `problema` sentences.
      _Origin: stage 1 audit, issue #8 — resolved stage 8 audit_

- [ ] **Automated unsubscribe (Option C) — implement when admin dashboard backend is ready**
      Current v1: reply-based footer ("Para darte de baja, responde con 'No gracias'").
      Target v2 architecture:
      1. Add React Router + `<UnsubscribePage />` to mejoraweb.app (reads `?email=` + `?token=` params)
      2. Add Azure Function at `/api/unsubscribe` — validates HMAC token, calls Resend suppression API
      3. Stage 10: add `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers
         when sending via Resend API. Replace footer opt-out text with `mejoraweb.app/unsubscribe?...`
      4. Admin dashboard: show suppression list, allow manual management.
      No changes to stage 8 templates needed at that point — only stage 10 + mejoraweb.app.
      _Origin: stage 8 audit — deferred pending backend_

---

## All Stages — Output Folder Restructure

- [ ] **Restructure `output/` directory — implement after all audits complete**
      Currently, re-running any stage overwrites its output with no backup. Agreed to
      restructure as follows before building the admin dashboard:

  ```
  output/
    {neighborhood}/
      scrapes/
        {YYYY-MM-DD_HHmmss}/    ← each scrape preserved, never overwritten
          businesses.xlsx        ← stage 1
          leads_audited.xlsx     ← stage 2
          crawl_cache.json       ← stage 2
          scraper.log
      leads/
        {business_name}/         ← per-lead data (stages 3–9), shared across scrapes
          content.json
          email.json
          mockdesign.html
          screenshot_desktop.png
          screenshot_mobile.png
          preview.png
          mockdesign.pdf
          ...
      latest.json                ← pointer to most recent scrape folder
  ```

  This affects every stage's file paths. Implement as a single coordinated migration,
  not piecemeal per stage.
  _Origin: stage 1 audit, idempotency section + user decision_

---

## Package-level (not stage-specific)

- [x] **Remove dead dependencies: `pdf-lib`, `@pdf-lib/fontkit`**
      Removed during stage 6 audit (`npm uninstall`). Also removed `xlsx` (HIGH CVE,
      migrated to exceljs in stage 3 but never uninstalled). `npm audit` now reports
      0 vulnerabilities.
      _Origin: stage 1 audit, dependency section_

- [ ] **Investigate Outscraper pagination API**
      Stage 1 is currently capped at 500 results per category query. For dense neighborhoods
      and popular categories (restaurantes, clínicas), results above 500 are silently dropped.
      Verify the correct pagination parameter against Outscraper API docs (`skip`, `cursor`,
      or other), then implement in stage 1 if needed.
      _Origin: stage 1 audit, performance section_

- [x] **Migrate remaining stages from `xlsx` to `exceljs`**
      Done. `utils.mjs` migrated during stage 3 audit — `getTargetLeads()` now uses exceljs
      (async). All 7 callers in stages 3–9 updated with `await`. `xlsx` CVE fully eliminated.
      _Origin: stage 1 audit, dependency section_

---

## V2 — After First Campaign

- [ ] **LLM visual design scoring (stage 2.5 or enrichment step)**
      The current scoring catches technical failures but misses visually outdated sites that
      pass all HTML checks (viewport present, SSL, recent copyright, <30 images → score 0,
      Tier 4 SKIP). A site built in 2018 on a free WordPress theme with no CTAs and 6-second
      load time would be skipped today.

  **Approach (agreed):** After first María de Molina campaign, if we confirm "technically
  fine but visually 2010" sites are real missed opportunities, implement a stage 2.5:
  - Run stage 3 screenshots on Tier 1–3 leads (not all domains)
  - Then run Haiku on each screenshot: `{"design_score": 1-5, "design_weakness": "..."}`
  - Re-score: design_score 1 → +25pts, design_score 2 → +15pts
  - Update `leads_audited_{neighborhood}.xlsx` with new scores/tiers

  **Why not now:**
  - Stage 3 only screenshots ~200-400 Tier 1+2 leads; screenshotting all ~1000 unique
    domains first is 3-5x more work including dead sites (blank screenshots, CAPTCHA pages)
  - Swapping stages 2↔3 was evaluated and rejected (dead site false positives, wasted compute)
  - The other stage 2 fixes (CMS detection, SEO basics, response time, dead-site weight)
    already catch the majority of false negatives
  - Need real campaign data to know if this gap is worth the complexity

  **Slot reserved:** `design_score` (null) and `design_weakness` (null) columns exist in
  the stage 2 output schema from this audit — ready to populate when implemented.

  _Origin: stage 2 audit §Specific/5_
