# Pending Cross-Stage TODOs
**Last updated:** 2026-03-09
**Purpose:** Items identified during stage audits that must be fixed in a different stage.
           Review this file at the start of each stage audit.

---

## Stage 2 — `2-auditor.mjs`

- [ ] **Migrate from `xlsx` to `exceljs`**
  Stage 2 reads `businesses_{neighborhood}.xlsx` (written by stage 1 with exceljs) and
  writes `leads_audited_{neighborhood}.xlsx`. The `xlsx` library has a HIGH-severity CVE
  with no upstream fix. Migrate both read and write operations to `exceljs`.
  _Origin: stage 1 audit, dependency section_

- [ ] **Use `photos_count` in opportunity scoring**
  Stage 1 now saves `photos_count` from Outscraper. Businesses with more photos are more
  active on Google Maps and generally higher-quality leads. Consider adding it as a scoring
  signal in stage 2's tier/score logic.
  _Origin: stage 1 audit §1_

- [ ] **Use `verified` in opportunity scoring**
  Stage 1 now saves `verified` (Google-verified listing). Verified businesses are confirmed
  active — weight this positively in stage 2 scoring.
  _Origin: stage 1 audit §1_

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
