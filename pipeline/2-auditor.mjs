// pipeline/2-auditor.mjs — Website audit pipeline for Outscraper leads
// Crawls business websites, applies technical filters, scores & tiers leads.
//
// Usage:
//   node pipeline/2-auditor.mjs [--neighborhood <name>] [--limit <n>] [--force]
//   node pipeline/2-auditor.mjs -n retiro --limit 10   # audit retiro, first 10 domains
//   node pipeline/2-auditor.mjs --force                # bypass cache (re-crawl everything)
//
// Input:  output/businesses_{neighborhood}.xlsx
// Output: output/leads_audited_{neighborhood}.xlsx
//         output/outreach_{neighborhood}.xlsx
// Cache:  output/crawl_cache_{neighborhood}.json
// Log:    output/auditor_{neighborhood}.log

import 'dotenv/config';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { load } from 'cheerio';
import pLimit from 'p-limit';
import ExcelJS from 'exceljs';
import { getNeighborhoodName } from './utils.mjs';

// ── Config ──────────────────────────────────────────────────────────────────
const NEIGHBORHOOD  = getNeighborhoodName();
const INPUT_FILE    = `output/businesses_${NEIGHBORHOOD}.xlsx`;
const OUTPUT_FILE   = `output/leads_audited_${NEIGHBORHOOD}.xlsx`;
const OUTREACH_FILE = `output/outreach_${NEIGHBORHOOD}.xlsx`;
const CACHE_FILE    = `output/crawl_cache_${NEIGHBORHOOD}.json`;
const LOG_FILE      = `output/auditor_${NEIGHBORHOOD}.log`;
const CONCURRENCY   = 5;
const DELAY_MS      = 200;
const TIMEOUT_MS    = 15000;

// Parse CLI flags
function parseCli() {
  const args = process.argv.slice(2);
  let limit = 0;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--neighborhood' || a === '-n') { i++; continue; }
    if ((a === '--limit' || a === '-l') && args[i + 1]) { limit = parseInt(args[++i], 10); continue; }
    if (a === '--force') { force = true; continue; }
    // Legacy: bare number as positional limit argument
    if (/^\d+$/.test(a)) { limit = parseInt(a, 10); continue; }
  }
  return { limit, force };
}
const { limit: LIMIT, force: FORCE_CACHE } = parseCli();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Logger ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

// ── Step 1: Read the XLSX ───────────────────────────────────────────────────
async function readInputXlsx() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`);
    console.error(`        Run the scraper first: node pipeline/1-scraper.mjs --neighborhood ${NEIGHBORHOOD}`);
    process.exit(1);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(INPUT_FILE);
  const worksheet = workbook.getWorksheet('Businesses');
  if (!worksheet) throw new Error('Sheet "Businesses" not found in input XLSX');

  const headers = [];
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // row.values is 1-indexed; index 0 is undefined
      headers.push(...row.values.slice(1));
      return;
    }
    const obj = {};
    headers.forEach((header, i) => {
      if (header) obj[header] = row.getCell(i + 1).value ?? null;
    });
    rows.push(obj);
  });

  log(`[INIT] Read ${rows.length} rows from ${INPUT_FILE}`);
  return rows;
}

// ── Step 2: Normalize URLs ──────────────────────────────────────────────────
function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let url = raw.trim();
  try { url = decodeURIComponent(url); } catch { /* already decoded */ }
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) url = url.substring(0, qIdx);
  const hIdx = url.indexOf('#');
  if (hIdx !== -1) url = url.substring(0, hIdx);
  url = url.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

function extractHostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

// ── Step 3: Deduplicate by domain ───────────────────────────────────────────
function deduplicateByDomain(businesses) {
  const domainMap = new Map();
  for (const biz of businesses) {
    const cleaned = normalizeUrl(biz.website);
    if (!cleaned) continue;
    const hostname = extractHostname(cleaned);
    if (!hostname) continue;
    biz._cleaned_url = cleaned;
    biz._hostname = hostname;
    if (!domainMap.has(hostname)) {
      domainMap.set(hostname, { url: cleaned, businesses: [] });
    }
    domainMap.get(hostname).businesses.push(biz);
  }
  return domainMap;
}

// ── Step 4: Crawl each homepage ─────────────────────────────────────────────
async function crawlUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const fetchStart = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    const response_time_ms = Date.now() - fetchStart;
    clearTimeout(timer);

    const finalUrl = response.url;
    const status = response.status;

    if (status < 200 || status >= 400) {
      return { crawl_error: `http_${status}`, final_url: finalUrl, html: null, status, response_time_ms };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { crawl_error: 'not_html', final_url: finalUrl, html: null, status, response_time_ms };
    }

    const html = await response.text();
    return { crawl_error: null, final_url: finalUrl, html, status, response_time_ms };
  } catch (err) {
    clearTimeout(timer);
    const response_time_ms = Date.now() - fetchStart;
    const msg = err.message || String(err);
    if (err.name === 'AbortError' || msg.includes('aborted')) {
      return { crawl_error: 'timeout', final_url: url, html: null, status: null, response_time_ms };
    }
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return { crawl_error: 'dns_fail', final_url: url, html: null, status: null, response_time_ms };
    }
    if (msg.includes('ECONNREFUSED')) {
      return { crawl_error: 'connection_refused', final_url: url, html: null, status: null, response_time_ms };
    }
    if (msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
      return { crawl_error: 'connection_reset', final_url: url, html: null, status: null, response_time_ms };
    }
    if (msg.includes('CERT') || msg.includes('SSL') || msg.includes('certificate')) {
      return { crawl_error: 'ssl_error', final_url: url, html: null, status: null, response_time_ms };
    }
    return { crawl_error: msg.substring(0, 120), final_url: url, html: null, status: null, response_time_ms };
  }
}

// ── Step 5: Apply the filters ───────────────────────────────────────────────
function analyzeHtml(html, finalUrl) {
  const $ = load(html);

  // FILTER 1: Missing viewport
  const missing_viewport = $('meta[name="viewport"]').length === 0;

  // FILTER 2: SSL — if final URL is already https, no extra request needed
  const no_ssl = finalUrl.startsWith('http://');

  // FILTER 3: Copyright year
  const bodyText  = $('body').text() || '';
  const footerText = $('footer').text() || '';
  const combinedText = footerText + ' ' + bodyText;

  let latestCopyrightYear = null;

  const copyrightPattern = /(?:©|&copy;|copyright)\s*((?:19|20)\d{2})/gi;
  for (const m of combinedText.matchAll(copyrightPattern)) {
    const y = parseInt(m[1], 10);
    if (!latestCopyrightYear || y > latestCopyrightYear) latestCopyrightYear = y;
  }

  // Note: copyright symbol is required (no ?) to avoid false positives on year ranges
  // that appear in body text unrelated to copyright (e.g. "2019-2024 season stats").
  const rangePattern = /(?:©|&copy;|copyright)\s*(?:19|20)\d{2}\s*[-–—]\s*((?:19|20)\d{2})/gi;
  for (const m of combinedText.matchAll(rangePattern)) {
    const y = parseInt(m[1], 10);
    if (!latestCopyrightYear || y > latestCopyrightYear) latestCopyrightYear = y;
  }

  const currentYear = new Date().getFullYear();
  const outdated_copyright = latestCopyrightYear !== null && latestCopyrightYear < (currentYear - 2);
  const copyright_year = latestCopyrightYear;

  // FILTER 4: Dead HTML tags
  const deadTagList = ['frameset', 'frame', 'center', 'font', 'marquee', 'blink', 'applet'];
  const foundDeadTags = deadTagList.filter(tag => $(tag).length > 0);
  const has_dead_tags = foundDeadTags.length > 0;
  const dead_tags_found = foundDeadTags.join(', ');

  // FILTER 5: Image count (retained as informational, not scored — slow_response replaced heavy_page)
  const imageCount = $('img').length;

  // FILTER 6: SEO basics
  const missing_h1          = $('h1').length === 0;
  const missing_meta_desc   = $('meta[name="description"]').length === 0;
  const rawTitle            = $('title').first().text().trim();
  const GENERIC_TITLES      = ['home', 'inicio', 'bienvenido', 'bienvenida', 'welcome', 'index', ''];
  const weak_title          = GENERIC_TITLES.includes(rawTitle.toLowerCase());
  const page_title          = rawTitle || null;

  // FILTER 7: CMS detection (from HTML patterns — zero extra requests)
  let cms_detected = null;
  const htmlLower = html.toLowerCase();
  const generatorMeta = $('meta[name="generator"]').attr('content') || '';
  if (/wix\.com|wixstatic\.com/.test(htmlLower) || /wix/i.test(generatorMeta)) {
    cms_detected = 'wix';
  } else if (/squarespace\.com/.test(htmlLower) || /squarespace/i.test(generatorMeta)) {
    cms_detected = 'squarespace';
  } else if (/webflow\.com|\.wf-/.test(htmlLower)) {
    cms_detected = 'webflow';
  } else if (/jimdo\.com/.test(htmlLower) || /jimdo/i.test(generatorMeta)) {
    cms_detected = 'jimdo';
  } else if (/1and1\.com|mywebsite\.com|ionos\.com/.test(htmlLower)) {
    cms_detected = 'ionos';
  } else if (/wp-content\/|wp-includes\//.test(htmlLower)) {
    // Distinguish maintained WordPress (premium builder) from bare/neglected installs
    const hasPremiumBuilder = /elementor|et-pb|divi|vc_row|fl-builder/.test(htmlLower);
    cms_detected = hasPremiumBuilder ? 'wordpress-builder' : 'wordpress';
  }

  return {
    missing_viewport,
    no_ssl,
    copyright_year,
    outdated_copyright,
    has_dead_tags,
    dead_tags_found,
    image_count: imageCount,
    missing_h1,
    missing_meta_desc,
    weak_title,
    page_title,
    cms_detected,
  };
}

// ── Step 6: Score and tier ──────────────────────────────────────────────────
function scoreResult(result, reviewCount = 0) {
  let score = 0;

  // Dead / unreachable site — always Tier 1 territory
  if (result.crawl_error === 'dns_fail' || result.crawl_error === 'connection_refused') {
    score += 60; // Tier 1 directly: dead website = zero web presence
  } else if (result.crawl_error === 'timeout' || result.crawl_error === 'connection_reset') {
    score += 35;
  } else if (result.crawl_error) {
    score += 20;
  }

  // Technical failures
  if (result.missing_viewport)   score += 40; // Not mobile-responsive — Google penalises this
  if (result.no_ssl)             score += 25; // Browsers show "Not Secure"
  if (result.outdated_copyright) score += 15; // Site not maintained in 2+ years
  if (result.has_dead_tags)      score += 10; // 1990s/2000s HTML relics
  // response_time_ms: slow site is a real problem
  if (result.response_time_ms != null && result.response_time_ms > 3000) score += 15;

  // SEO basics — each absence signals neglect
  if (result.missing_h1)        score += 10; // No H1 = broken SEO structure
  if (result.missing_meta_desc) score += 8;  // No meta description = neglected SEO
  if (result.weak_title)        score += 7;  // "Home" or blank title = owner never configured it

  // Cap before applying multiplier
  score = Math.min(score, 100);

  // Review multiplier — popular businesses are worth more effort
  const reviews = typeof reviewCount === 'number' ? reviewCount : parseFloat(reviewCount) || 0;
  const multiplier = reviews >= 50 ? 1.2 : reviews >= 10 ? 1.1 : 1.0;

  return Math.round(Math.min(score * multiplier, 100));
}

function assignTier(score) {
  if (score >= 60) return 1;
  if (score >= 35) return 2;
  if (score >= 15) return 3;
  return 4;
}

// ── Pitch angle ─────────────────────────────────────────────────────────────
function generatePitch(result) {
  if (result.crawl_error === 'dns_fail' || result.crawl_error === 'connection_refused') {
    return 'Website is completely down/dead. Needs a new website immediately.';
  }
  if (result.crawl_error === 'timeout' || result.crawl_error === 'connection_reset') {
    return 'Website is extremely slow/broken. Losing customers to load times.';
  }
  if (result.crawl_error === 'ssl_error') {
    return 'Website has SSL certificate errors. Browsers show security warnings to visitors.';
  }
  if (result.crawl_error && result.crawl_error.startsWith('http_')) {
    return `Website returns error (${result.crawl_error}). Visitors see an error page.`;
  }
  if (result.crawl_error) {
    return `Website has connectivity issues (${result.crawl_error}). Potential visitors can't access it.`;
  }

  const issues = [];
  if (result.missing_viewport)   issues.push('not mobile-responsive (penalized by Google)');
  if (result.no_ssl)             issues.push('marked as "Not Secure" by browsers (losing trust)');
  if (result.outdated_copyright) issues.push(`site content outdated since ${result.copyright_year}`);
  if (result.has_dead_tags)      issues.push('built with obsolete technology from 10+ years ago');
  if (result.response_time_ms != null && result.response_time_ms > 3000) {
    issues.push(`very slow load time (${result.response_time_ms}ms)`);
  }
  if (result.missing_h1)        issues.push('no H1 heading (broken SEO structure)');
  if (result.missing_meta_desc) issues.push('no meta description (missing from Google previews)');
  if (result.weak_title)        issues.push('generic/blank page title (invisible to search engines)');

  if (issues.length === 0) return 'Site appears modern. Low priority.';
  return `Website has ${issues.length} technical issue${issues.length > 1 ? 's' : ''}: ${issues.join('; ')}.`;
}

// ── Cache management ────────────────────────────────────────────────────────
function loadCache() {
  if (!existsSync(CACHE_FILE)) return new Map();
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache), null, 2));
}

// ── Progress logging ────────────────────────────────────────────────────────
function logProgress(idx, total, hostname, result) {
  const score = result.opportunity_score;
  const tier  = result.tier;
  if (result.crawl_error) {
    log(`[${idx}/${total}] ✗ ${hostname} — ERROR: ${result.crawl_error} → Score: ${score} (Tier ${tier})`);
  } else {
    const vp  = result.missing_viewport ? 'MISSING' : 'OK';
    const ssl = result.no_ssl ? 'MISSING' : 'OK';
    const cr  = result.copyright_year || 'N/A';
    const dt  = result.dead_tags_found || 'NONE';
    const ms  = result.response_time_ms != null ? `${result.response_time_ms}ms` : 'N/A';
    const cms = result.cms_detected || '';
    const seo = [
      result.missing_h1 ? 'no-h1' : '',
      result.missing_meta_desc ? 'no-meta' : '',
      result.weak_title ? 'weak-title' : '',
    ].filter(Boolean).join(',') || 'OK';
    log(`[${idx}/${total}] ✓ ${hostname} — viewport:${vp} ssl:${ssl} copyright:${cr} dead_tags:${dt} response:${ms} seo:${seo}${cms ? ` cms:${cms}` : ''} → Score: ${score} (Tier ${tier})`);
  }
}

// ── Build output row ────────────────────────────────────────────────────────
function buildOutputRow(biz, domainResult) {
  return {
    // Scoring
    tier:               `Tier ${domainResult.tier}`,
    opportunity_score:  domainResult.opportunity_score,
    // Stage 1 identity fields
    distance_meters:    biz.distance_meters ?? '',
    name:               biz.name ?? '',
    website:            biz._cleaned_url ?? biz.website ?? '',
    phone:              biz.phone ?? '',
    category:           biz.category ?? '',
    subtypes:           biz.subtypes ?? '',
    full_address:       biz.full_address ?? '',
    street:             biz.street ?? '',
    city:               biz.city ?? '',
    postal_code:        biz.postal_code ?? '',
    county:             biz.county ?? '',
    country_code:       biz.country_code ?? '',
    emails:             biz.emails ?? '',
    rating:             biz.rating ?? '',
    reviews:            biz.reviews ?? '',
    verified:           biz.verified ?? '',
    photos_count:       biz.photos_count ?? '',
    located_in:         biz.located_in ?? '',
    latitude:           biz.latitude ?? '',
    longitude:          biz.longitude ?? '',
    place_id:           biz.place_id ?? '',
    google_id:          biz.google_id ?? '',
    business_status:    biz.business_status ?? '',
    description:        biz.description ?? '',
    working_hours:      biz.working_hours ?? '',
    // Crawl analysis
    missing_viewport:   domainResult.missing_viewport ? 'TRUE' : 'FALSE',
    no_ssl:             domainResult.no_ssl ? 'TRUE' : 'FALSE',
    copyright_year:     domainResult.copyright_year ?? 'not found',
    outdated_copyright: domainResult.outdated_copyright ? 'TRUE' : 'FALSE',
    has_dead_tags:      domainResult.has_dead_tags ? 'TRUE' : 'FALSE',
    dead_tags_found:    domainResult.dead_tags_found ?? '',
    image_count:        domainResult.image_count ?? 0,
    response_time_ms:   domainResult.response_time_ms ?? '',
    missing_h1:         domainResult.missing_h1 ? 'TRUE' : 'FALSE',
    missing_meta_desc:  domainResult.missing_meta_desc ? 'TRUE' : 'FALSE',
    weak_title:         domainResult.weak_title ? 'TRUE' : 'FALSE',
    page_title:         domainResult.page_title ?? '',
    cms_detected:       domainResult.cms_detected ?? '',
    crawl_error:        domainResult.crawl_error ?? '',
    final_url:          domainResult.final_url ?? '',
    // Reserved for v2 LLM visual scoring (always null until implemented)
    design_score:       null,
    design_weakness:    null,
    // Pitch
    pitch_angle:        domainResult.pitch_angle ?? '',
  };
}

// ── Write main audited XLSX ─────────────────────────────────────────────────
async function writeOutputXlsx(allRows, tierCounts, stats) {
  const sorted = [...allRows].sort((a, b) => {
    const scoreDiff = (b.opportunity_score || 0) - (a.opportunity_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const dA = typeof a.distance_meters === 'number' ? a.distance_meters : 999999;
    const dB = typeof b.distance_meters === 'number' ? b.distance_meters : 999999;
    return dA - dB;
  });

  const LEAD_COLUMNS = [
    { header: 'tier',               key: 'tier',               width: 8  },
    { header: 'opportunity_score',  key: 'opportunity_score',  width: 16 },
    { header: 'distance_meters',    key: 'distance_meters',    width: 15 },
    { header: 'name',               key: 'name',               width: 35 },
    { header: 'website',            key: 'website',            width: 40 },
    { header: 'phone',              key: 'phone',              width: 18 },
    { header: 'category',           key: 'category',           width: 25 },
    { header: 'subtypes',           key: 'subtypes',           width: 30 },
    { header: 'full_address',       key: 'full_address',       width: 50 },
    { header: 'street',             key: 'street',             width: 40 },
    { header: 'city',               key: 'city',               width: 15 },
    { header: 'postal_code',        key: 'postal_code',        width: 12 },
    { header: 'county',             key: 'county',             width: 20 },
    { header: 'country_code',       key: 'country_code',       width: 12 },
    { header: 'emails',             key: 'emails',             width: 40 },
    { header: 'rating',             key: 'rating',             width: 8  },
    { header: 'reviews',            key: 'reviews',            width: 10 },
    { header: 'verified',           key: 'verified',           width: 10 },
    { header: 'photos_count',       key: 'photos_count',       width: 12 },
    { header: 'located_in',         key: 'located_in',         width: 25 },
    { header: 'latitude',           key: 'latitude',           width: 12 },
    { header: 'longitude',          key: 'longitude',          width: 12 },
    { header: 'place_id',           key: 'place_id',           width: 30 },
    { header: 'google_id',          key: 'google_id',          width: 25 },
    { header: 'business_status',    key: 'business_status',    width: 18 },
    { header: 'description',        key: 'description',        width: 60 },
    { header: 'working_hours',      key: 'working_hours',      width: 40 },
    { header: 'missing_viewport',   key: 'missing_viewport',   width: 16 },
    { header: 'no_ssl',             key: 'no_ssl',             width: 8  },
    { header: 'copyright_year',     key: 'copyright_year',     width: 15 },
    { header: 'outdated_copyright', key: 'outdated_copyright', width: 18 },
    { header: 'has_dead_tags',      key: 'has_dead_tags',      width: 12 },
    { header: 'dead_tags_found',    key: 'dead_tags_found',    width: 20 },
    { header: 'image_count',        key: 'image_count',        width: 12 },
    { header: 'response_time_ms',   key: 'response_time_ms',   width: 16 },
    { header: 'missing_h1',         key: 'missing_h1',         width: 12 },
    { header: 'missing_meta_desc',  key: 'missing_meta_desc',  width: 16 },
    { header: 'weak_title',         key: 'weak_title',         width: 12 },
    { header: 'page_title',         key: 'page_title',         width: 40 },
    { header: 'cms_detected',       key: 'cms_detected',       width: 20 },
    { header: 'crawl_error',        key: 'crawl_error',        width: 25 },
    { header: 'final_url',          key: 'final_url',          width: 40 },
    { header: 'design_score',       key: 'design_score',       width: 12 },
    { header: 'design_weakness',    key: 'design_weakness',    width: 50 },
    { header: 'pitch_angle',        key: 'pitch_angle',        width: 60 },
  ];

  const workbook = new ExcelJS.Workbook();

  const ws1 = workbook.addWorksheet('All Leads');
  ws1.columns = LEAD_COLUMNS;
  ws1.addRows(sorted);

  const ws2 = workbook.addWorksheet('Tier 1 Hot Leads');
  ws2.columns = LEAD_COLUMNS.map(c => ({ ...c }));
  ws2.addRows(sorted.filter(r => r.tier === 'Tier 1'));

  const ws3 = workbook.addWorksheet('Tier 2 Warm Leads');
  ws3.columns = LEAD_COLUMNS.map(c => ({ ...c }));
  ws3.addRows(sorted.filter(r => r.tier === 'Tier 2'));

  const ws4 = workbook.addWorksheet('Summary');
  ws4.columns = [
    { header: 'Metric', key: 'metric', width: 35 },
    { header: 'Value',  key: 'value',  width: 20 },
  ];
  ws4.addRows([
    { metric: 'Total businesses audited',    value: stats.totalBusinesses },
    { metric: 'Total unique domains crawled', value: stats.totalDomains },
    { metric: 'Cache hits (skipped)',         value: stats.cacheHits },
    { metric: 'Crawl success rate',           value: `${stats.successRate}%` },
    { metric: 'Tier 1 (HOT) count',           value: tierCounts[1] || 0 },
    { metric: 'Tier 2 (WARM) count',          value: tierCounts[2] || 0 },
    { metric: 'Tier 3 (COOL) count',          value: tierCounts[3] || 0 },
    { metric: 'Tier 4 (SKIP) count',          value: tierCounts[4] || 0 },
    { metric: 'Crawl errors count',           value: stats.errorCount },
    { metric: 'Date/time of audit',           value: new Date().toISOString() },
    { metric: 'Average opportunity score',    value: stats.avgScore },
  ]);

  await workbook.xlsx.writeFile(OUTPUT_FILE);
  log(`[DONE] Audited XLSX written to ${OUTPUT_FILE}`);
}

// ── Write outreach XLSX ─────────────────────────────────────────────────────
async function writeOutreachXlsx(allRows) {
  const outreachRows = allRows
    .filter(r => r.tier === 'Tier 1' || r.tier === 'Tier 2')
    .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Outreach List');
  ws.columns = [
    { header: '#',            key: 'num',          width: 4  },
    { header: 'Tier',         key: 'tier',         width: 8  },
    { header: 'Score',        key: 'score',        width: 6  },
    { header: 'Business',     key: 'name',         width: 30 },
    { header: 'Phone',        key: 'phone',        width: 16 },
    { header: 'Category',     key: 'category',     width: 22 },
    { header: 'Address',      key: 'address',      width: 35 },
    { header: 'Distance_m',   key: 'distance_m',   width: 10 },
    { header: 'Rating',       key: 'rating',       width: 7  },
    { header: 'Reviews',      key: 'reviews',      width: 9  },
    { header: 'Website',      key: 'website',      width: 35 },
    { header: 'Main Problem', key: 'main_problem', width: 60 },
    { header: 'Contacted',    key: 'contacted',    width: 12 },
    { header: 'Notes',        key: 'notes',        width: 25 },
  ];

  ws.addRows(outreachRows.map((r, i) => ({
    num:          i + 1,
    tier:         r.tier,
    score:        r.opportunity_score,
    name:         r.name,
    phone:        r.phone,
    category:     r.category,
    address:      r.full_address,
    distance_m:   r.distance_meters,
    rating:       r.rating,
    reviews:      r.reviews,
    website:      r.website,
    main_problem: r.pitch_angle,
    contacted:    '',
    notes:        '',
  })));

  await workbook.xlsx.writeFile(OUTREACH_FILE);
  log(`[DONE] Outreach XLSX written to ${OUTREACH_FILE} (${outreachRows.length} leads)`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  log(`[INIT] Neighborhood: ${NEIGHBORHOOD}`);
  if (FORCE_CACHE) log('[INIT] --force: cache bypassed, all domains will be re-crawled');

  // Step 1: Read input
  const rows = await readInputXlsx();

  // Steps 2-3: Normalize + deduplicate
  const domainMap = deduplicateByDomain(rows);
  let domains = [...domainMap.entries()]; // [hostname, { url, businesses }]
  log(`[INIT] ${rows.length} businesses → ${domains.length} unique domains to crawl`);

  if (LIMIT > 0) {
    domains = domains.slice(0, LIMIT);
    log(`[LIMIT] Limiting to first ${LIMIT} domains`);
  }

  // Load cache for resume capability
  const cache = FORCE_CACHE ? new Map() : loadCache();
  const cacheHits = FORCE_CACHE ? 0 : domains.filter(([h]) => cache.has(h)).length;
  if (cacheHits > 0) {
    log(`[CACHE] Found ${cacheHits} cached results, will skip those domains`);
  }

  // Steps 4-5: Crawl + analyze
  const limiter = pLimit(CONCURRENCY);
  const total = domains.length;
  let processed = 0;
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let errorCount = 0;
  let cacheSaveChain = Promise.resolve();

  const crawlTasks = domains.map(([hostname, { url, businesses }]) =>
    limiter(async () => {
      // Return cached result if available
      if (cache.has(hostname)) {
        const cached = cache.get(hostname);
        processed++;
        tierCounts[cached.tier] = (tierCounts[cached.tier] || 0) + 1;
        if (cached.crawl_error) errorCount++;
        logProgress(processed, total, hostname, cached);
        return [hostname, cached];
      }

      // Rate-limit delay between fresh requests
      await new Promise(r => setTimeout(r, DELAY_MS));

      const crawlResult = await crawlUrl(url);
      let analysis = {
        missing_viewport:   false,
        no_ssl:             false,
        copyright_year:     null,
        outdated_copyright: false,
        has_dead_tags:      false,
        dead_tags_found:    '',
        image_count:        0,
        missing_h1:         false,
        missing_meta_desc:  false,
        weak_title:         false,
        page_title:         null,
        cms_detected:       null,
        response_time_ms:   null,
      };

      if (crawlResult.html) {
        analysis = analyzeHtml(crawlResult.html, crawlResult.final_url);
        analysis.response_time_ms = crawlResult.response_time_ms;
      }

      const result = {
        ...analysis,
        crawl_error:      crawlResult.crawl_error,
        final_url:        crawlResult.final_url,
        response_time_ms: crawlResult.response_time_ms,
      };

      // Score + tier using review count from the first business in this group
      const reviewCount = businesses[0]?.reviews || 0;
      result.opportunity_score = scoreResult(result, reviewCount);
      result.tier              = assignTier(result.opportunity_score);
      result.pitch_angle       = generatePitch(result);

      processed++;
      tierCounts[result.tier] = (tierCounts[result.tier] || 0) + 1;
      if (result.crawl_error) errorCount++;

      logProgress(processed, total, hostname, result);

      // Persist to cache (serialize writes to prevent corruption)
      cache.set(hostname, result);
      if (processed % 10 === 0) {
        cacheSaveChain = cacheSaveChain.then(() => saveCache(cache));
      }

      if (processed % 50 === 0) {
        log(`--- Progress: ${processed}/${total} | T1:${tierCounts[1]||0} T2:${tierCounts[2]||0} T3:${tierCounts[3]||0} T4:${tierCounts[4]||0} | ${errorCount} errors ---`);
      }

      return [hostname, result];
    })
  );

  const results = await Promise.all(crawlTasks);
  const resultMap = new Map(results);

  // Final cache flush
  await cacheSaveChain;
  saveCache(cache);

  // Build output rows — one row per business (not per domain)
  const allRows = [];
  for (const [hostname, { businesses }] of domainMap) {
    const domainResult = resultMap.get(hostname);
    if (!domainResult) continue; // skipped by --limit
    for (const biz of businesses) {
      allRows.push(buildOutputRow(biz, domainResult));
    }
  }

  const successCount = total - errorCount;
  const successRate  = total > 0 ? ((successCount / total) * 100).toFixed(1) : '0';
  const avgScore     = allRows.length > 0
    ? (allRows.reduce((sum, r) => sum + (r.opportunity_score || 0), 0) / allRows.length).toFixed(1)
    : '0';

  const stats = {
    totalBusinesses: allRows.length,
    totalDomains:    total,
    cacheHits,
    successRate,
    errorCount,
    avgScore,
  };

  await writeOutputXlsx(allRows, tierCounts, stats);
  await writeOutreachXlsx(allRows);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  log('\n═══════════════════════════════════════════');
  log('  WEBSITE AUDIT COMPLETE');
  log('═══════════════════════════════════════════');
  log(`  Neighborhood:        ${NEIGHBORHOOD}`);
  log(`  Businesses audited:  ${allRows.length}`);
  log(`  Unique domains:      ${total}`);
  log(`  Cache hits:          ${cacheHits}`);
  log(`  Crawl success rate:  ${successRate}%`);
  log(`  Average score:       ${avgScore}`);
  log('───────────────────────────────────────────');
  log(`  Tier 1 (HOT):   ${tierCounts[1] || 0}`);
  log(`  Tier 2 (WARM):  ${tierCounts[2] || 0}`);
  log(`  Tier 3 (COOL):  ${tierCounts[3] || 0}`);
  log(`  Tier 4 (SKIP):  ${tierCounts[4] || 0}`);
  log(`  Crawl errors:   ${errorCount}`);
  log('───────────────────────────────────────────');
  log(`  Duration:        ${elapsed}s`);
  log(`  Output:          ${OUTPUT_FILE}`);
  log(`  Outreach:        ${OUTREACH_FILE}`);
  log(`  Cache:           ${CACHE_FILE}`);
  log(`  Log:             ${LOG_FILE}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
