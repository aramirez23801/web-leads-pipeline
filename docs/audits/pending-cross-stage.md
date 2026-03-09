# Pending Cross-Stage TODOs
**Last updated:** 2026-03-09 (stage 2 audit complete)
**Purpose:** Items identified during stage audits that must be fixed in a different stage.
           Review this file at the start of each stage audit.

---

## Stage 2 — `2-auditor.mjs`

✅ Items below are being addressed in the stage 2 audit (`audit/stage2-auditor-fixes`).

- [x] **Migrate from `xlsx` to `exceljs`** — being fixed in stage 2 audit
- [x] **Use `photos_count` in opportunity scoring** — being fixed in stage 2 audit
- [x] **Use `verified` in opportunity scoring** — being fixed in stage 2 audit

---

## Stage 4 — `4-content.mjs`

- [ ] **Parse `emails` as JSON array, not comma-split**
  Stage 1 now stores `emails` as a JSON array string (e.g. `'["a@b.com","c@d.com"]'`).
  Stage 4's email merge logic currently splits on commas, which will produce incorrect
  results. Update to use `JSON.parse(row.emails || '[]')` when reading the emails field
  from the audited XLSX.
  _Origin: stage 1 audit, issue #5 — BREAKING CHANGE, must fix before a full pipeline run_

---

## Stage 5 — `5-prompts.mjs`

- [ ] **Use `description` (Google Maps) in design brief**
  Stage 1 now saves the Google Maps business description in the `description` column.
  This is structured, human-written text about what the business does — more reliable
  than scraped website copy for many SMEs. Include it in the prompt context passed to
  stage 6.
  _Origin: stage 1 audit, issue #8_

- [ ] **Use `working_hours` in design brief**
  Stage 1 saves `working_hours` as a JSON string (`{"lunes":["9:00-18:00"],...}`).
  Parse and format this into a human-readable schedule and include in the prompt context.
  A mockup showing real business hours is significantly more credible and personalized.
  _Origin: stage 1 audit, issue #16_

---

## Stage 6 — `6-mockdesign.mjs`

- [ ] **Display real `working_hours` in HTML mockup**
  The design brief (from stage 5) should pass formatted working hours to stage 6.
  The HTML mockup should include a "Horario" section with the actual business hours.
  This is one of the highest-impact personalization improvements available — a mockup
  with real hours looks nothing like a generic AI-generated template.
  _Origin: stage 1 audit, issue #16_

---

## Stage 8 — `8-emailcontent.mjs`

- [ ] **Use `description` (Google Maps) in email copy**
  The Haiku prompt currently relies on scraped website content to identify the business's
  specific web problem. The Google Maps `description` field (when present) gives direct
  insight into what the business does and how it presents itself. Pass it as additional
  context to Haiku for more specific `problema` sentences.
  _Origin: stage 1 audit, issue #8_

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

- [ ] **Remove dead dependencies: `pdf-lib`, `@pdf-lib/fontkit`**
  These were used by the deleted `8-postcard.mjs`. Not imported anywhere in the current
  pipeline. Remove from `package.json` at the end of all stage audits.
  _Origin: stage 1 audit, dependency section_

- [ ] **Investigate Outscraper pagination API**
  Stage 1 is currently capped at 500 results per category query. For dense neighborhoods
  and popular categories (restaurantes, clínicas), results above 500 are silently dropped.
  Verify the correct pagination parameter against Outscraper API docs (`skip`, `cursor`,
  or other), then implement in stage 1 if needed.
  _Origin: stage 1 audit, performance section_

- [ ] **Migrate remaining stages from `xlsx` to `exceljs`**
  Stage 1 already uses `exceljs`. Stages 2 and any other stage that reads/writes XLSX
  should also migrate to eliminate the `xlsx` HIGH-severity CVE across the codebase.
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
