# Session Context — 2026-03-14
**Purpose:** Restore full context after closing terminal. Read this at the start of the next session.

---

## Where We Are

### Active branches
- `feature/output-restructure` — **current branch, uncommitted changes ready to commit**
- `feature/email-outreach-pipeline` — parent branch (merge target for output-restructure)
- `main` — only merge after full e2e test

### What was done this session
1. Created branch `feature/output-restructure` off `feature/email-outreach-pipeline`
2. Restructured `output/` from flat to nested neighborhood structure
3. Migrated existing `maria_de_molina` data to new structure
4. Updated all 9 pipeline stages (1–9) + `utils.mjs` + created `scripts/migrate-output.mjs`
5. Reviewed and fixed: duplicate `fs` imports in stages 5–8, `crawl_cache.json` location
6. Tested stages 4, 5, 6, 7, 8 — all pass with new paths

### Current git state
All changes are **staged and verified but NOT yet committed**. Ready to commit.

Files changed:
- `pipeline/utils.mjs` — added `getNeighborhoodDirs`, `getLatestRunDir`, `makeRunId`, `logDate`
- `pipeline/1-scraper.mjs` — new run dir per scrape, writes `latest_run.json`
- `pipeline/2-auditor.mjs` — reads from `latest_run.json` run dir
- `pipeline/3-screenshot.mjs` — screenshots now in `leads/{safeName}/screenshot_{mobile,desktop}.png`
- `pipeline/4-content.mjs` — CONTENT_DIR → LEADS_DIR, new paths
- `pipeline/5-prompts.mjs` — same
- `pipeline/6-mockdesign.mjs` — same
- `pipeline/7-htmltopng.mjs` — same
- `pipeline/8-emailcontent.mjs` — same
- `pipeline/9-deploy.mjs` — same
- `scripts/migrate-output.mjs` — one-time migration script (already run for maria_de_molina)

---

## New Output Structure

```
output/
  {neighborhood}/
    runs/
      {YYYY-MM-DD_HHmmss}/        ← per-run, never overwritten
        businesses.xlsx            ← stage 1
        leads_audited.xlsx         ← stage 2
        outreach.xlsx              ← stage 2
        screenshot_manifest.json   ← stage 3
    leads/
      {safeName}/                  ← shared across runs (skip checks protect from re-processing)
        screenshot_mobile.png      ← stage 3
        screenshot_desktop.png     ← stage 3
        content.json               ← stage 4
        logo.png                   ← stage 4
        design_prompt.md           ← stage 5
        mockdesign.html            ← stage 6
        mockdesign_full.png        ← stage 7
        mockdesign_preview.png     ← stage 7
        email.json                 ← stage 8 + 9
    crawl_cache.json               ← stage 2 cache (neighborhood root — shared across re-scrapes)
    logs/
      {stage}_{YYYY-MM-DD}.log    ← all stages append here
    latest_run.json                ← { runId, path, createdAt } — pointer for stages 2–9
```

Key design decisions:
- `leads/` is shared per neighborhood (not per-run) — avoids re-spending ~$80 in API costs on re-scrapes
- `crawl_cache.json` at neighborhood root so stage 2 reuses it across re-scrapes
- `latest_run.json` is the pointer that stages 2–9 follow to find `leads_audited.xlsx`

---

## New utils.mjs Exports

```js
getNeighborhoodDirs(neighborhood)  // → { root, runs, leads, logs, latestRunFile }
getLatestRunDir(neighborhood)      // reads latest_run.json → returns run dir path (throws if missing)
makeRunId()                        // → 'YYYY-MM-DD_HHmmss'
logDate()                          // → 'YYYY-MM-DD'
```

---

## Immediate Next Step: Commit This Branch

```bash
git add pipeline/utils.mjs \
        pipeline/1-scraper.mjs pipeline/2-auditor.mjs pipeline/3-screenshot.mjs \
        pipeline/4-content.mjs pipeline/5-prompts.mjs pipeline/6-mockdesign.mjs \
        pipeline/7-htmltopng.mjs pipeline/8-emailcontent.mjs pipeline/9-deploy.mjs \
        scripts/migrate-output.mjs

git commit -m "refactor: restructure output/ to nested neighborhood layout

output/{n}/runs/{timestamp}/ for run-level data (businesses, audited leads)
output/{n}/leads/{safeName}/ for per-lead data (shared across re-scrapes)
output/{n}/logs/ for all stage logs (dated)
output/{n}/crawl_cache.json shared at neighborhood root
output/{n}/latest_run.json pointer for stages 2–9

utils.mjs: add getNeighborhoodDirs, getLatestRunDir, makeRunId, logDate
scripts/migrate-output.mjs: one-time migration (already run for maria_de_molina)"

git push origin feature/output-restructure
```

Then:
```bash
git checkout feature/email-outreach-pipeline
git merge --no-ff feature/output-restructure
git push origin feature/email-outreach-pipeline
git branch -d feature/output-restructure
git push origin --delete feature/output-restructure
```

---

## Full Build Order — Remaining

```
✅ Output folder restructure (feature/output-restructure — ready to commit)
   6.  Stage 9 rewrite — Azure Blob upload (replace Cloudflare Pages)
       - Only stage 9 changes
       - Upload mockdesign.html to Azure Blob $web container
       - URL: previews.mejoraweb.app/{safeName}/mockdesign.html  (deterministic, no polling)
       - Cleanup: listBlobsFlat() + delete blobs >15 days
       - New dep: @azure/storage-blob
       - New env vars: AZURE_STORAGE_CONNECTION_STRING
       - One-time Azure setup: enable static site + CNAME previews.mejoraweb.app
   7.  Stage 10 build — Resend API sends (replace CSV/Instantly.ai)
       - Reads leads_audited.xlsx from latest run + email.json from leads/
       - Sends via Resend API (free tier, ~100/month, B2B cold email compliant)
       - Checks suppression list before send
       - Logs sends to a local sends.json or directly to Supabase later
       - --send flag required (dry-run shows what would be sent)
   8.  Update package.json scripts
   9.  Re-scrape María de Molina v2 (dry-run first, then full ~$9-15)
  10.  Full e2e test on v2 data → merge feature/email-outreach-pipeline → main

  [Admin dashboard phase — separate effort]:
  11. Supabase schema + project setup (tables: runs, leads, email_sends, replies, suppressions)
  12. Full blob migration: all pipeline file I/O moves to Azure Blob + Azure Functions triggers
  13. Admin dashboard: React + Azure Functions + Supabase auth
```

---

## Architecture Decisions (locked)

| Concern | Decision |
|---|---|
| DB | Supabase (PostgreSQL) — free tier 500MB |
| Mockup hosting (V1) | Azure Blob `$web` + `previews.mejoraweb.app` subdomain |
| Full pipeline hosting (V2) | Azure (pipeline in Azure Functions, triggered from dashboard) |
| Email sending | Resend API (B2B cold email compliant at low volume) |
| Stage 10 scheduler | Semi-automated V1: Day 0 manual, Day 4/12 admin-triggered |
| Unsubscribe V1 | Reply-based footer ("responde con 'No gracias'") |
| Unsubscribe V2 | mejoraweb.app/unsubscribe + Azure Function + Resend suppression API |
| Full cloud migration | As part of admin dashboard build — not before, not after |

---

## Important Notes

- `scripts/migrate-output.mjs` has **already been run** for `maria_de_molina` — do not run again
- The old flat output files are gone; the new nested structure is in `output/maria_de_molina/`
- CLAUDE.md `stage 9` description is still outdated (references Instantly.ai CSV) — update after stage 10 is built
- `hola-mejoraweb.com` warmup: check status — every week delayed = one week delay to first campaign
