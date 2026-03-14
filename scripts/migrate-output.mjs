/**
 * scripts/migrate-output.mjs — One-time migration from flat output/ to nested structure.
 *
 * Old:  output/businesses_{n}.xlsx
 *       output/leads_audited_{n}.xlsx
 *       output/screenshots_{n}/{safeName}_mobile.png
 *       output/content_{n}/{safeName}/...
 *       output/{stage}_{n}.log
 *
 * New:  output/{n}/runs/{YYYY-MM-DD_HHmmss}/businesses.xlsx
 *       output/{n}/runs/{YYYY-MM-DD_HHmmss}/leads_audited.xlsx
 *       output/{n}/leads/{safeName}/screenshot_mobile.png
 *       output/{n}/leads/{safeName}/content.json ...
 *       output/{n}/logs/{stage}_{YYYY-MM-DD}.log
 *       output/{n}/latest_run.json
 *
 * Usage:
 *   node scripts/migrate-output.mjs
 *   node scripts/migrate-output.mjs --neighborhood salamanca
 */

import { mkdirSync, renameSync, existsSync, writeFileSync, readdirSync, statSync, rmdirSync } from 'fs';
import { join } from 'path';

// ── Resolve neighborhood from CLI ─────────────────────────────────────────────

const args = process.argv.slice(2);
let neighborhood = 'maria_de_molina';
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--neighborhood' || args[i] === '-n') && args[i + 1]) {
    neighborhood = args[i + 1];
  }
}

console.log(`\nMigrating output for neighborhood: ${neighborhood}\n`);

// ── Derive run ID from xlsx mtime ─────────────────────────────────────────────

const srcXlsx = `output/businesses_${neighborhood}.xlsx`;
let runId;

if (existsSync(srcXlsx)) {
  const mtime = statSync(srcXlsx).mtime;
  const date = mtime.toISOString().slice(0, 10);
  const time = mtime.toISOString().slice(11, 19).replace(/:/g, '');
  runId = `${date}_${time}`;
  console.log(`Run ID derived from xlsx mtime: ${runId}`);
} else {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  runId = `${date}_${time}`;
  console.log(`businesses.xlsx not found — using current time as run ID: ${runId}`);
}

// ── Create directory structure ────────────────────────────────────────────────

const runDir   = `output/${neighborhood}/runs/${runId}`;
const leadsDir = `output/${neighborhood}/leads`;
const logsDir  = `output/${neighborhood}/logs`;

mkdirSync(runDir,   { recursive: true });
mkdirSync(leadsDir, { recursive: true });
mkdirSync(logsDir,  { recursive: true });
console.log(`Created: ${runDir}`);
console.log(`Created: ${leadsDir}`);
console.log(`Created: ${logsDir}\n`);

// ── Move run-level data files ─────────────────────────────────────────────────

function move(src, dst) {
  if (existsSync(src)) {
    renameSync(src, dst);
    console.log(`  ✓  ${src}  →  ${dst}`);
  } else {
    console.log(`  ⚠  skip (not found): ${src}`);
  }
}

const logDay = runId.slice(0, 10);

console.log('── Run-level data files ──');
move(`output/businesses_${neighborhood}.xlsx`,       `${runDir}/businesses.xlsx`);
move(`output/leads_audited_${neighborhood}.xlsx`,    `${runDir}/leads_audited.xlsx`);
move(`output/outreach_${neighborhood}.xlsx`,         `${runDir}/outreach.xlsx`);
move(`output/crawl_cache_${neighborhood}.json`,      `output/${neighborhood}/crawl_cache.json`);

console.log('\n── Log files ──');
move(`output/scraper_${neighborhood}.log`,           `${logsDir}/scraper_${logDay}.log`);
move(`output/auditor_${neighborhood}.log`,           `${logsDir}/auditor_${logDay}.log`);
move(`output/screenshot_${neighborhood}.log`,        `${logsDir}/screenshot_${logDay}.log`);
move(`output/content_${neighborhood}.log`,           `${logsDir}/content_${logDay}.log`);
move(`output/prompts_${neighborhood}.log`,           `${logsDir}/prompts_${logDay}.log`);
move(`output/content_${neighborhood}_prompts.log`,   `${logsDir}/prompts_old_${logDay}.log`);
move(`output/mockdesign_${neighborhood}.log`,        `${logsDir}/mockdesign_${logDay}.log`);
move(`output/htmltopng_${neighborhood}.log`,         `${logsDir}/htmltopng_${logDay}.log`);
move(`output/emailcontent_${neighborhood}.log`,      `${logsDir}/emailcontent_${logDay}.log`);

// ── Move content dirs → leads/ ────────────────────────────────────────────────

console.log('\n── Per-lead content dirs ──');
const contentDir = `output/content_${neighborhood}`;
if (existsSync(contentDir)) {
  for (const safeName of readdirSync(contentDir)) {
    const src = join(contentDir, safeName);
    if (!statSync(src).isDirectory()) continue;
    const dst = join(leadsDir, safeName);
    mkdirSync(dst, { recursive: true });
    // Move each file individually (directory-level rename fails if dst exists)
    for (const file of readdirSync(src)) {
      renameSync(join(src, file), join(dst, file));
    }
    try { rmdirSync(src); } catch {}
    console.log(`  ✓  content/${safeName}  →  leads/${safeName}`);
  }
  try { rmdirSync(contentDir); console.log(`  ✓  removed empty: ${contentDir}`); } catch {}
} else {
  console.log(`  ⚠  skip (not found): ${contentDir}`);
}

// ── Move screenshots → leads/{safeName}/ ─────────────────────────────────────

console.log('\n── Screenshots ──');
const screenshotsDir = `output/screenshots_${neighborhood}`;
if (existsSync(screenshotsDir)) {
  for (const filename of readdirSync(screenshotsDir)) {
    const src = join(screenshotsDir, filename);
    if (statSync(src).isDirectory()) continue;

    if (filename === 'manifest.json') {
      move(src, `${runDir}/screenshot_manifest.json`);
      continue;
    }
    if (filename === 'errors.log') {
      move(src, `${logsDir}/screenshot_errors_${logDay}.log`);
      continue;
    }

    const mobileMatch  = filename.match(/^(.+)_mobile\.png$/);
    const desktopMatch = filename.match(/^(.+)_desktop\.png$/);

    if (mobileMatch) {
      const safeName = mobileMatch[1];
      const dst = join(leadsDir, safeName);
      mkdirSync(dst, { recursive: true });
      renameSync(src, join(dst, 'screenshot_mobile.png'));
      console.log(`  ✓  screenshots/${filename}  →  leads/${safeName}/screenshot_mobile.png`);
    } else if (desktopMatch) {
      const safeName = desktopMatch[1];
      const dst = join(leadsDir, safeName);
      mkdirSync(dst, { recursive: true });
      renameSync(src, join(dst, 'screenshot_desktop.png'));
      console.log(`  ✓  screenshots/${filename}  →  leads/${safeName}/screenshot_desktop.png`);
    } else {
      console.log(`  ⚠  unknown file in screenshots dir, skipping: ${filename}`);
    }
  }
  try { rmdirSync(screenshotsDir); console.log(`  ✓  removed empty: ${screenshotsDir}`); } catch {}
} else {
  console.log(`  ⚠  skip (not found): ${screenshotsDir}`);
}

// ── Write latest_run.json ─────────────────────────────────────────────────────

const latestRunFile = `output/${neighborhood}/latest_run.json`;
writeFileSync(latestRunFile, JSON.stringify({ runId, path: runDir, createdAt: new Date().toISOString() }, null, 2));
console.log(`\n  ✓  Written: ${latestRunFile}`);

console.log('\n✅ Migration complete.\n');
