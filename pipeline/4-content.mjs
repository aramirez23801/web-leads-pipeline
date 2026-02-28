// pipeline/4-content.mjs — Extract structured website content from target leads
//
// Usage:
//   node pipeline/4-content.mjs
//   node pipeline/4-content.mjs --neighborhood salamanca
//   node pipeline/4-content.mjs -n retiro

import 'dotenv/config';
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import pLimit from 'p-limit';
import { getNeighborhoodName, sanitizeName, getTargetLeads, findLogo } from './utils.mjs';

const NEIGHBORHOOD = getNeighborhoodName();
const INPUT_FILE = `output/leads_audited_${NEIGHBORHOOD}.xlsx`;
const CONTENT_DIR = `output/content_${NEIGHBORHOOD}`;
const CONCURRENCY = 3;
const TIMEOUT_MS = 20000;

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`);
    console.error(`        Run the auditor first: node pipeline/2-auditor.mjs --neighborhood ${NEIGHBORHOOD}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const leads = getTargetLeads(INPUT_FILE);
  console.log(`[SCRAPE] Neighborhood: ${NEIGHBORHOOD}`);
  console.log(`[SCRAPE] ${leads.length} target leads`);

  const browser = await puppeteer.launch({
    headless: 'shell',
    timeout: 60000,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const limit = pLimit(CONCURRENCY);
  const allContent = [];
  let completed = 0;

  const tasks = leads.map(lead =>
    limit(async () => {
      const name = lead.name || 'unknown';
      const safeName = sanitizeName(name);
      const url = lead.final_url || lead.website;
      const leadDir = join(CONTENT_DIR, safeName);
      const imagesDir = join(leadDir, 'images');
      mkdirSync(imagesDir, { recursive: true });

      const contentData = {
        name,
        safeName,
        url,
        tier: lead.tier,
        score: lead.opportunity_score,
        phone: lead.phone || '',
        category: lead.category || '',
        full_address: lead.full_address || lead.street ||
          [lead.city, lead.postal_code].filter(Boolean).join(', ') || '',
        rating: lead.rating,
        reviews: lead.reviews,
        pitch_angle: lead.pitch_angle || '',
        // Scraped data
        title: '',
        metaDescription: '',
        sections: [],
        footerText: '',
        images: [],
        colors: { bodyBg: '', headerBg: '', linkColor: '' },
        contactInfo: {
          phones: [],
          emails: lead.emails
            ? String(lead.emails).split(',').map(e => e.trim()).filter(Boolean)
            : [],
        },
        logoUrl: null,
        scrapeError: null,
      };

      let page;
      try {
        page = await browser.newPage();
        await page.setDefaultNavigationTimeout(TIMEOUT_MS);
        await page.setViewport({ width: 1440, height: 900 });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });

        // Extract content via page.evaluate
        const extracted = await page.evaluate(() => {
          // Title & meta
          const title = document.title || '';
          const metaDesc = document.querySelector('meta[name="description"]')?.content || '';

          // Sections from headings
          const sections = [];
          const headings = document.querySelectorAll('h1, h2, h3');
          headings.forEach(h => {
            const text = h.innerText?.trim();
            if (!text) return;
            let siblingText = '';
            let sibling = h.nextElementSibling;
            let count = 0;
            while (sibling && !['H1', 'H2', 'H3'].includes(sibling.tagName) && count < 10) {
              const t = sibling.innerText?.trim();
              if (t) siblingText += t + '\n';
              sibling = sibling.nextElementSibling;
              count++;
            }
            sections.push({ heading: text, content: siblingText.trim() });
          });

          // Footer
          const footer = document.querySelector('footer');
          const footerText = footer ? footer.innerText?.trim() : '';

          // Images
          const images = [...document.querySelectorAll('img')]
            .filter(img => img.src && img.src.startsWith('http'))
            .map(img => ({
              src: img.src,
              alt: img.alt || '',
              width: img.naturalWidth || 0,
              height: img.naturalHeight || 0,
              isLogo: (img.src.toLowerCase().includes('logo') ||
                       img.alt.toLowerCase().includes('logo') ||
                       img.closest('header') !== null),
            }));

          // Colors
          const body = getComputedStyle(document.body);
          const bgColor = body.backgroundColor;
          const headerEl = document.querySelector('header') || document.querySelector('nav');
          const headerBg = headerEl ? getComputedStyle(headerEl).backgroundColor : '';
          const linkEl = document.querySelector('a');
          const linkColor = linkEl ? getComputedStyle(linkEl).color : '';

          // Contact info
          const bodyText = document.body.innerText || '';
          const phoneRegex = /(?:\+34|0034)?\s*(?:6|7|8|9)\d{1,2}[\s.-]?\d{2,3}[\s.-]?\d{2,3}[\s.-]?\d{0,2}/g;
          const phones = [...new Set(bodyText.match(phoneRegex) || [])];
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const emails = [...new Set(bodyText.match(emailRegex) || [])];

          return {
            title,
            metaDescription: metaDesc,
            sections: sections.slice(0, 20), // cap at 20 sections
            footerText: footerText.substring(0, 2000),
            images,
            colors: { bodyBg: bgColor, headerBg, linkColor },
            contactInfo: { phones: phones.slice(0, 5), emails: emails.slice(0, 5) },
          };
        });

        Object.assign(contentData, extracted);

        // Find logo using utils (skips CDN domains)
        const logoImg = findLogo(extracted.images);
        if (logoImg) {
          contentData.logoUrl = logoImg.src;
          try {
            const resp = await fetch(logoImg.src);
            if (resp.ok) {
              const buffer = Buffer.from(await resp.arrayBuffer());
              writeFileSync(join(leadDir, 'logo.png'), buffer);
            }
          } catch { /* logo download failed, non-critical */ }
        }

        // Download up to 5 largest non-logo images
        const nonLogoImages = extracted.images
          .filter(i => !i.isLogo && i.width > 50 && i.height > 50)
          .sort((a, b) => (b.width * b.height) - (a.width * a.height))
          .slice(0, 5);

        for (let idx = 0; idx < nonLogoImages.length; idx++) {
          try {
            const resp = await fetch(nonLogoImages[idx].src);
            if (resp.ok) {
              const buffer = Buffer.from(await resp.arrayBuffer());
              const ext = nonLogoImages[idx].src.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)?.[1] || 'png';
              writeFileSync(join(imagesDir, `image_${idx + 1}.${ext}`), buffer);
            }
          } catch { /* image download failed, non-critical */ }
        }

        // Write content.json
        writeFileSync(join(leadDir, 'content.json'), JSON.stringify(contentData, null, 2));

        completed++;
        console.log(`[${completed}/${leads.length}] ✓ ${name} — ${extracted.sections.length} sections, ${extracted.images.length} images, ${extracted.contactInfo.phones.length} phones`);
      } catch (err) {
        contentData.scrapeError = err.message || String(err);
        writeFileSync(join(leadDir, 'content.json'), JSON.stringify(contentData, null, 2));

        completed++;
        console.log(`[${completed}/${leads.length}] ✗ ${name} — ERROR: ${err.message?.substring(0, 80)}`);
      } finally {
        if (page) await page.close().catch(() => {});
      }

      allContent.push(contentData);
    })
  );

  await Promise.all(tasks);
  await browser.close();

  // Write combined JSON
  writeFileSync(join(CONTENT_DIR, 'all_content.json'), JSON.stringify(allContent, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const successCount = allContent.filter(c => !c.scrapeError).length;
  console.log('\n═══════════════════════════════════════════');
  console.log('  CONTENT SCRAPE COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Neighborhood:     ${NEIGHBORHOOD}`);
  console.log(`  Leads processed:  ${leads.length}`);
  console.log(`  Scraped OK:       ${successCount}`);
  console.log(`  Errors:           ${leads.length - successCount}`);
  console.log(`  Duration:         ${elapsed}s`);
  console.log(`  Output:           ${CONTENT_DIR}/`);
  console.log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
