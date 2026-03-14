// pipeline/7-htmltopng.mjs — Render mockdesign.html → PNG screenshots
//
// Usage:
//   node pipeline/7-htmltopng.mjs
//   node pipeline/7-htmltopng.mjs --neighborhood maria_de_molina
//   node pipeline/7-htmltopng.mjs --neighborhood maria_de_molina --lead area2_instalaciones_eléctricas_y_mecánicas_s_a
//
// Input:  output/{neighborhood}/leads/<safeName>/mockdesign.html
// Output: output/{neighborhood}/leads/<safeName>/mockdesign_full.png
//         output/{neighborhood}/leads/<safeName>/mockdesign_preview.png
//         output/{neighborhood}/logs/htmltopng_{YYYY-MM-DD}.log
//
// Skips leads where both output files already exist (resumable).

import { chromium } from 'playwright';
import { existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { getNeighborhoodName, sanitizeName, getTargetLeads, getNeighborhoodDirs, getLatestRunDir, logDate } from './utils.mjs';

// ── Config ───────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName();
const dirs         = getNeighborhoodDirs(NEIGHBORHOOD);
let RUN_DIR;
try {
  RUN_DIR = getLatestRunDir(NEIGHBORHOOD);
} catch (err) {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
}
const INPUT_FILE  = `${RUN_DIR}/leads_audited.xlsx`;
const LEADS_DIR   = dirs.leads;
const LOG_FILE    = `${dirs.logs}/htmltopng_${logDate()}.log`;
mkdirSync(dirs.logs, { recursive: true });
const VIEWPORT_W   = 1440;
const VIEWPORT_H   = 900;
const SETTLE_MS    = 800; // extra delay after networkidle for animations/fonts
const MIN_PNG_BYTES = 50 * 1024; // < 50KB likely indicates a blank/failed render

// ── CLI flags ────────────────────────────────────────────────────────────────

function getLeadFilter() {
  const idx = process.argv.indexOf('--lead');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}
const LEAD_FILTER = getLeadFilter();

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function logError(msg) {
  const line = `[${new Date().toISOString()}] [ERROR] ${msg}`;
  console.error(line);
  appendFileSync(LOG_FILE, line + '\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fileSizeKB(filePath) {
  try {
    return (statSync(filePath).size / 1024).toFixed(1);
  } catch {
    return '?';
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!LEAD_FILTER && !existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`);
    console.error(`        Run the auditor first: node pipeline/2-auditor.mjs --neighborhood ${NEIGHBORHOOD}`);
    console.error(`        Or use --lead <safeName> to process a single lead directly.`);
    process.exit(1);
  }

  // Build lead list
  let leads;
  if (LEAD_FILTER) {
    const htmlPath = join(LEADS_DIR, LEAD_FILTER, 'mockdesign.html');
    if (!existsSync(htmlPath)) {
      console.error(`[ERROR] mockdesign.html not found for --lead "${LEAD_FILTER}"`);
      console.error(`        Expected: ${htmlPath}`);
      console.error(`        Run stage 6 first: node pipeline/6-mockdesign.mjs --lead ${LEAD_FILTER}`);
      process.exit(1);
    }
    leads = [{ name: LEAD_FILTER, _safeName: LEAD_FILTER }];
  } else {
    leads = (await getTargetLeads(INPUT_FILE)).map(l => ({ ...l, _safeName: sanitizeName(l.name) }));
  }

  if (leads.length === 0) {
    log(`[PNG] No target leads found in ${INPUT_FILE}`);
    process.exit(0);
  }

  log(`[PNG] Neighborhood : ${NEIGHBORHOOD}`);
  log(`[PNG] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`);
  log(`[PNG] Viewport     : ${VIEWPORT_W}×${VIEWPORT_H}`);

  // Launch ONE browser for all leads — guarantee close even on fatal error
  // deviceScaleFactor: 2 = retina-quality output (2× resolution)
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ deviceScaleFactor: 2 });

  const startTime = Date.now();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    for (const lead of leads) {
      const safeName    = lead._safeName;
      const leadDir     = join(LEADS_DIR, safeName);
      const htmlPath    = join(leadDir, 'mockdesign.html');
      const fullPath    = join(leadDir, 'mockdesign_full.png');
      const previewPath = join(leadDir, 'mockdesign_preview.png');
      const displayName = LEAD_FILTER ? safeName : (lead.name || safeName);

      // Skip if both outputs already exist (resumable)
      if (existsSync(fullPath) && existsSync(previewPath)) {
        log(`[PNG] SKIP  ${displayName} — all outputs exist`);
        skipped++;
        continue;
      }

      if (!existsSync(htmlPath)) {
        log(`[PNG] SKIP  ${displayName} — mockdesign.html not found`);
        skipped++;
        continue;
      }

      process.stdout.write(`[PNG] GEN   ${displayName} ... `);

      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });

        const fileUrl = `file://${resolve(htmlPath)}`;
        await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await sleep(SETTLE_MS);

        // ── Force all animated elements to their final visible state ─────────
        // Generated HTML may use [data-animate]+.visible or .reveal+.visible patterns.
        // Without this, IntersectionObserver-gated elements stay at opacity:0 in the
        // screenshot (they never enter the viewport during a headless render).
        await page.evaluate(() => {
          document.querySelectorAll('[data-animate], .reveal, .fade-in').forEach(el => {
            el.classList.add('visible');
          });
          // Collapse transition durations so the above class additions take effect instantly
          const style = document.createElement('style');
          style.textContent = '*, *::before, *::after { animation-delay: 0s !important; animation-duration: 0.01s !important; transition-duration: 0.01s !important; }';
          document.head.appendChild(style);
        });
        await page.waitForTimeout(300);

        // ── Full-page dimensions (for logging) ───────────────────────────────
        const metrics = await page.evaluate(() => ({
          w: document.documentElement.scrollWidth,
          h: document.documentElement.scrollHeight,
        }));

        // ── Full-page screenshot ──────────────────────────────────────────────
        const fullBuf = await page.screenshot({ fullPage: true, type: 'png' });
        if (fullBuf.length < MIN_PNG_BYTES) {
          throw new Error(`Full screenshot suspiciously small (${(fullBuf.length / 1024).toFixed(1)}KB) — likely blank render`);
        }
        writeFileSync(fullPath, fullBuf);

        // ── Preview screenshot (viewport-only, 1440×900) ─────────────────────
        const previewBuf = await page.screenshot({ fullPage: false, type: 'png' });
        if (previewBuf.length < MIN_PNG_BYTES) {
          throw new Error(`Preview screenshot suspiciously small (${(previewBuf.length / 1024).toFixed(1)}KB) — likely blank render`);
        }
        writeFileSync(previewPath, previewBuf);

        const fullKB    = fileSizeKB(fullPath);
        const previewKB = fileSizeKB(previewPath);

        console.log(`✓`);
        log(`  ↳ full: ${metrics.w}×${metrics.h}px (${fullKB}KB)  preview: ${VIEWPORT_W}×${VIEWPORT_H}px (${previewKB}KB)`);

        if (LEAD_FILTER) {
          log(`\n  Preview : file://${resolve(previewPath)}`);
          log(`  Full    : file://${resolve(fullPath)}`);
        }

        processed++;
      } catch (err) {
        console.log(`✗ ERROR`);
        logError(`${displayName} — ${err.message}`);
        errors++;
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  log('');
  log('═'.repeat(46));
  log('  HTML → PNG COMPLETE');
  log('═'.repeat(46));
  log(`  Neighborhood : ${NEIGHBORHOOD}`);
  log(`  Processed    : ${processed}`);
  log(`  Skipped      : ${skipped}`);
  log(`  Errors       : ${errors}`);
  log(`  Duration     : ${elapsed}s`);
  log(`  Output       : ${LEADS_DIR}/`);
  log(`  Log          : ${LOG_FILE}`);
  log('═'.repeat(46));
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
