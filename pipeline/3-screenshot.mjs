// screenshot.mjs — Mobile + Desktop screenshots of Tier 1 & high-score Tier 2 leads
//
// Usage:
//   node pipeline/3-screenshot.mjs
//   node pipeline/3-screenshot.mjs --neighborhood=salamanca
//   node pipeline/3-screenshot.mjs -n salamanca
import 'dotenv/config';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import pLimit from 'p-limit';
import { sanitizeName, getNeighborhoodName, getTargetLeads } from './utils.mjs';

const NEIGHBORHOOD = getNeighborhoodName();
const INPUT_FILE = `output/leads_audited_${NEIGHBORHOOD}.xlsx`;
const SCREENSHOT_DIR = `output/screenshots_${NEIGHBORHOOD}`;
const ERROR_LOG = `${SCREENSHOT_DIR}/errors.log`;
const MANIFEST_FILE = `${SCREENSHOT_DIR}/manifest.json`;
const CONCURRENCY = 3;
const TIMEOUT_MS = 20000;

// ── Helpers ─────────────────────────────────────────────────────────────────
function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(ERROR_LOG, line);
  console.error(`  ✗ ${msg}`);
}

async function createPlaceholder(filepath, text) {
  const svg = `<svg width="375" height="812" xmlns="http://www.w3.org/2000/svg">
    <rect width="375" height="812" fill="#e0e0e0"/>
    <text x="187" y="400" text-anchor="middle" font-family="Arial" font-size="18" fill="#666">${text}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filepath);
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
  const leads = await getTargetLeads(INPUT_FILE, 50);
  console.log(`[SCREENSHOT] ${leads.length} target leads (Tier 1 + Tier 2 score>=50)`);

  // Clear error log
  writeFileSync(ERROR_LOG, '');

  const browser = await puppeteer.launch({
    headless: 'shell',
    timeout: 60000,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const limit = pLimit(CONCURRENCY);
  const manifest = [];
  let completed = 0;

  const tasks = leads.map(lead =>
    limit(async () => {
      const name = lead.name || 'unknown';
      const safeName = sanitizeName(name);
      const url = lead.final_url || lead.website;
      const mobilePath = `${SCREENSHOT_DIR}/${safeName}_mobile.png`;
      const desktopPath = `${SCREENSHOT_DIR}/${safeName}_desktop.png`;

      const entry = {
        name,
        safeName,
        url,
        tier: lead.tier,
        score: lead.opportunity_score,
        mobilePath,
        desktopPath,
        phone: lead.phone || '',
        category: lead.category || '',
        full_address: lead.full_address || '',
        pitch_angle: lead.pitch_angle || '',
        success: false,
      };

      let page;
      try {
        page = await browser.newPage();
        await page.setDefaultNavigationTimeout(TIMEOUT_MS);

        // Block heavy resources to speed up screenshots
        await page.setRequestInterception(true);
        page.on('request', req => {
          const type = req.resourceType();
          if (['media', 'font'].includes(type)) {
            req.abort();
          } else {
            req.continue();
          }
        });

        // Navigate
        await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });

        // Dismiss common cookie/consent banners
        try {
          await page.evaluate(() => {
            const selectors = [
              '[class*="cookie"] button',
              '[class*="consent"] button',
              '[id*="cookie"] button',
              '[class*="Cookie"] button',
              'button[class*="accept"]',
              'button[id*="accept"]',
              '.cc-btn',
              '#onetrust-accept-btn-handler',
            ];
            for (const sel of selectors) {
              const btn = document.querySelector(sel);
              if (btn) { btn.click(); break; }
            }
          });
          await new Promise(r => setTimeout(r, 500));
        } catch { /* ignore cookie dismissal errors */ }

        // Mobile screenshot
        await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
        await new Promise(r => setTimeout(r, 1000)); // let reflow settle
        await page.screenshot({ path: mobilePath, fullPage: false });

        // Desktop screenshot
        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: desktopPath, fullPage: false });

        entry.success = true;
        completed++;
        console.log(`[${completed}/${leads.length}] ✓ ${name} — ${url}`);
      } catch (err) {
        const msg = `${name} (${url}): ${err.message || err}`;
        logError(msg);

        // Create placeholder images
        try {
          if (!existsSync(mobilePath)) {
            await createPlaceholder(mobilePath, 'Sitio web no disponible');
          }
          if (!existsSync(desktopPath)) {
            await createPlaceholder(desktopPath, 'Sitio web no disponible');
          }
        } catch (placeholderErr) {
          logError(`Placeholder creation failed for ${name}: ${placeholderErr.message}`);
        }

        completed++;
        console.log(`[${completed}/${leads.length}] ✗ ${name} — ERROR: ${err.message?.substring(0, 80)}`);
      } finally {
        if (page) await page.close().catch(() => {});
      }

      manifest.push(entry);
    })
  );

  await Promise.all(tasks);
  await browser.close();

  // Write manifest
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const successCount = manifest.filter(e => e.success).length;
  console.log('\n═══════════════════════════════════════════');
  console.log('  SCREENSHOTS COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Leads processed:  ${leads.length}`);
  console.log(`  Screenshots OK:   ${successCount}`);
  console.log(`  Errors:           ${leads.length - successCount}`);
  console.log(`  Duration:         ${elapsed}s`);
  console.log(`  Output:           ${SCREENSHOT_DIR}/`);
  console.log(`  Manifest:         ${MANIFEST_FILE}`);
  console.log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
