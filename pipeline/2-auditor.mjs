// auditor.mjs — Website audit pipeline for Outscraper leads
// Crawls business websites, applies 4 technical filters, scores & tiers leads

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { load } from 'cheerio';
import pLimit from 'p-limit';
import XLSX from 'xlsx';

// ── Config ──────────────────────────────────────────────────────────────────
const INPUT_FILE = 'output/businesses_near_maria_de_molina.xlsx';
const OUTPUT_FILE = 'output/leads_audited.xlsx';
const CACHE_FILE = 'output/crawl_cache.json';
const CONCURRENCY = 5;
const DELAY_MS = 200;
const TIMEOUT_MS = 15000;
const DRY_RUN_LIMIT = parseInt(process.argv[2] || '0', 10); // pass number to limit domains

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Step 1: Read the XLSX ───────────────────────────────────────────────────
function readInputXlsx() {
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
  // URL-decode
  try { url = decodeURIComponent(url); } catch { /* already decoded */ }
  // Strip query string (UTM params etc.)
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) url = url.substring(0, qIdx);
  // Strip hash
  const hIdx = url.indexOf('#');
  if (hIdx !== -1) url = url.substring(0, hIdx);
  // Remove trailing slash for consistency
  url = url.replace(/\/+$/, '');
  // Prepend https:// if missing
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

function extractHostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

// ── Step 3: Deduplicate by domain ───────────────────────────────────────────
function deduplicateByDomain(businesses) {
  const domainMap = new Map(); // hostname → { url, businesses[] }
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
      // Non-HTML response — still record final URL
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

// ── SSL check: does http:// redirect to https://? ───────────────────────────
async function checkSslRedirect(hostname) {
  const httpUrl = `http://${hostname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(httpUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    clearTimeout(timer);
    return resp.url.startsWith('https://');
  } catch {
    clearTimeout(timer);
    return false; // can't reach via HTTP either — doesn't matter
  }
}

// ── Step 5: Apply the 4 filters ─────────────────────────────────────────────
async function analyzeHtml(html, finalUrl, hostname) {
  const $ = load(html);

  // FILTER 1: Missing viewport
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const missing_viewport = !hasViewport;

  // FILTER 2: SSL
  const isHttpFinal = finalUrl.startsWith('http://');
  let no_ssl = isHttpFinal;
  // If final was HTTPS, double-check the HTTP path redirects properly
  if (!isHttpFinal) {
    const finalHostname = extractHostname(finalUrl) || hostname;
    const redirectsToHttps = await checkSslRedirect(finalHostname);
    no_ssl = !redirectsToHttps;
  }

  // FILTER 3: Copyright year
  const bodyText = $('body').text() || '';
  const footerText = $('footer').text() || '';
  const combinedText = footerText + ' ' + bodyText;

  let latestCopyrightYear = null;

  // Standard copyright pattern
  // Standard copyright pattern (© is decoded by cheerio .text(), but also match &copy; in raw text)
  const copyrightPattern = /(?:©|&copy;|copyright)\s*((?:19|20)\d{2})/gi;
  for (const m of combinedText.matchAll(copyrightPattern)) {
    const y = parseInt(m[1], 10);
    if (!latestCopyrightYear || y > latestCopyrightYear) latestCopyrightYear = y;
  }

  // Range pattern: 2015-2024 or 2015 – 2024 (with or without copyright symbol)
  const rangePattern = /(?:©|&copy;|copyright)?\s*(?:19|20)\d{2}\s*[-–—]\s*((?:19|20)\d{2})/gi;
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

  return {
    missing_viewport,
    no_ssl,
    copyright_year,
    outdated_copyright,
    has_dead_tags,
    dead_tags_found,
  };
}

// ── Step 6: Score and tier ──────────────────────────────────────────────────
function scoreResult(result) {
  let score = 0;
  if (result.crawl_error === 'dns_fail' || result.crawl_error === 'connection_refused') {
    score += 50;
  } else if (result.crawl_error === 'timeout') {
    score += 30;
  } else if (result.crawl_error && result.crawl_error !== null) {
    score += 20;
  }
  if (result.missing_viewport) score += 40;
  if (result.no_ssl) score += 25;
  if (result.outdated_copyright) score += 15;
  if (result.has_dead_tags) score += 10;
  return Math.min(score, 100);
}

function assignTier(score) {
  if (score >= 65) return 1;
  if (score >= 40) return 2;
  if (score >= 15) return 3;
  return 4;
}

function tierLabel(tier) {
  switch (tier) {
    case 1: return 'HOT — Missing viewport + SSL/dead site. Desperate for help.';
    case 2: return 'WARM — Missing viewport OR dead site. Strong pitch.';
    case 3: return 'COOL — Minor issues. Modernization pitch.';
    case 4: return 'SKIP — Site appears modern.';
  }
}

// ── Step 8: Pitch angle ─────────────────────────────────────────────────────
function generatePitch(result) {
  if (result.crawl_error === 'dns_fail' || result.crawl_error === 'connection_refused') {
    return 'Website is completely down/dead. Needs a new website immediately.';
  }
  if (result.crawl_error === 'timeout') {
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
  if (result.missing_viewport) issues.push('not mobile-responsive (penalized by Google)');
  if (result.no_ssl) issues.push('marked as "Not Secure" by browsers (losing trust)');
  if (result.outdated_copyright) issues.push(`site content outdated since ${result.copyright_year}`);
  if (result.has_dead_tags) issues.push('built with obsolete technology from 10+ years ago');

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
  const tier = result.tier;
  if (result.crawl_error) {
    console.log(`[${idx}/${total}] ✗ ${hostname} — ERROR: ${result.crawl_error} → Score: ${score} (Tier ${tier})`);
  } else {
    const vp = result.missing_viewport ? 'MISSING' : 'OK';
    const ssl = result.no_ssl ? 'MISSING' : 'OK';
    const cr = result.copyright_year || 'N/A';
    const dt = result.dead_tags_found || 'NONE';
    console.log(`[${idx}/${total}] ✓ ${hostname} — viewport:${vp} ssl:${ssl} copyright:${cr} dead_tags:${dt} → Score: ${score} (Tier ${tier})`);
  }
}

// ── Step 7: Export XLSX ─────────────────────────────────────────────────────
function buildOutputRow(biz, domainResult) {
  return {
    tier: `Tier ${domainResult.tier}`,
    opportunity_score: domainResult.opportunity_score,
    distance_meters: biz.distance_meters ?? '',
    name: biz.name ?? '',
    website: biz._cleaned_url ?? biz.website ?? '',
    phone: biz.phone ?? '',
    category: biz.category ?? '',
    full_address: biz.full_address ?? '',
    rating: biz.rating ?? '',
    reviews: biz.reviews ?? '',
    missing_viewport: domainResult.missing_viewport ? 'TRUE' : 'FALSE',
    no_ssl: domainResult.no_ssl ? 'TRUE' : 'FALSE',
    copyright_year: domainResult.copyright_year ?? 'not found',
    outdated_copyright: domainResult.outdated_copyright ? 'TRUE' : 'FALSE',
    has_dead_tags: domainResult.has_dead_tags ? 'TRUE' : 'FALSE',
    dead_tags_found: domainResult.dead_tags_found ?? '',
    crawl_error: domainResult.crawl_error ?? '',
    final_url: domainResult.final_url ?? '',
    google_id: biz.google_id ?? '',
    pitch_angle: domainResult.pitch_angle ?? '',
  };
}

function writeOutputXlsx(allRows, tierCounts, stats) {
  // Sort: opportunity_score DESC, then distance_meters ASC
  const sorted = [...allRows].sort((a, b) => {
    const scoreDiff = (b.opportunity_score || 0) - (a.opportunity_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const dA = typeof a.distance_meters === 'number' ? a.distance_meters : 999999;
    const dB = typeof b.distance_meters === 'number' ? b.distance_meters : 999999;
    return dA - dB;
  });

  const wb = XLSX.utils.book_new();

  // Sheet 1: All Leads
  const ws1 = XLSX.utils.json_to_sheet(sorted);
  XLSX.utils.book_append_sheet(wb, ws1, 'All Leads');

  // Sheet 2: Tier 1 Hot Leads
  const tier1 = sorted.filter(r => r.tier === 'Tier 1');
  const ws2 = XLSX.utils.json_to_sheet(tier1.length > 0 ? tier1 : [{}]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Tier 1 Hot Leads');

  // Sheet 3: Tier 2 Warm Leads
  const tier2 = sorted.filter(r => r.tier === 'Tier 2');
  const ws3 = XLSX.utils.json_to_sheet(tier2.length > 0 ? tier2 : [{}]);
  XLSX.utils.book_append_sheet(wb, ws3, 'Tier 2 Warm Leads');

  // Sheet 4: Summary
  const summary = [
    { metric: 'Total businesses audited', value: stats.totalBusinesses },
    { metric: 'Total unique domains crawled', value: stats.totalDomains },
    { metric: 'Crawl success rate', value: `${stats.successRate}%` },
    { metric: 'Tier 1 (HOT) count', value: tierCounts[1] || 0 },
    { metric: 'Tier 2 (WARM) count', value: tierCounts[2] || 0 },
    { metric: 'Tier 3 (COOL) count', value: tierCounts[3] || 0 },
    { metric: 'Tier 4 (SKIP) count', value: tierCounts[4] || 0 },
    { metric: 'Crawl errors count', value: stats.errorCount },
    { metric: 'Date/time of audit', value: new Date().toISOString() },
    { metric: 'Average opportunity score', value: stats.avgScore },
  ];
  const ws4 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws4, 'Summary');

  XLSX.writeFile(wb, OUTPUT_FILE);
  console.log(`\n[DONE] Output written to ${OUTPUT_FILE}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();

  // Step 1: Read input
  const rows = readInputXlsx();

  // Step 2-3: Normalize + deduplicate
  const domainMap = deduplicateByDomain(rows);
  let domains = [...domainMap.entries()]; // [hostname, { url, businesses }]
  console.log(`[INIT] ${rows.length} businesses → ${domains.length} unique domains to crawl`);

  if (DRY_RUN_LIMIT > 0) {
    domains = domains.slice(0, DRY_RUN_LIMIT);
    console.log(`[DRY RUN] Limiting to ${DRY_RUN_LIMIT} domains`);
  }

  // Load cache for resume capability
  const cache = loadCache();
  const cachedCount = [...domains].filter(([h]) => cache.has(h)).length;
  if (cachedCount > 0) {
    console.log(`[CACHE] Found ${cachedCount} cached results, will skip those domains`);
  }

  // Step 4-5: Crawl + analyze
  const limit = pLimit(CONCURRENCY);
  const total = domains.length;
  let processed = 0;
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let errorCount = 0;
  let cacheSaveChain = Promise.resolve(); // serialize cache writes

  const crawlTasks = domains.map(([hostname, { url }]) =>
    limit(async () => {
      // Check cache
      if (cache.has(hostname)) {
        const cached = cache.get(hostname);
        processed++;
        tierCounts[cached.tier] = (tierCounts[cached.tier] || 0) + 1;
        if (cached.crawl_error) errorCount++;
        logProgress(processed, total, hostname, cached);
        return [hostname, cached];
      }

      // Rate-limit delay
      await new Promise(r => setTimeout(r, DELAY_MS));

      // Crawl
      const crawlResult = await crawlUrl(url);
      let analysis = {
        missing_viewport: false,
        no_ssl: false,
        copyright_year: null,
        outdated_copyright: false,
        has_dead_tags: false,
        dead_tags_found: '',
      };

      if (crawlResult.html) {
        analysis = await analyzeHtml(crawlResult.html, crawlResult.final_url, hostname);
      }

      const result = {
        ...analysis,
        crawl_error: crawlResult.crawl_error,
        final_url: crawlResult.final_url,
      };

      // Score + tier
      result.opportunity_score = scoreResult(result);
      result.tier = assignTier(result.opportunity_score);
      result.pitch_angle = generatePitch(result);

      // Update counters
      processed++;
      tierCounts[result.tier] = (tierCounts[result.tier] || 0) + 1;
      if (result.crawl_error) errorCount++;

      // Log
      logProgress(processed, total, hostname, result);

      // Save to cache (serialized to prevent concurrent write corruption)
      cache.set(hostname, result);
      if (processed % 10 === 0) {
        cacheSaveChain = cacheSaveChain.then(() => saveCache(cache));
      }

      // Progress summary every 50
      if (processed % 50 === 0) {
        console.log(`--- Progress: ${processed}/${total} domains crawled | ${tierCounts[1] || 0} Tier1 | ${tierCounts[2] || 0} Tier2 | ${tierCounts[3] || 0} Tier3 | ${tierCounts[4] || 0} Tier4 | ${errorCount} errors ---`);
      }

      return [hostname, result];
    })
  );

  const results = await Promise.all(crawlTasks);
  const resultMap = new Map(results);

  // Final cache save (wait for any pending writes then do final)
  await cacheSaveChain;
  saveCache(cache);

  // Step 6-7: Build output rows and export
  const allRows = [];
  // Include businesses WITH websites (matched to domain results)
  for (const [hostname, { businesses }] of domainMap) {
    const domainResult = resultMap.get(hostname);
    if (!domainResult) continue; // skipped in dry run
    for (const biz of businesses) {
      allRows.push(buildOutputRow(biz, domainResult));
    }
  }

  // Also include businesses WITHOUT websites — they are Tier 4 skip
  const noWebsiteRows = rows.filter(r => !r.website || !r._cleaned_url);
  // Don't include no-website businesses — spec says skip empty websites in Step 1

  const successCount = total - errorCount;
  const successRate = total > 0 ? ((successCount / total) * 100).toFixed(1) : '0';
  const avgScore = allRows.length > 0
    ? (allRows.reduce((sum, r) => sum + (r.opportunity_score || 0), 0) / allRows.length).toFixed(1)
    : '0';

  const stats = {
    totalBusinesses: allRows.length,
    totalDomains: total,
    successRate,
    errorCount,
    avgScore,
  };

  writeOutputXlsx(allRows, tierCounts, stats);

  // Final console report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n═══════════════════════════════════════════');
  console.log('  WEBSITE AUDIT COMPLETE');
  console.log('═══════════════════════════════════════════');
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
  console.log('═══════════════════════════════════════════');

  // Keep cache as backup — user can delete manually
  console.log(`[INFO] Crawl cache saved at ${CACHE_FILE} for resume capability`);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
