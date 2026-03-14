// pipeline/4-content.mjs — Extract structured website content from target leads
//
// Usage:
//   node pipeline/4-content.mjs
//   node pipeline/4-content.mjs --neighborhood salamanca
//   node pipeline/4-content.mjs -n retiro
//   node pipeline/4-content.mjs --lead <safeName>   # single lead (for testing)
//
// Input:  output/{neighborhood}/runs/{runId}/leads_audited.xlsx   (latest run)
// Output: output/{neighborhood}/leads/{safeName}/content.json
//         output/{neighborhood}/leads/{safeName}/logo.png  (if found)
//         output/{neighborhood}/logs/content_{YYYY-MM-DD}.log
//
// Extraction strategy:
//   1. Homepage: headings+content, paragraphs, testimonials, service lists, nav,
//      colors, social links, JSON-LD, OG tags, contact info
//   2. Up to 2 content subpages (scored from nav links): merge sections + paragraphs
//      Covers "productos", "actividades", "nosotros" etc. regardless of exact name

import 'dotenv/config';
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import pLimit from 'p-limit';
import { getNeighborhoodName, sanitizeName, getTargetLeads, findLogo, getNeighborhoodDirs, getLatestRunDir, logDate } from './utils.mjs';

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
const LOG_FILE    = `${dirs.logs}/content_${logDate()}.log`;
mkdirSync(dirs.logs, { recursive: true });
const CONCURRENCY  = 3;
const TIMEOUT_MS   = 20000;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const MAX_SUBPAGES = 2; // max additional pages to crawl per lead

// ── Subpage scoring keywords ──────────────────────────────────────────────────
// Any nav link whose path or text contains a CONTENT keyword gets a score > 0
// and becomes a subpage candidate. SKIP keywords exclude it entirely.
const SUBPAGE_CONTENT_KW = [
  // Services / products
  'servicio', 'service', 'producto', 'product', 'oferta', 'ofrecemos',
  'actividad', 'activity', 'que-hacemos', 'que_hacemos', 'solucio',
  'especialidad', 'specialty', 'trabajo', 'project', 'proyecto',
  'obra', 'instalacion', 'mantenimiento', 'reforma', 'taller',
  // Company / about
  'nosotros', 'about', 'empresa', 'quienes', 'historia', 'equipo',
  'team', 'acerca', 'sobre', 'mision', 'vision', 'valores',
  // Portfolio / cases
  'portfolio', 'galeria', 'gallery', 'caso', 'case', 'referencia',
  'cliente', 'client', 'realizacion', 'logro',
];
const SUBPAGE_SKIP_KW = [
  'contacto', 'contact', 'privacidad', 'privacy', 'legal', 'aviso',
  'cookie', 'politica', 'blog', 'noticia', 'news', 'articulo', 'post',
  'login', 'admin', 'acceder', 'registrar', 'tienda', 'shop', 'cart',
  'checkout', 'sitemap', 'mapa-web', 'lang=', '/en/', '/fr/', '/de/',
];

// Score nav links and return top candidates (same domain, content-rich, deduplicated)
function scoreNavLinks(navLinks, baseUrl) {
  let baseHostname;
  try { baseHostname = new URL(baseUrl).hostname; } catch { return []; }

  const seen = new Set([baseUrl]);
  return navLinks
    .map(({ href, text }) => {
      let abs;
      try { abs = new URL(href, baseUrl).href; } catch { return null; }
      // Same domain only, deduplicated
      try { if (new URL(abs).hostname !== baseHostname) return null; } catch { return null; }
      if (seen.has(abs)) return null;
      const pathAndText = (abs + ' ' + text).toLowerCase();
      if (SUBPAGE_SKIP_KW.some(k => pathAndText.includes(k))) return null;
      const score = SUBPAGE_CONTENT_KW.filter(k => pathAndText.includes(k)).length;
      if (score === 0) return null;
      seen.add(abs);
      return { href: abs, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

// ── CLI flags ─────────────────────────────────────────────────────────────────
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
  appendFileSync(LOG_FILE, line + '\n');
  console.error(`  ✗ ${msg}`);
}

// ── Page extraction — runs inside browser context ─────────────────────────────
// Passed to page.evaluate() for both homepage and subpages.
function extractPageData() {
  // ── Title & meta (with OG fallbacks) ───────────────────────────────────────
  const title =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.title || '';
  const metaDescription =
    document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('meta[name="twitter:description"]')?.content ||
    '';
  const metaKeywords =
    document.querySelector('meta[name="keywords"]')?.content || '';
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.content || '';

  // ── Navigation links — reveals site structure ───────────────────────────────
  const navLinks = [...document.querySelectorAll('nav a[href], header a[href], [class*="menu"] a[href]')]
    .map(a => ({ href: a.href || '', text: (a.innerText || a.title || '').trim() }))
    .filter(l => l.href && l.text && !l.href.startsWith('javascript:'));

  // ── Sections from headings ──────────────────────────────────────────────────
  const sections = [];
  document.querySelectorAll('h1, h2, h3').forEach(h => {
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

  // ── Body paragraphs — business copy beyond headings ────────────────────────
  // First 8 substantial <p> elements outside nav/header/footer/cookie banners
  const bodyParagraphs = [...document.querySelectorAll('p')]
    .filter(p => {
      const text = p.innerText?.trim() || '';
      return text.length > 80 &&
        !p.closest('nav') && !p.closest('header') && !p.closest('footer') &&
        !p.closest('[class*="cookie"]') && !p.closest('[class*="notice"]') &&
        !p.closest('[class*="alert"]');
    })
    .slice(0, 8)
    .map(p => p.innerText.trim());

  // ── Service / feature lists — <li> items outside nav ──────────────────────
  // Captures bullet-point service lists that don't appear under headings
  const serviceLists = [];
  document.querySelectorAll('ul, ol').forEach(list => {
    if (list.closest('nav') || list.closest('header') || list.closest('footer')) return;
    const items = [...list.querySelectorAll('li')]
      .map(li => li.innerText?.trim())
      .filter(t => t && t.length > 10 && t.length < 200);
    if (items.length >= 2) serviceLists.push(items);
  });

  // ── Testimonials / reviews ─────────────────────────────────────────────────
  const testimonials = [
    ...document.querySelectorAll(
      'blockquote, [class*="testimon"], [class*="review"], [class*="opinion"], [class*="valoracion"]'
    ),
  ]
    .map(el => el.innerText?.trim())
    .filter(t => t && t.length > 30)
    .slice(0, 5);

  // ── Partner / client names from image alt text ─────────────────────────────
  // Images near "clientes", "partners", "colaboradores" headings often have
  // company names in alt text — useful trust signals for the mockup
  const partnerNames = [];
  document.querySelectorAll('h2, h3, h4').forEach(h => {
    const hText = (h.innerText || '').toLowerCase();
    if (!/client|partner|colabor|asociad|confian|trabajan/.test(hText)) return;
    let el = h.nextElementSibling;
    let count = 0;
    while (el && count < 5) {
      el.querySelectorAll('img[alt]').forEach(img => {
        const alt = img.alt.trim();
        if (alt && alt.length > 2 && alt.length < 60) partnerNames.push(alt);
      });
      el = el.nextElementSibling;
      count++;
    }
  });

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footer = document.querySelector('footer');
  const footerText = footer ? footer.innerText?.trim().substring(0, 2000) : '';

  // ── JSON-LD structured data ────────────────────────────────────────────────
  const jsonLd = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try { jsonLd.push(JSON.parse(s.textContent)); } catch { /* malformed, skip */ }
  });

  // ── Social media links ─────────────────────────────────────────────────────
  const socialPatterns = {
    facebook:  /facebook\.com\/(?!sharer|share|dialog|tr)([^/?#\s"']+)/i,
    instagram: /instagram\.com\/([^/?#\s"']+)/i,
    twitter:   /(?:twitter|x)\.com\/([^/?#\s"']+)/i,
    linkedin:  /linkedin\.com\/(?:company|in)\/([^/?#\s"']+)/i,
    youtube:   /youtube\.com\/(?:channel|c|user|@)([^/?#\s"']+)/i,
  };
  const socialLinks = {};
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href || '';
    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      if (!socialLinks[platform] && pattern.test(href)) socialLinks[platform] = href;
    }
  });

  // ── Images — improved isLogo heuristic ────────────────────────────────────
  const images = [...document.querySelectorAll('img')]
    .filter(img => img.src && img.src.startsWith('http'))
    .map(img => {
      const srcLower = img.src.toLowerCase();
      const altLower = (img.alt || '').toLowerCase();
      const inHeader = img.closest('header') !== null;
      const inLogoContainer = img.closest('[class*="logo"], [id*="logo"]') !== null;
      const inHomeLink = img.closest('a[href="/"], a[href="./"], a[href="../"]') !== null;
      const w = img.naturalWidth || img.width || 0;
      const isSmallInHeader = inHeader && w >= 30 && w < 300;
      const isLogo = (srcLower.includes('logo') || altLower.includes('logo') ||
                      inLogoContainer || inHomeLink || isSmallInHeader) && w >= 30;
      return { src: img.src, alt: img.alt || '', width: w, height: img.naturalHeight || 0, isLogo };
    });

  // ── Colors — extended ──────────────────────────────────────────────────────
  const bodyStyle = getComputedStyle(document.body);
  const headerEl  = document.querySelector('header') || document.querySelector('nav');
  const linkEl    = document.querySelector('a');
  const btnEl     = document.querySelector(
    'button, .btn, .button, [class*="cta"], [class*="btn"], a[class*="btn"]'
  );
  const rootStyle  = getComputedStyle(document.documentElement);
  const primaryVar =
    rootStyle.getPropertyValue('--primary-color').trim() ||
    rootStyle.getPropertyValue('--brand-color').trim()   ||
    rootStyle.getPropertyValue('--color-primary').trim() ||
    rootStyle.getPropertyValue('--accent-color').trim()  ||
    rootStyle.getPropertyValue('--primary').trim()       || '';

  // ── Contact info ───────────────────────────────────────────────────────────
  const bodyText = document.body.innerText || '';
  const phoneRegex = /(?:\+34|0034)?\s*(?:6|7|8|9)\d{1,2}[\s.-]?\d{2,3}[\s.-]?\d{2,3}[\s.-]?\d{0,2}/g;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  return {
    title,
    metaDescription,
    metaKeywords,
    ogImage,
    navLinks,
    sections:      sections.slice(0, 20),
    bodyParagraphs,
    serviceLists:  serviceLists.slice(0, 10),
    testimonials,
    partnerNames:  [...new Set(partnerNames)].slice(0, 10),
    footerText,
    jsonLd,
    socialLinks,
    images,
    colors: {
      bodyBg:    bodyStyle.backgroundColor || '',
      headerBg:  headerEl ? getComputedStyle(headerEl).backgroundColor : '',
      linkColor: linkEl   ? getComputedStyle(linkEl).color             : '',
      buttonBg:  btnEl    ? getComputedStyle(btnEl).backgroundColor    : '',
      primaryVar,
    },
    contactInfo: {
      phones: [...new Set(bodyText.match(phoneRegex) || [])].slice(0, 5),
      emails: [...new Set(bodyText.match(emailRegex) || [])].slice(0, 5),
    },
  };
}

// ── Merge data from multiple pages (homepage + subpages) ──────────────────────
function mergePageData(pages) {
  const first = pages[0];
  const merged = { ...first };

  for (const page of pages.slice(1)) {
    // Merge sections: deduplicate by heading text
    const existingHeadings = new Set(merged.sections.map(s => s.heading));
    for (const s of page.sections) {
      if (!existingHeadings.has(s.heading)) {
        merged.sections.push(s);
        existingHeadings.add(s.heading);
      }
    }
    // Merge paragraphs: deduplicate by content
    const existingParas = new Set(merged.bodyParagraphs);
    for (const p of page.bodyParagraphs) {
      if (!existingParas.has(p)) { merged.bodyParagraphs.push(p); existingParas.add(p); }
    }
    // Merge service lists
    merged.serviceLists = [...(merged.serviceLists || []), ...(page.serviceLists || [])].slice(0, 10);
    // Merge testimonials
    merged.testimonials = [...new Set([...(merged.testimonials || []), ...(page.testimonials || [])])].slice(0, 5);
    // Merge partner names
    merged.partnerNames = [...new Set([...(merged.partnerNames || []), ...(page.partnerNames || [])])].slice(0, 10);
    // Merge social links (first found wins)
    for (const [k, v] of Object.entries(page.socialLinks || {})) {
      if (!merged.socialLinks[k]) merged.socialLinks[k] = v;
    }
    // Merge JSON-LD
    merged.jsonLd = [...(merged.jsonLd || []), ...(page.jsonLd || [])];
    // Merge contact info
    merged.contactInfo.phones = [...new Set([...merged.contactInfo.phones, ...page.contactInfo.phones])].slice(0, 5);
    merged.contactInfo.emails = [...new Set([...merged.contactInfo.emails, ...page.contactInfo.emails])].slice(0, 5);
    // Keep colors from first page (homepage is most representative)
  }

  return merged;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`);
    console.error(`        Run the auditor first: node pipeline/2-auditor.mjs --neighborhood ${NEIGHBORHOOD}`);
    process.exit(1);
  }

  const startTime = Date.now();
  let leads = await getTargetLeads(INPUT_FILE);

  if (LEAD_FILTER) {
    leads = leads.filter(l => sanitizeName(l.name) === LEAD_FILTER);
    if (leads.length === 0) {
      console.error(`[ERROR] No lead found matching --lead "${LEAD_FILTER}"`);
      process.exit(1);
    }
    log(`[LEAD] Single-lead mode: ${LEAD_FILTER}`);
  }

  log(`[INIT] Neighborhood: ${NEIGHBORHOOD}`);
  log(`[INIT] ${leads.length} target leads`);

  // Resume: count already-completed leads upfront
  let alreadyDone = 0;
  for (const lead of leads) {
    const contentPath = join(LEADS_DIR, sanitizeName(lead.name || 'unknown'), 'content.json');
    if (existsSync(contentPath)) {
      try {
        const existing = JSON.parse(readFileSync(contentPath, 'utf-8'));
        if (!existing.scrapeError) alreadyDone++;
      } catch { /* can't read, will re-scrape */ }
    }
  }
  if (alreadyDone > 0) log(`[RESUME] ${alreadyDone} leads already completed, will skip`);

  const browser = await puppeteer.launch({
    headless: 'shell',
    timeout: 60000,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const limiter = pLimit(CONCURRENCY);
  let completed = 0;
  let skipped   = 0;
  let errors    = 0;

  try {
    const tasks = leads.map(lead =>
      limiter(async () => {
        const name     = lead.name || 'unknown';
        const safeName = sanitizeName(name);
        const url      = lead.final_url || lead.website;
        const leadDir  = join(LEADS_DIR, safeName);
        const contentPath = join(leadDir, 'content.json');

        if (!url) {
          logError(`${name}: no URL available, skipping`);
          return;
        }

        // Resume: skip if content.json exists and was previously successful
        if (existsSync(contentPath)) {
          try {
            const existing = JSON.parse(readFileSync(contentPath, 'utf-8'));
            if (!existing.scrapeError) {
              skipped++;
              log(`[${completed + skipped}/${leads.length}] ↩ ${name} — already done, skipping`);
              return;
            }
          } catch { /* can't read existing, fall through to re-scrape */ }
        }

        mkdirSync(leadDir, { recursive: true });

        // Parse Outscraper emails — stored as JSON array string by stage 1
        let outscraperEmails = [];
        try { outscraperEmails = JSON.parse(lead.emails || '[]'); } catch { outscraperEmails = []; }

        const contentData = {
          name,
          safeName,
          url,
          tier:          lead.tier,
          score:         lead.opportunity_score,
          phone:         lead.phone         || '',
          category:      lead.category      || '',
          full_address:  lead.full_address  || lead.street ||
            [lead.city, lead.postal_code].filter(Boolean).join(', ') || '',
          rating:        lead.rating,
          reviews:       lead.reviews,
          pitch_angle:   lead.pitch_angle   || '',
          description:   lead.description   || '',  // Google Maps business description
          working_hours: lead.working_hours || '',  // JSON string from Outscraper
          cms_detected:  lead.cms_detected  || '',
          // Scraped data (populated below)
          title:          '',
          metaDescription: '',
          metaKeywords:   '',
          ogImage:        '',
          sections:       [],
          bodyParagraphs: [],
          serviceLists:   [],
          testimonials:   [],
          partnerNames:   [],
          footerText:     '',
          jsonLd:         [],
          socialLinks:    {},
          colors:         { bodyBg: '', headerBg: '', linkColor: '', buttonBg: '', primaryVar: '' },
          contactInfo: {
            phones: [],
            emails: outscraperEmails,
          },
          subpagesCrawled: [],
          logoUrl:     null,
          scrapeError: null,
        };

        let page;
        try {
          page = await browser.newPage();
          await page.setDefaultNavigationTimeout(TIMEOUT_MS);
          await page.setViewport({ width: 1440, height: 900 });

          // Navigate — domcontentloaded + fixed wait + one retry on failure
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
          } catch (navErr) {
            log(`[RETRY] ${name} — first navigation failed (${navErr.message?.substring(0, 60)}), retrying...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
          }
          await new Promise(r => setTimeout(r, 1500));

          // ── Extract homepage ────────────────────────────────────────────────
          const homeData = await page.evaluate(extractPageData);
          const allPageData = [homeData];

          // ── Crawl up to MAX_SUBPAGES content subpages ───────────────────────
          const subpageCandidates = scoreNavLinks(homeData.navLinks, url);
          for (const candidate of subpageCandidates.slice(0, MAX_SUBPAGES)) {
            try {
              await page.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
              await new Promise(r => setTimeout(r, 1000));
              const subData = await page.evaluate(extractPageData);
              allPageData.push(subData);
              contentData.subpagesCrawled.push(candidate.href);
            } catch (subErr) {
              log(`[SUBPAGE] ${name} — failed to crawl ${candidate.href}: ${subErr.message?.substring(0, 60)}`);
            }
          }

          // ── Merge all page data ─────────────────────────────────────────────
          const merged = mergePageData(allPageData);

          // Merge scraped emails with Outscraper emails
          const mergedEmails = [
            ...(contentData.contactInfo.emails || []),
            ...(merged.contactInfo?.emails || []),
          ].filter(Boolean);

          // Apply merged data to contentData (keep navLinks out — not needed downstream)
          const { contactInfo: _c, navLinks: _n, ...rest } = merged;
          Object.assign(contentData, rest);
          contentData.contactInfo.emails = [...new Set(mergedEmails)];
          contentData.contactInfo.phones = [...new Set([
            ...merged.contactInfo.phones,
          ])].slice(0, 5);

          // ── Find and download logo ──────────────────────────────────────────
          const logoImg = findLogo(merged.images);
          if (logoImg) {
            contentData.logoUrl = logoImg.src;
            try {
              const controller = new AbortController();
              const logoTimeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
              const resp = await fetch(logoImg.src, { signal: controller.signal });
              clearTimeout(logoTimeout);
              if (resp.ok) {
                writeFileSync(join(leadDir, 'logo.png'), Buffer.from(await resp.arrayBuffer()));
              }
            } catch { /* logo download failed, non-critical */ }
          }

          writeFileSync(contentPath, JSON.stringify(contentData, null, 2));

          completed++;
          const logoLabel    = contentData.logoUrl ? '✓logo' : '—logo';
          const colorLabel   = (contentData.colors.buttonBg || contentData.colors.primaryVar) ? '✓color' : '—color';
          const subCount     = contentData.subpagesCrawled.length;
          const sectionCount = contentData.sections.length;
          const paraCount    = contentData.bodyParagraphs.length;
          const emailCount   = contentData.contactInfo.emails.length;
          const socialCount  = Object.keys(contentData.socialLinks).length;
          const hasJsonLd    = contentData.jsonLd.length > 0;
          log(`[${completed + skipped}/${leads.length}] ✓ ${name} — ${sectionCount} sections, ${paraCount} paragraphs, +${subCount} subpages, ${logoLabel}, ${colorLabel}, ${emailCount} emails, ${socialCount} social${hasJsonLd ? ', ✓json-ld' : ''}`);
        } catch (err) {
          logError(`${name} (${url}): ${err.message || err}`);
          contentData.scrapeError = err.message || String(err);
          writeFileSync(contentPath, JSON.stringify(contentData, null, 2));
          completed++;
          errors++;
          log(`[${completed + skipped}/${leads.length}] ✗ ${name} — ${err.message?.substring(0, 80)}`);
        } finally {
          if (page) await page.close().catch(() => {});
        }
      })
    );

    await Promise.all(tasks);
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  log('\n═══════════════════════════════════════════');
  log('  CONTENT SCRAPE COMPLETE');
  log('═══════════════════════════════════════════');
  log(`  Neighborhood:     ${NEIGHBORHOOD}`);
  log(`  Leads total:      ${leads.length}`);
  log(`  Skipped (done):   ${skipped}`);
  log(`  Processed:        ${completed}`);
  log(`  Scraped OK:       ${completed - errors}`);
  log(`  Errors:           ${errors}`);
  log(`  Duration:         ${elapsed}s`);
  log(`  Output:           ${LEADS_DIR}/`);
  log(`  Log:              ${LOG_FILE}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
