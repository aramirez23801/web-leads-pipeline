# Pending Cross-Stage TODOs

**Last updated:** 2026-03-10 (stage 5 audit complete)
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

- [ ] **Remove `buildMockPrompt()` — replaced by `design_prompt.txt` from stage 5**
      Stage 6 now reads `design_prompt.txt` per lead and sends it directly to Claude.
      The internal prompt builder in stage 6 is dead code and must be deleted.
      _Origin: stage 5 audit — Option B architectural change_

- [ ] **Create `docs/design-prompt-guide.md`** — condensed, LLM-optimized version of
      `FRONTEND_GUIDELINES.md` for prompt injection. Currently the relevant sections are
      inlined directly in stage 5's prompt builder. This file will be extracted, refined,
      and maintained separately during the stage 6 audit. Stage 5 will reference this file
      instead of having guidelines hardcoded.
      _Origin: stage 5 audit §8 — deferred to stage 6_

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
