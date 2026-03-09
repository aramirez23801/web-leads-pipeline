// pipeline/7-htmltopng.mjs — Render mockdesign.html → PNG screenshots + PDF
//
// Usage:
//   node pipeline/7-htmltopng.mjs
//   node pipeline/7-htmltopng.mjs --neighborhood maria_de_molina
//   node pipeline/7-htmltopng.mjs --neighborhood maria_de_molina --lead area2_instalaciones_eléctricas_y_mecánicas_s_a
//
// Input:  output/content_<neighborhood>/<safeName>/mockdesign.html
// Output: output/content_<neighborhood>/<safeName>/mockdesign_full.png
//         output/content_<neighborhood>/<safeName>/mockdesign_preview.png
//         output/content_<neighborhood>/<safeName>/mockdesign.pdf
//
// Skips leads where all 3 output files already exist (resumable).

import { chromium } from 'playwright';
import { existsSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { getNeighborhoodName, sanitizeName, getTargetLeads } from './utils.mjs';

// ── Config ───────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName();
const INPUT_FILE   = `output/leads_audited_${NEIGHBORHOOD}.xlsx`;
const CONTENT_DIR  = `output/content_${NEIGHBORHOOD}`;
const VIEWPORT_W   = 1440;
const VIEWPORT_H   = 900;
const SETTLE_MS    = 800; // extra delay after networkidle for animations/fonts

// ── CLI flags ────────────────────────────────────────────────────────────────

function getLeadFilter() {
  const idx = process.argv.indexOf('--lead');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}
const LEAD_FILTER = getLeadFilter();

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
    const htmlPath = join(CONTENT_DIR, LEAD_FILTER, 'mockdesign.html');
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
    console.log(`[PNG] No target leads found in ${INPUT_FILE}`);
    process.exit(0);
  }

  console.log(`[PNG] Neighborhood : ${NEIGHBORHOOD}`);
  console.log(`[PNG] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`);
  console.log(`[PNG] Viewport     : ${VIEWPORT_W}×${VIEWPORT_H}`);

  // Launch ONE browser for all leads
  const browser = await chromium.launch({ headless: true });

  const startTime = Date.now();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const lead of leads) {
    const safeName    = lead._safeName;
    const leadDir     = join(CONTENT_DIR, safeName);
    const htmlPath    = join(leadDir, 'mockdesign.html');
    const fullPath    = join(leadDir, 'mockdesign_full.png');
    const previewPath = join(leadDir, 'mockdesign_preview.png');
    const pdfPath     = join(leadDir, 'mockdesign.pdf');
    const displayName = LEAD_FILTER ? safeName : (lead.name || safeName);

    // Skip if all outputs already exist
    if (existsSync(fullPath) && existsSync(previewPath) && existsSync(pdfPath)) {
      console.log(`[PNG] SKIP  ${displayName} — all outputs exist`);
      skipped++;
      continue;
    }

    if (!existsSync(htmlPath)) {
      console.log(`[PNG] SKIP  ${displayName} — mockdesign.html not found`);
      skipped++;
      continue;
    }

    process.stdout.write(`[PNG] GEN   ${displayName} ... `);

    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });

      const fileUrl = `file://${resolve(htmlPath)}`;
      await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(SETTLE_MS);

      // ── Force reveal animations visible ──────────────────────────────────
      await page.evaluate(() => {
        document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
        // Collapse any CSS animation delays so animated elements are fully visible
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
      writeFileSync(fullPath, fullBuf);

      // ── Preview screenshot (viewport-only, 1440×900) ─────────────────────
      const previewBuf = await page.screenshot({ fullPage: false, type: 'png' });
      writeFileSync(previewPath, previewBuf);

      // ── PDF ───────────────────────────────────────────────────────────────
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        landscape: true,
        printBackground: true,
        scale: 0.5,
      });

      const fullKB    = fileSizeKB(fullPath);
      const previewKB = fileSizeKB(previewPath);
      const pdfKB     = fileSizeKB(pdfPath);

      console.log(`✓`);
      console.log(`  ↳ full: ${metrics.w}×${metrics.h}px (${fullKB}KB)  preview: ${VIEWPORT_W}×${VIEWPORT_H}px (${previewKB}KB)  pdf: ${pdfKB}KB`);

      if (LEAD_FILTER) {
        console.log(`\n  Preview : file://${resolve(previewPath)}`);
        console.log(`  Full    : file://${resolve(fullPath)}`);
        console.log(`  PDF     : file://${resolve(pdfPath)}`);
      }

      processed++;
    } catch (err) {
      console.log(`✗ ERROR`);
      console.error(`  [ERROR] ${err.message}`);
      errors++;
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log('\n' + '═'.repeat(46));
  console.log('  HTML → PNG/PDF COMPLETE');
  console.log('═'.repeat(46));
  console.log(`  Neighborhood : ${NEIGHBORHOOD}`);
  console.log(`  Processed    : ${processed}`);
  console.log(`  Skipped      : ${skipped}`);
  console.log(`  Errors       : ${errors}`);
  console.log(`  Duration     : ${elapsed}s`);
  console.log(`  Output       : ${CONTENT_DIR}/`);
  console.log('═'.repeat(46));
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
