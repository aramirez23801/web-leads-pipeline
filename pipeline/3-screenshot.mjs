// pipeline/3-screenshot.mjs — Mobile + Desktop screenshots of Tier 1 & Tier 2 leads
//
// Usage:
//   node pipeline/3-screenshot.mjs
//   node pipeline/3-screenshot.mjs -n salamanca
//   node pipeline/3-screenshot.mjs --lead <safeName>   # single lead (for testing)
//
// Input:  output/leads_audited_{neighborhood}.xlsx
// Output: output/screenshots_{neighborhood}/{safeName}_mobile.png   (full page, max 6000px)
//         output/screenshots_{neighborhood}/{safeName}_desktop.png  (full page, max 5000px)
//         output/screenshots_{neighborhood}/manifest.json
//         output/screenshots_{neighborhood}/errors.log              (errors only)
//         output/screenshot_{neighborhood}.log                      (full run log)

import 'dotenv/config';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import pLimit from 'p-limit';
import { sanitizeName, getNeighborhoodName, getTargetLeads } from './utils.mjs';

const NEIGHBORHOOD    = getNeighborhoodName();
const INPUT_FILE      = `output/leads_audited_${NEIGHBORHOOD}.xlsx`;
const SCREENSHOT_DIR  = `output/screenshots_${NEIGHBORHOOD}`;
const LOG_FILE        = `output/screenshot_${NEIGHBORHOOD}.log`;
const ERROR_LOG       = `${SCREENSHOT_DIR}/errors.log`;
const MANIFEST_FILE   = `${SCREENSHOT_DIR}/manifest.json`;
const CONCURRENCY     = 3;
const TIMEOUT_MS      = 20000;
const DESKTOP_MAX_H   = 5000; // px cap for full-page desktop screenshots
const MOBILE_MAX_H    = 6000; // px cap for full-page mobile screenshots

// ── Parse --lead flag ────────────────────────────────────────────────────────
function getLeadFilter() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lead' && args[i + 1]) return args[i + 1];
  }
  return null;
}
const LEAD_FILTER = getLeadFilter();

// ── Logger ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function logError(msg) {
  const line = `[${new Date().toISOString()}] ERROR ${msg}`;
  appendFileSync(LOG_FILE,   line + '\n');
  appendFileSync(ERROR_LOG,  line + '\n');
  console.error(`  ✗ ${msg}`);
}

// ── Placeholder image ────────────────────────────────────────────────────────
async function createPlaceholder(filepath, width, height, text) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#e0e0e0"/>
    <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Arial" font-size="18" fill="#666">${text}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filepath);
}

// ── Full-page screenshot with height cap ─────────────────────────────────────
async function screenshotCapped(page, filepath, maxHeight) {
  const rawBuf = await page.screenshot({ fullPage: true, encoding: 'binary' });
  const img = sharp(Buffer.from(rawBuf));
  const meta = await img.metadata();
  if (meta.height > maxHeight) {
    await img.extract({ left: 0, top: 0, width: meta.width, height: maxHeight }).toFile(filepath);
  } else {
    await img.toFile(filepath);
  }
}

// ── Load existing manifest for resume ────────────────────────────────────────
function loadManifest() {
  if (!existsSync(MANIFEST_FILE)) return new Map();
  try {
    const entries = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'));
    return new Map(entries.map(e => [e.safeName, e]));
  } catch {
    return new Map();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`);
    console.error(`  Run the auditor first: node pipeline/2-auditor.mjs -n ${NEIGHBORHOOD}`);
    process.exit(1);
  }

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const startTime = Date.now();
  log(`[INIT] Neighborhood: ${NEIGHBORHOOD}`);

  let leads = await getTargetLeads(INPUT_FILE, 50);

  if (LEAD_FILTER) {
    leads = leads.filter(l => sanitizeName(l.name) === LEAD_FILTER);
    if (leads.length === 0) {
      console.error(`[ERROR] No lead found matching --lead "${LEAD_FILTER}"`);
      process.exit(1);
    }
    log(`[LEAD] Single-lead mode: ${LEAD_FILTER}`);
  }

  log(`[INIT] ${leads.length} target leads (Tier 1 + Tier 2 score>=50)`);

  // Load manifest for resume — keyed by safeName
  const manifestMap = loadManifest();
  const alreadyDone = [...manifestMap.values()].filter(e => e.success).length;
  if (alreadyDone > 0) {
    log(`[RESUME] ${alreadyDone} leads already completed, will skip`);
  }

  const browser = await puppeteer.launch({
    headless: 'shell',
    timeout: 60000,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const limiter = pLimit(CONCURRENCY);
  let completed = 0;
  let skipped = 0;

  try {
    const tasks = leads.map(lead =>
      limiter(async () => {
        const name = lead.name || 'unknown';
        const safeName = sanitizeName(name);
        const url = lead.final_url || lead.website;

        if (!url) {
          logError(`${name}: no URL available, skipping`);
          return;
        }

        const mobilePath  = `${SCREENSHOT_DIR}/${safeName}_mobile.png`;
        const desktopPath = `${SCREENSHOT_DIR}/${safeName}_desktop.png`;

        // Resume: skip if both screenshots already exist and were successful
        const prev = manifestMap.get(safeName);
        if (prev?.success && existsSync(mobilePath) && existsSync(desktopPath)) {
          skipped++;
          log(`[${completed + skipped}/${leads.length}] ↩ ${name} — already done, skipping`);
          return;
        }

        const entry = {
          name,
          safeName,
          url,
          tier:           lead.tier,
          score:          lead.opportunity_score,
          mobilePath,
          desktopPath,
          phone:          lead.phone          || '',
          category:       lead.category       || '',
          full_address:   lead.full_address   || '',
          emails:         lead.emails         || '',
          description:    lead.description    || '',
          working_hours:  lead.working_hours  || '',
          google_id:      lead.google_id      || '',
          cms_detected:   lead.cms_detected   || '',
          missing_h1:     lead.missing_h1     || '',
          missing_meta_desc: lead.missing_meta_desc || '',
          pitch_angle:    lead.pitch_angle    || '',
          success: false,
        };

        let page;
        try {
          page = await browser.newPage();
          await page.setDefaultNavigationTimeout(TIMEOUT_MS);

          // Block heavy resources to speed up screenshots
          await page.setRequestInterception(true);
          page.on('request', req => {
            if (['media', 'font'].includes(req.resourceType())) {
              req.abort();
            } else {
              req.continue();
            }
          });

          // Navigate — domcontentloaded is reliable; networkidle2 times out on sites
          // with continuous background requests (analytics, chat widgets, ad scripts).
          // One retry on failure catches transient network hiccups.
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
          } catch (navErr) {
            log(`[RETRY] ${name} — first navigation failed (${navErr.message?.substring(0, 60)}), retrying...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
          }
          // Short fixed wait for above-fold content to finish rendering
          await new Promise(r => setTimeout(r, 1500));

          // Dismiss common cookie/consent banners
          try {
            await page.evaluate(() => {
              const selectors = [
                '[class*="cookie"] button', '[class*="consent"] button',
                '[id*="cookie"] button',    '[class*="Cookie"] button',
                'button[class*="accept"]',  'button[id*="accept"]',
                '.cc-btn',                  '#onetrust-accept-btn-handler',
              ];
              for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn) { btn.click(); break; }
              }
            });
            await new Promise(r => setTimeout(r, 400));
          } catch { /* ignore cookie dismissal errors */ }

          // Mobile screenshot — full page, capped at MOBILE_MAX_H
          await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
          await new Promise(r => setTimeout(r, 600)); // let reflow settle
          await screenshotCapped(page, mobilePath, MOBILE_MAX_H);

          // Desktop screenshot — full page, capped at DESKTOP_MAX_H
          await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
          await new Promise(r => setTimeout(r, 600));
          await screenshotCapped(page, desktopPath, DESKTOP_MAX_H);

          entry.success = true;
          completed++;
          log(`[${completed + skipped}/${leads.length}] ✓ ${name} — ${url}`);
        } catch (err) {
          logError(`${name} (${url}): ${err.message || err}`);

          try {
            if (!existsSync(mobilePath))  await createPlaceholder(mobilePath,  375,  812, 'Sitio web no disponible');
            if (!existsSync(desktopPath)) await createPlaceholder(desktopPath, 1440, 900, 'Sitio web no disponible');
          } catch (placeholderErr) {
            logError(`Placeholder failed for ${name}: ${placeholderErr.message}`);
          }

          completed++;
          log(`[${completed + skipped}/${leads.length}] ✗ ${name} — ${err.message?.substring(0, 80)}`);
        } finally {
          if (page) await page.close().catch(() => {});
        }

        // Update manifest map and flush to disk
        manifestMap.set(safeName, entry);
        writeFileSync(MANIFEST_FILE, JSON.stringify([...manifestMap.values()], null, 2));
      })
    );

    await Promise.all(tasks);
  } finally {
    await browser.close();
  }

  const allEntries    = [...manifestMap.values()];
  const successCount  = allEntries.filter(e => e.success).length;
  const newSuccesses  = successCount - alreadyDone;
  const newErrors     = completed - newSuccesses;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  log('\n═══════════════════════════════════════════');
  log('  SCREENSHOTS COMPLETE');
  log('═══════════════════════════════════════════');
  log(`  Neighborhood:    ${NEIGHBORHOOD}`);
  log(`  Leads total:     ${leads.length}`);
  log(`  Skipped (done):  ${skipped}`);
  log(`  Processed:       ${completed}`);
  log(`  Screenshots OK:  ${newSuccesses}`);
  log(`  Errors:          ${newErrors}`);
  log(`  Duration:        ${elapsed}s`);
  log(`  Output:          ${SCREENSHOT_DIR}/`);
  log(`  Manifest:        ${MANIFEST_FILE}`);
  log(`  Log:             ${LOG_FILE}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
