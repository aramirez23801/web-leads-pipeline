// pipeline/2-auditor.mjs — Website audit pipeline for Outscraper leads
// Crawls business websites, applies technical filters, scores & tiers leads.
//
// Usage:
//   node pipeline/2-auditor.mjs [--neighborhood <name>] [<limit>]
//   node pipeline/2-auditor.mjs -n retiro 10   # audit retiro, first 10 domains
//
// Input:  output/businesses_{neighborhood}.xlsx
// Output: output/leads_audited_{neighborhood}.xlsx
//         output/outreach_{neighborhood}.xlsx
// Cache:  output/crawl_cache_{neighborhood}.json

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { load } from 'cheerio';
import pLimit from 'p-limit';
import XLSX from 'xlsx';
import { getNeighborhoodName } from './utils.mjs';

// ── Config ──────────────────────────────────────────────────────────────────
const NEIGHBORHOOD  = getNeighborhoodName();
const INPUT_FILE    = `output/businesses_${NEIGHBORHOOD}.xlsx`;
const OUTPUT_FILE   = `output/leads_audited_${NEIGHBORHOOD}.xlsx`;
const OUTREACH_FILE = `output/outreach_${NEIGHBORHOOD}.xlsx`;
const CACHE_FILE    = `output/crawl_cache_${NEIGHBORHOOD}.json`;
const CONCURRENCY   = 5;
const DELAY_MS      = 200;
const TIMEOUT_MS    = 15000;

// Parse optional numeric limit argument (skip flag names and their values)
function getDryRunLimit() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--neighborhood' || a === '-n') { i++; continue; }
    if (/^\d+$/.test(a)) return parseInt(a, 10);
  }
  return 0;
}
const DRY_RUN_LIMIT = getDryRunLimit();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Step 1: Read the XLSX ───────────────────────────────────────────────────
function readInputXlsx() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`);
    console.error(`        Run the scraper first: node pipeline/1-scraper.mjs --neighborhood ${NEIGHBORHOOD}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(INPUT_FILE);
  const ws = wb.Sheets['Businesses'];
  if (!ws) throw new Error('Sheet "Businesses" not found in input XLSX');
  const rows = XLSX.utils.sheet_to_json(ws);
  console.log(`[INIT] Read ${rows.length} rows from ${INPUT_FILE}`);
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
    clearTimeout(timer);

    const finalUrl = response.url;
    const status = response.status;

    if (status < 200 || status >= 400) {
      return { crawl_error: `http_${status}`, final_url: finalUrl, html: null, status };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { crawl_error: 'not_html', final_url: finalUrl, html: null, status };
    }

    const html = await response.text();
    return { crawl_error: null, final_url: finalUrl, html, status };
  } catch (err) {
    clearTimeout(timer);
    const msg = err.message || String(err);
    if (err.name === 'AbortError' || msg.includes('aborted')) {
      return { crawl_error: 'timeout', final_url: url, html: null, status: null };
    }
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return { crawl_error: 'dns_fail', final_url: url, html: null, status: null };
    }
    if (msg.includes('ECONNREFUSED')) {
      return { crawl_error: 'connection_refused', final_url: url, html: null, status: null };
    }
    if (msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
      return { crawl_error: 'connection_reset', final_url: url, html: null, status: null };
    }
    if (msg.includes('CERT') || msg.includes('SSL') || msg.includes('certificate')) {
      return { crawl_error: 'ssl_error', final_url: url, html: null, status: null };
    }
    return { crawl_error: msg.substring(0, 120), final_url: url, html: null, status: null };
  }
}

// ── Step 5: Apply the filters ───────────────────────────────────────────────
async function analyzeHtml(html, finalUrl) {
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

  const outdated_copyright = latestCopyrightYear !== null && latestCopyrightYear < 2023;
  const copyright_year = latestCopyrightYear;

  // FILTER 4: Dead HTML tags
  const deadTagList = ['frameset', 'frame', 'center', 'font', 'marquee', 'blink', 'applet'];
  const foundDeadTags = deadTagList.filter(tag => $(tag).length > 0);
  const has_dead_tags = foundDeadTags.length > 0;
  const dead_tags_found = foundDeadTags.join(', ');

  // FILTER 5: Heavy page (excessive image count → slow loads)
  const imageCount = $('img').length;
  const heavy_page = imageCount > 30;

  return {
    missing_viewport,
    no_ssl,
    copyright_year,
    outdated_copyright,
    has_dead_tags,
    dead_tags_found,
    heavy_page,
    image_count: imageCount,
  };
}

// ── Step 6: Score and tier ──────────────────────────────────────────────────
function scoreResult(result, reviewCount = 0) {
  let score = 0;

  // Dead site signals
  if (result.crawl_error === 'dns_fail' || result.crawl_error === 'connection_refused') {
    score += 50;
  } else if (result.crawl_error === 'timeout' || result.crawl_error === 'connection_reset') {
    score += 35;
  } else if (result.crawl_error) {
    score += 20;
  }

  if (result.missing_viewport) score += 40;
  if (result.no_ssl)           score += 25;
  if (result.outdated_copyright) score += 15;
  if (result.has_dead_tags)    score += 10;
  if (result.heavy_page)       score += 10;

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
  if (result.heavy_page)         issues.push('overloaded with images (slow load times)');

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
    console.log(`[${idx}/${total}] ✗ ${hostname} — ERROR: ${result.crawl_error} → Score: ${score} (Tier ${tier})`);
  } else {
    const vp = result.missing_viewport ? 'MISSING' : 'OK';
    const ssl = result.no_ssl ? 'MISSING' : 'OK';
    const cr  = result.copyright_year || 'N/A';
    const dt  = result.dead_tags_found || 'NONE';
    console.log(`[${idx}/${total}] ✓ ${hostname} — viewport:${vp} ssl:${ssl} copyright:${cr} dead_tags:${dt} → Score: ${score} (Tier ${tier})`);
  }
}

// ── Build output row ────────────────────────────────────────────────────────
function buildOutputRow(biz, domainResult) {
  return {
    tier:               `Tier ${domainResult.tier}`,
    opportunity_score:  domainResult.opportunity_score,
    distance_meters:    biz.distance_meters ?? '',
    name:               biz.name ?? '',
    website:            biz._cleaned_url ?? biz.website ?? '',
    phone:              biz.phone ?? '',
    category:           biz.category ?? '',
    full_address:       biz.full_address ?? '',
    street:             biz.street ?? '',
    city:               biz.city ?? '',
    postal_code:        biz.postal_code ?? '',
    county:             biz.county ?? '',
    country_code:       biz.country_code ?? '',
    emails:             biz.emails ?? '',
    rating:             biz.rating ?? '',
    reviews:            biz.reviews ?? '',
    missing_viewport:   domainResult.missing_viewport ? 'TRUE' : 'FALSE',
    no_ssl:             domainResult.no_ssl ? 'TRUE' : 'FALSE',
    copyright_year:     domainResult.copyright_year ?? 'not found',
    outdated_copyright: domainResult.outdated_copyright ? 'TRUE' : 'FALSE',
    has_dead_tags:      domainResult.has_dead_tags ? 'TRUE' : 'FALSE',
    dead_tags_found:    domainResult.dead_tags_found ?? '',
    heavy_page:         domainResult.heavy_page ? 'TRUE' : 'FALSE',
    image_count:        domainResult.image_count ?? 0,
    crawl_error:        domainResult.crawl_error ?? '',
    final_url:          domainResult.final_url ?? '',
    google_id:          biz.google_id ?? '',
    pitch_angle:        domainResult.pitch_angle ?? '',
  };
}

// ── Write main audited XLSX ─────────────────────────────────────────────────
function writeOutputXlsx(allRows, tierCounts, stats) {
  const sorted = [...allRows].sort((a, b) => {
    const scoreDiff = (b.opportunity_score || 0) - (a.opportunity_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const dA = typeof a.distance_meters === 'number' ? a.distance_meters : 999999;
    const dB = typeof b.distance_meters === 'number' ? b.distance_meters : 999999;
    return dA - dB;
  });

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(sorted);
  ws1['!cols'] = [
    { wch: 8  }, // tier
    { wch: 16 }, // opportunity_score
    { wch: 15 }, // distance_meters
    { wch: 35 }, // name
    { wch: 40 }, // website
    { wch: 18 }, // phone
    { wch: 25 }, // category
    { wch: 50 }, // full_address
    { wch: 40 }, // street
    { wch: 15 }, // city
    { wch: 12 }, // postal_code
    { wch: 20 }, // county
    { wch: 12 }, // country_code
    { wch: 40 }, // emails
    { wch: 8  }, // rating
    { wch: 10 }, // reviews
    { wch: 16 }, // missing_viewport
    { wch: 8  }, // no_ssl
    { wch: 15 }, // copyright_year
    { wch: 18 }, // outdated_copyright
    { wch: 12 }, // has_dead_tags
    { wch: 20 }, // dead_tags_found
    { wch: 12 }, // heavy_page
    { wch: 12 }, // image_count
    { wch: 25 }, // crawl_error
    { wch: 40 }, // final_url
    { wch: 25 }, // google_id
    { wch: 60 }, // pitch_angle
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'All Leads');

  const tier1 = sorted.filter(r => r.tier === 'Tier 1');
  const ws2 = XLSX.utils.json_to_sheet(tier1.length > 0 ? tier1 : [{}]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Tier 1 Hot Leads');

  const tier2 = sorted.filter(r => r.tier === 'Tier 2');
  const ws3 = XLSX.utils.json_to_sheet(tier2.length > 0 ? tier2 : [{}]);
  XLSX.utils.book_append_sheet(wb, ws3, 'Tier 2 Warm Leads');

  const summary = [
    { metric: 'Total businesses audited',   value: stats.totalBusinesses },
    { metric: 'Total unique domains crawled', value: stats.totalDomains },
    { metric: 'Crawl success rate',          value: `${stats.successRate}%` },
    { metric: 'Tier 1 (HOT) count',          value: tierCounts[1] || 0 },
    { metric: 'Tier 2 (WARM) count',         value: tierCounts[2] || 0 },
    { metric: 'Tier 3 (COOL) count',         value: tierCounts[3] || 0 },
    { metric: 'Tier 4 (SKIP) count',         value: tierCounts[4] || 0 },
    { metric: 'Crawl errors count',          value: stats.errorCount },
    { metric: 'Date/time of audit',          value: new Date().toISOString() },
    { metric: 'Average opportunity score',   value: stats.avgScore },
  ];
  const ws4 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws4, 'Summary');

  XLSX.writeFile(wb, OUTPUT_FILE);
  console.log(`\n[DONE] Audited XLSX written to ${OUTPUT_FILE}`);
}

// ── Write outreach XLSX ─────────────────────────────────────────────────────
function writeOutreachXlsx(allRows) {
  const outreachRows = allRows
    .filter(r => r.tier === 'Tier 1' || r.tier === 'Tier 2')
    .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));

  const outreachData = outreachRows.map((r, i) => ({
    '#':            i + 1,
    Tier:           r.tier,
    Score:          r.opportunity_score,
    Business:       r.name,
    Phone:          r.phone,
    Category:       r.category,
    Address:        r.full_address,
    Distance_m:     r.distance_meters,
    Rating:         r.rating,
    Reviews:        r.reviews,
    Website:        r.website,
    'Main Problem': r.pitch_angle,
    Contacted:      '',
    Notes:          '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(outreachData.length > 0 ? outreachData : [{}]);

  ws['!cols'] = [
    { wch: 4  }, // #
    { wch: 8  }, // Tier
    { wch: 6  }, // Score
    { wch: 30 }, // Business
    { wch: 16 }, // Phone
    { wch: 22 }, // Category
    { wch: 35 }, // Address
    { wch: 10 }, // Distance_m
    { wch: 7  }, // Rating
    { wch: 9  }, // Reviews
    { wch: 35 }, // Website
    { wch: 60 }, // Main Problem
    { wch: 12 }, // Contacted
    { wch: 25 }, // Notes
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Outreach List');
  XLSX.writeFile(wb, OUTREACH_FILE);
  console.log(`[DONE] Outreach XLSX written to ${OUTREACH_FILE} (${outreachRows.length} leads)`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log(`[INIT] Neighborhood: ${NEIGHBORHOOD}`);

  // Step 1: Read input
  const rows = readInputXlsx();

  // Steps 2-3: Normalize + deduplicate
  const domainMap = deduplicateByDomain(rows);
  let domains = [...domainMap.entries()]; // [hostname, { url, businesses }]
  console.log(`[INIT] ${rows.length} businesses → ${domains.length} unique domains to crawl`);

  if (DRY_RUN_LIMIT > 0) {
    domains = domains.slice(0, DRY_RUN_LIMIT);
    console.log(`[DRY RUN] Limiting to ${DRY_RUN_LIMIT} domains`);
  }

  // Load cache for resume capability
  const cache = loadCache();
  const cachedCount = domains.filter(([h]) => cache.has(h)).length;
  if (cachedCount > 0) {
    console.log(`[CACHE] Found ${cachedCount} cached results, will skip those domains`);
  }

  // Steps 4-5: Crawl + analyze
  const limit = pLimit(CONCURRENCY);
  const total = domains.length;
  let processed = 0;
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let errorCount = 0;
  let cacheSaveChain = Promise.resolve();

  const crawlTasks = domains.map(([hostname, { url, businesses }]) =>
    limit(async () => {
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
        heavy_page:         false,
        image_count:        0,
      };

      if (crawlResult.html) {
        analysis = await analyzeHtml(crawlResult.html, crawlResult.final_url);
      }

      const result = {
        ...analysis,
        crawl_error: crawlResult.crawl_error,
        final_url:   crawlResult.final_url,
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
        console.log(`--- Progress: ${processed}/${total} | T1:${tierCounts[1]||0} T2:${tierCounts[2]||0} T3:${tierCounts[3]||0} T4:${tierCounts[4]||0} | ${errorCount} errors ---`);
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
    if (!domainResult) continue; // skipped in dry run
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
    successRate,
    errorCount,
    avgScore,
  };

  writeOutputXlsx(allRows, tierCounts, stats);
  writeOutreachXlsx(allRows);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n═══════════════════════════════════════════');
  console.log('  WEBSITE AUDIT COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Neighborhood:        ${NEIGHBORHOOD}`);
  console.log(`  Businesses audited:  ${allRows.length}`);
  console.log(`  Unique domains:      ${total}`);
  console.log(`  Crawl success rate:  ${successRate}%`);
  console.log(`  Average score:       ${avgScore}`);
  console.log('───────────────────────────────────────────');
  console.log(`  Tier 1 (HOT):   ${tierCounts[1] || 0}`);
  console.log(`  Tier 2 (WARM):  ${tierCounts[2] || 0}`);
  console.log(`  Tier 3 (COOL):  ${tierCounts[3] || 0}`);
  console.log(`  Tier 4 (SKIP):  ${tierCounts[4] || 0}`);
  console.log(`  Crawl errors:   ${errorCount}`);
  console.log('───────────────────────────────────────────');
  console.log(`  Duration:        ${elapsed}s`);
  console.log(`  Output:          ${OUTPUT_FILE}`);
  console.log(`  Outreach:        ${OUTREACH_FILE}`);
  console.log(`  Cache:           ${CACHE_FILE}`);
  console.log('═══════════════════════════════════════════');
  console.log(`[INFO] Crawl cache saved at ${CACHE_FILE} for resume capability`);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
