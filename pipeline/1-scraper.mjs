/**
 * pipeline/1-scraper.mjs — Scrape local businesses via Outscraper Google Maps API.
 *
 * Usage:
 *   # 1. Use defaults from .env or hardcoded fallback (maria_de_molina):
 *   node pipeline/1-scraper.mjs
 *
 *   # 2. Override neighborhood via CLI flags:
 *   node pipeline/1-scraper.mjs --neighborhood retiro --lat 40.4153 --lon -3.6844
 *
 *   # 3. Dry run (single query, 3 results, no tracker update, domains_service disabled):
 *   node pipeline/1-scraper.mjs --dry-run
 *   node pipeline/1-scraper.mjs --neighborhood retiro --lat 40.4153 --lon -3.6844 --dry-run
 *
 *   # 4. Single category (re-scrape or test one category without a full run):
 *   node pipeline/1-scraper.mjs --category dentistas
 *   node pipeline/1-scraper.mjs --category "agencias de marketing" --dry-run
 *
 * Neighborhood registry (neighborhoods.json):
 *   Coordinates are stored in neighborhoods.json — NOT in .env.
 *   First run for a new neighborhood requires --lat and --lon to register it:
 *     node pipeline/1-scraper.mjs --neighborhood retiro --lat 40.4153 --lon -3.6844
 *   Subsequent runs only need --neighborhood — coords are read from the registry:
 *     node pipeline/1-scraper.mjs --neighborhood retiro
 *
 * Output schema (businesses_{neighborhood}.xlsx, sheet "Businesses"):
 *   distance_meters, name, website, phone, emails (JSON array), category, subtypes,
 *   full_address, street, county, country_code, postal_code, city, rating, reviews,
 *   latitude, longitude, google_id, place_id, business_status, verified, photos_count,
 *   located_in, working_hours, description, query_source
 *
 * NOTE: emails is stored as a JSON array string (e.g. '["a@b.com","c@d.com"]').
 *       Downstream stages must parse with JSON.parse().
 *
 * NOTE: description is the Google Maps business description. Stages 5 and 8 should
 *       incorporate this field for richer personalization.
 */

import 'dotenv/config';
import ExcelJS from 'exceljs';
import { writeFileSync, readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { getNeighborhoodName, getNeighborhoodDirs, makeRunId, logDate } from './utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKER_PATH = join(__dirname, '..', 'neighborhoods.json');

// ─── Neighborhood Config ───────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName();

// ─── CLI Argument Parsers ──────────────────────────────────────────────────────

function parseCliCoord(flag) {
  const args = process.argv;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) {
      const val = parseFloat(args[i + 1]);
      if (!isNaN(val)) return val;
      console.error(`ERROR: ${flag} value "${args[i + 1]}" is not a valid number.`);
      process.exit(1);
    }
  }
  return null;
}

function parseCategoryFilter() {
  const args = process.argv;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) return args[i + 1].toLowerCase();
  }
  return null;
}

// ─── Neighborhood Registry ────────────────────────────────────────────────────
// Coordinates live in neighborhoods.json, not in .env.
// --lat / --lon are only needed when registering a neighborhood for the first time.

function loadRegistry() {
  if (!existsSync(TRACKER_PATH)) return {};
  try {
    return JSON.parse(readFileSync(TRACKER_PATH, 'utf8'));
  } catch {
    console.error('WARNING: Could not parse neighborhoods.json — starting with empty registry.');
    return {};
  }
}

const CATEGORY_FILTER = parseCategoryFilter();
const CLI_LAT = parseCliCoord('--lat');
const CLI_LON = parseCliCoord('--lon');
const registry = loadRegistry();
const registryEntry = registry[NEIGHBORHOOD];

let ORIGIN_LAT, ORIGIN_LON;

if (CLI_LAT !== null && CLI_LON !== null) {
  // CLI coords provided — use them (first-time registration or explicit override)
  ORIGIN_LAT = CLI_LAT;
  ORIGIN_LON = CLI_LON;
  if (registryEntry) {
    console.log(`[INFO] Overriding stored coords for "${NEIGHBORHOOD}" with CLI values.`);
  }
} else if (registryEntry?.lat && registryEntry?.lon) {
  // Known neighborhood — load coords from registry
  ORIGIN_LAT = registryEntry.lat;
  ORIGIN_LON = registryEntry.lon;
} else {
  console.error(`ERROR: Neighborhood "${NEIGHBORHOOD}" not found in neighborhoods.json.`);
  console.error(`       Register it with:`);
  console.error(`       node pipeline/1-scraper.mjs --neighborhood ${NEIGHBORHOOD} --lat <lat> --lon <lon>`);
  process.exit(1);
}
const LOCATION_LABEL = NEIGHBORHOOD.replace(/_/g, ' ');
const dirs    = getNeighborhoodDirs(NEIGHBORHOOD);
const RUN_ID  = makeRunId();
const RUN_DIR = `${dirs.runs}/${RUN_ID}`;
const XLSX_PATH = `${RUN_DIR}/businesses.xlsx`;
const LOG_PATH  = `${dirs.logs}/scraper_${logDate()}.log`;

mkdirSync(RUN_DIR,   { recursive: true });
mkdirSync(dirs.logs, { recursive: true });

// ─── API Config ────────────────────────────────────────────────────────────────

const API_KEY = process.env.OUTSCRAPER_API_KEY;
if (!API_KEY || API_KEY === '<your_key_here>') {
  console.error('ERROR: Set OUTSCRAPER_API_KEY in .env');
  process.exit(1);
}

const BASE_URL = 'https://api.outscraper.cloud/google-maps-search';
const POLL_URL = 'https://api.outscraper.cloud/requests';
const BUDGET_LIMIT = 18;       // $18 hard stop ($2 safety margin below $20 target)
const FREE_TIER = 500;         // Free records per month — estimate only; actual usage may differ
const COST_PER_1000 = 3;
const FETCH_TIMEOUT = 300_000; // 5 minutes
const BATCH_DELAY = 5_000;     // 5 seconds between batches (Outscraper rate limit headroom)
const POLL_INTERVAL = 30_000;  // 30 seconds
const MAX_RETRIES = 3;

// Both 'address' (short) and 'full_address' (complete) are requested — we prefer
// full_address and fall back to address in the row mapping below.
const FIELDS = [
  'query', 'name', 'address', 'full_address', 'street', 'county', 'postal_code', 'city', 'state',
  'country', 'country_code', 'latitude', 'longitude', 'website', 'phone', 'emails', 'type', 'category',
  'subtypes', 'rating', 'reviews', 'photos_count', 'place_id', 'google_id',
  'working_hours', 'description', 'located_in', 'business_status', 'verified',
].join(',');

// Businesses whose only web presence is a social media profile are filtered out —
// we cannot scrape or build a mockup from a social page.
const SOCIAL_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tiktok.com', 'youtube.com', 'pinterest.com',
];

// ─── Categories ────────────────────────────────────────────────────────────────
// Spanish category keywords — location label is appended dynamically by buildBatches()

const CATEGORIES = [
  // Food & hospitality
  'restaurantes',
  'cafeterías',
  'hoteles',
  // Legal & finance
  'abogados',
  'notarías',
  'gestorías',
  'contabilidad',
  'seguros',
  // Health & wellness
  'dentistas',
  'clínicas',
  'clínicas dentales',
  'fisioterapia',
  'clínicas de fisioterapia',
  'psicólogos',
  'centros médicos',
  'farmacias',
  'ópticas',
  'veterinarios',
  // Beauty & fitness
  'peluquerías',
  'centros de estética',
  'gimnasios',
  // Real estate & construction
  'inmobiliarias',
  'arquitectos',
  'electricistas',
  'fontaneros',
  'cerrajeros',
  'empresas de limpieza',
  // Business services
  'consultoría',
  'agencias de marketing',
  'coworking',
  // Education
  'academias',
  'guarderías',
  // Retail & travel
  'tiendas de ropa',
  'tiendas de informática',
  'agencias de viajes',
  // Transport
  'talleres mecánicos',
];

/**
 * Splits categories into batches and appends the location label to each query.
 * e.g. buildBatches(['restaurantes', 'abogados'], 'retiro', 2)
 *   → [['restaurantes retiro', 'abogados retiro']]
 */
function buildBatches(categories, locationLabel, batchSize = 10) {
  const batches = [];
  for (let i = 0; i < categories.length; i += batchSize) {
    const chunk = categories.slice(i, i + batchSize);
    batches.push(chunk.map((cat) => `${cat} ${locationLabel}`));
  }
  return batches;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateCost(totalRecords) {
  const billable = Math.max(0, totalRecords - FREE_TIER);
  return (billable / 1000) * COST_PER_1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if the given URL belongs to a social media domain.
 */
function isSocialMediaUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return SOCIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

function buildUrl(queries, lat, lon, limit = 500, withDomainsService = true) {
  const url = new URL(BASE_URL);
  for (const q of queries) {
    url.searchParams.append('query', q);
  }
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('coordinates', `${lat},${lon}`);
  url.searchParams.set('dropDuplicates', 'true');
  url.searchParams.set('language', 'es');
  url.searchParams.set('region', 'ES');
  url.searchParams.set('async', 'false');
  url.searchParams.set('domains_service', String(withDomainsService));
  url.searchParams.set('fields', FIELDS);
  return url.toString();
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'X-API-KEY': API_KEY },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (resp.status === 401) {
        log('ERROR 401: Invalid API key. Stopping.');
        process.exit(1);
      }
      if (resp.status === 402) {
        log('ERROR 402: Billing issue. Stopping.');
        process.exit(1);
      }
      if (resp.status === 204) {
        log('204: No results for this batch.');
        return [];
      }
      if (resp.status === 429) {
        log(`429: Rate limited. Attempt ${attempt}/${retries}. Waiting 60s...`);
        if (attempt < retries) {
          await sleep(60_000);
          continue;
        }
        throw new Error(`Rate limited: exhausted all ${retries} retries on HTTP 429`);
      }
      if (resp.status === 202) {
        const body = await resp.json();
        const requestId = body.id;
        log(`202: Queued as async request ${requestId}. Polling...`);
        return await pollForResults(requestId);
      }
      if (!resp.ok) {
        const text = await resp.text();
        log(`HTTP ${resp.status}: ${text}. Attempt ${attempt}/${retries}.`);
        if (attempt < retries) {
          await sleep(60_000);
          continue;
        }
        throw new Error(`Failed after ${retries} attempts: HTTP ${resp.status}`);
      }

      const body = await resp.json();
      return extractRecords(body);
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        log(`Timeout on attempt ${attempt}/${retries}. Waiting 60s...`);
        if (attempt < retries) {
          await sleep(60_000);
          continue;
        }
        throw new Error(`Timeout: exhausted all ${retries} retries`);
      }
      throw err;
    }
  }
  // Should never be reached — all paths above return, throw, or continue.
  throw new Error('fetchWithRetry: unexpected exit from retry loop');
}

async function pollForResults(requestId) {
  const pollUrl = `${POLL_URL}/${requestId}`;
  for (let i = 0; i < 20; i++) { // max ~10 minutes of polling
    await sleep(POLL_INTERVAL);
    log(`Polling request ${requestId} (attempt ${i + 1})...`);
    try {
      const resp = await fetch(pollUrl, {
        headers: { 'X-API-KEY': API_KEY },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        log(`Poll HTTP ${resp.status}. Retrying...`);
        continue;
      }
      const body = await resp.json();
      if (body.status === 'Success') {
        log(`Request ${requestId} completed.`);
        return extractRecords(body);
      }
      if (body.status === 'Error') {
        log(`Request ${requestId} failed: ${JSON.stringify(body)}`);
        return [];
      }
      log(`Request ${requestId} status: ${body.status}`);
    } catch (err) {
      log(`Poll error: ${err.message}. Retrying...`);
    }
  }
  log(`Request ${requestId} timed out after polling.`);
  return [];
}

function extractRecords(body) {
  // The API can return:
  // - { data: [ [...], [...], ... ] } — array of arrays (one per query)
  // - { data: [...] } — flat array when dropDuplicates=true
  // - Just an array directly
  let data = body.data ?? body;

  if (!Array.isArray(data)) {
    log(`Unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`);
    return [];
  }

  // If it's an array of arrays, flatten
  if (data.length > 0 && Array.isArray(data[0])) {
    data = data.flat();
  }

  // Filter out non-object entries (sometimes API returns strings/nulls)
  return data.filter((item) => item && typeof item === 'object' && item.name);
}

function updateNeighborhoodRegistry(neighborhood, lat, lon, displayName, stats) {
  const reg = loadRegistry();
  const existing = reg[neighborhood] || {};
  const projectRoot = join(__dirname, '..');

  // Append this run to the history — never overwrite previous runs
  const runs = existing.runs || [];
  runs.push({
    scraped_at: new Date().toISOString(),
    total_businesses: stats.total,
    with_website: stats.withWebsite,
    estimated_cost_usd: parseFloat(stats.cost.toFixed(4)),
    // Relative path — portable across machines and future admin dashboard
    output_file: relative(projectRoot, stats.outputFile),
    batch_failures: stats.batchFailures,
  });

  reg[neighborhood] = {
    display_name: displayName,
    lat,
    lon,
    city: existing.city || '',
    country: existing.country || 'ES',
    runs,
    contacts_made: existing.contacts_made ?? 0,
  };

  writeFileSync(TRACKER_PATH, JSON.stringify(reg, null, 2));
  log(`Neighborhood registry updated: ${TRACKER_PATH} (${runs.length} total run(s) recorded)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runScraper(dryRun = false) {
  const startTime = new Date();
  log(`=== Outscraper Lead Scraper Started ===`);
  log(`Neighborhood: ${NEIGHBORHOOD} (${LOCATION_LABEL})`);
  log(`Origin: ${ORIGIN_LAT}, ${ORIGIN_LON}`);
  log(`Mode: ${dryRun ? 'DRY RUN' : 'FULL SCRAPE'}`);
  log(`Output: ${XLSX_PATH}`);

  const allRecords = new Map(); // google_id/place_id/fallback -> record
  let cumulativeApiRecords = 0;
  let batchFailures = 0;

  // Apply --category filter if provided
  const categoriesToRun = CATEGORY_FILTER
    ? CATEGORIES.filter((c) => c.toLowerCase().includes(CATEGORY_FILTER))
    : CATEGORIES;
  if (CATEGORY_FILTER && categoriesToRun.length === 0) {
    log(`ERROR: No category matches "${CATEGORY_FILTER}". Available:\n  ${CATEGORIES.join('\n  ')}`);
    process.exit(1);
  }
  if (CATEGORY_FILTER) {
    log(`Category filter: "${CATEGORY_FILTER}" → ${categoriesToRun.length} match(es): ${categoriesToRun.join(', ')}`);
  }

  const batches = buildBatches(categoriesToRun, LOCATION_LABEL);
  const batchesToRun = dryRun
    ? [[batches[0][0]]] // Single query for dry run
    : batches;
  const limitPerQuery = dryRun ? 3 : 500;
  // Dry-run disables domains_service — it costs money and isn't needed for a smoke test.
  const withDomainsService = !dryRun;

  for (let i = 0; i < batchesToRun.length; i++) {
    const batch = batchesToRun[i];
    log(`\n--- Batch ${i + 1}/${batchesToRun.length} ---`);
    log(`Queries: ${batch.join(' | ')}`);

    const url = buildUrl(batch, ORIGIN_LAT, ORIGIN_LON, limitPerQuery, withDomainsService);

    let records = [];
    try {
      records = await fetchWithRetry(url);
    } catch (err) {
      batchFailures++;
      log(`BATCH ${i + 1} FAILED (failure #${batchFailures}): ${err.message}. Continuing with next batch.`);
      continue;
    }

    cumulativeApiRecords += records.length;

    let newCount = 0;
    for (const record of records) {
      // Use record.address (the raw API field) for the fallback dedup key.
      // full_address is only available after the XLSX row mapping — not here.
      const key = record.google_id || record.place_id || `${record.name}_${record.address}`;
      if (!allRecords.has(key)) {
        allRecords.set(key, record);
        newCount++;
      }
    }

    const cost = estimateCost(cumulativeApiRecords);
    log(`Batch ${i + 1} results: ${records.length} received, ${newCount} new unique`);
    log(`Cumulative: ${allRecords.size} unique records, API records: ${cumulativeApiRecords}`);
    log(`Estimated cost: $${cost.toFixed(2)} | Remaining budget: $${(BUDGET_LIMIT - cost).toFixed(2)}`);

    if (cost > BUDGET_LIMIT) {
      log(`HARD STOP: Estimated cost $${cost.toFixed(2)} exceeds $${BUDGET_LIMIT} limit.`);
      break;
    }

    if (i < batchesToRun.length - 1) {
      log(`Waiting ${BATCH_DELAY / 1000}s before next batch...`);
      await sleep(BATCH_DELAY);
    }
  }

  if (batchFailures > 0) {
    log(`\nWARNING: ${batchFailures} batch(es) failed — some leads may be missing from output.`);
  }

  // ── Filter 1: Remove closed businesses ──────────────────────────────────────
  // Possible values: OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY.
  // Records with no status are assumed OPERATIONAL (field may not always be returned).
  const openRecords = [];
  let closedCount = 0;
  for (const record of allRecords.values()) {
    const status = (record.business_status || 'OPERATIONAL').toUpperCase();
    if (status === 'CLOSED_PERMANENTLY' || status === 'CLOSED_TEMPORARILY') {
      closedCount++;
      continue;
    }
    openRecords.push(record);
  }
  log(`\nClosed businesses removed: ${closedCount} (${openRecords.length} open remaining)`);

  // ── Filter 2: Require a real business website (not social media) ─────────────
  const withWebsite = [];
  let noWebsiteCount = 0;
  let socialOnlyCount = 0;
  for (const record of openRecords) {
    if (!record.website || record.website.trim() === '') {
      noWebsiteCount++;
      continue;
    }
    if (isSocialMediaUrl(record.website)) {
      socialOnlyCount++;
      log(`Skipping social media URL: ${record.website} (${record.name})`);
      continue;
    }
    withWebsite.push(record);
  }
  log(`Website filter: ${withWebsite.length} kept | ${noWebsiteCount} no-website | ${socialOnlyCount} social-media-only`);

  // Log which address field Outscraper actually returned — confirms full_address vs address fallback
  const fullAddressCount = withWebsite.filter((r) => r.full_address).length;
  log(`Address field: ${fullAddressCount}/${withWebsite.length} records have full_address (${withWebsite.length - fullAddressCount} fall back to address)`);

  // ── Distance calculation and sort ────────────────────────────────────────────
  for (const record of withWebsite) {
    const lat = parseFloat(record.latitude);
    const lon = parseFloat(record.longitude);
    if (!isNaN(lat) && !isNaN(lon)) {
      record.distance_meters = Math.round(haversineMeters(ORIGIN_LAT, ORIGIN_LON, lat, lon));
    } else {
      record.distance_meters = 999999;
    }
  }
  withWebsite.sort((a, b) => a.distance_meters - b.distance_meters);

  // ── Build rows ───────────────────────────────────────────────────────────────
  const rows = withWebsite.map((r) => ({
    distance_meters: r.distance_meters,
    name:            r.name || '',
    website:         r.website || '',
    phone:           r.phone || '',
    // emails: JSON array string — downstream stages must use JSON.parse()
    emails:          JSON.stringify(Array.isArray(r.emails) ? r.emails : r.emails ? [r.emails] : []),
    category:        r.category || r.type || '',
    subtypes:        Array.isArray(r.subtypes) ? r.subtypes.join(', ') : (r.subtypes || ''),
    // Prefer Outscraper's full_address field (complete); fall back to address (short)
    full_address:    r.full_address || r.address || '',
    street:          r.street || '',
    county:          r.county || '',
    country_code:    r.country_code || '',
    postal_code:     r.postal_code || '',
    city:            r.city || '',
    rating:          r.rating || '',
    reviews:         r.reviews || '',
    latitude:        r.latitude || '',
    longitude:       r.longitude || '',
    google_id:       r.google_id || '',
    place_id:        r.place_id || '',
    business_status: r.business_status || 'OPERATIONAL',
    verified:        r.verified ?? false,
    photos_count:    r.photos_count ?? 0,
    located_in:      r.located_in || '',
    working_hours:   typeof r.working_hours === 'object'
      ? JSON.stringify(r.working_hours)
      : (r.working_hours || ''),
    // Google Maps business description — stages 5 & 8 should use this for personalization
    description:     r.description || '',
    query_source:    r.query || '',
  }));

  // ── Write XLSX (exceljs) ─────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Businesses');
  ws.columns = [
    { header: 'distance_meters', key: 'distance_meters', width: 15 },
    { header: 'name',            key: 'name',            width: 35 },
    { header: 'website',         key: 'website',         width: 40 },
    { header: 'phone',           key: 'phone',           width: 18 },
    { header: 'emails',          key: 'emails',          width: 40 },
    { header: 'category',        key: 'category',        width: 25 },
    { header: 'subtypes',        key: 'subtypes',        width: 40 },
    { header: 'full_address',    key: 'full_address',    width: 50 },
    { header: 'street',          key: 'street',          width: 40 },
    { header: 'county',          key: 'county',          width: 20 },
    { header: 'country_code',    key: 'country_code',    width: 12 },
    { header: 'postal_code',     key: 'postal_code',     width: 12 },
    { header: 'city',            key: 'city',            width: 15 },
    { header: 'rating',          key: 'rating',          width: 8  },
    { header: 'reviews',         key: 'reviews',         width: 10 },
    { header: 'latitude',        key: 'latitude',        width: 12 },
    { header: 'longitude',       key: 'longitude',       width: 12 },
    { header: 'google_id',       key: 'google_id',       width: 25 },
    { header: 'place_id',        key: 'place_id',        width: 25 },
    { header: 'business_status', key: 'business_status', width: 18 },
    { header: 'verified',        key: 'verified',        width: 10 },
    { header: 'photos_count',    key: 'photos_count',    width: 12 },
    { header: 'located_in',      key: 'located_in',      width: 30 },
    { header: 'working_hours',   key: 'working_hours',   width: 40 },
    { header: 'description',     key: 'description',     width: 50 },
    { header: 'query_source',    key: 'query_source',    width: 40 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRows(rows);

  // Summary sheet
  const endTime = new Date();
  const finalCost = estimateCost(cumulativeApiRecords);
  const queryList = [...new Set(withWebsite.map((r) => r.query || '').filter(Boolean))];

  const summaryData = [
    { metric: 'Neighborhood',                           value: NEIGHBORHOOD },
    { metric: 'Businesses kept (open + real website)',  value: withWebsite.length },
    { metric: 'Total unique businesses (after dedup)',  value: allRecords.size },
    { metric: 'Closed businesses removed',              value: closedCount },
    { metric: 'Social-media-only websites removed',     value: socialOnlyCount },
    { metric: 'No website (removed)',                   value: noWebsiteCount },
    { metric: 'Total API records received',             value: cumulativeApiRecords },
    { metric: 'Batch failures',                         value: batchFailures },
    { metric: 'Estimated API cost',                     value: `$${finalCost.toFixed(2)}` },
    { metric: 'Categories with results',                value: queryList.length },
    { metric: 'Category list',                          value: queryList.join('; ') },
    { metric: 'Date/time of scrape',                    value: startTime.toISOString() },
    { metric: 'Duration',                               value: `${Math.round((endTime - startTime) / 1000)}s` },
    { metric: 'Origin coordinates',                     value: `${ORIGIN_LAT}, ${ORIGIN_LON}` },
  ];

  const summaryWs = wb.addWorksheet('Summary');
  summaryWs.columns = [
    { header: 'metric', key: 'metric', width: 40 },
    { header: 'value',  key: 'value',  width: 80 },
  ];
  summaryWs.getRow(1).font = { bold: true };
  summaryWs.addRows(summaryData);

  await wb.xlsx.writeFile(XLSX_PATH);
  log(`\nXLSX written to: ${XLSX_PATH}`);

  // Update latest_run.json so downstream stages find this run (skip for dry runs)
  if (!dryRun) {
    writeFileSync(`${dirs.root}/latest_run.json`, JSON.stringify({
      runId: RUN_ID,
      path:  RUN_DIR,
      createdAt: new Date().toISOString(),
    }, null, 2));
    log(`Run pointer updated: ${dirs.root}/latest_run.json → ${RUN_DIR}`);
  }

  // Update neighborhood registry (skip for dry runs)
  if (!dryRun) {
    updateNeighborhoodRegistry(NEIGHBORHOOD, ORIGIN_LAT, ORIGIN_LON, LOCATION_LABEL, {
      total: allRecords.size,
      withWebsite: withWebsite.length,
      cost: finalCost,
      outputFile: XLSX_PATH,
      batchFailures,
    });
  }

  // Final stats
  log(`\n${'═'.repeat(50)}`);
  log(`Neighborhood:          ${NEIGHBORHOOD}`);
  log(`Businesses kept:       ${withWebsite.length}`);
  log(`  Closed removed:      ${closedCount}`);
  log(`  Social-only removed: ${socialOnlyCount}`);
  log(`  No-website removed:  ${noWebsiteCount}`);
  log(`Total unique (all):    ${allRecords.size}`);
  log(`API records received:  ${cumulativeApiRecords}`);
  log(`Batch failures:        ${batchFailures}`);
  log(`Estimated cost:        $${finalCost.toFixed(2)}`);
  log(`File:                  ${XLSX_PATH}`);
  log(`Duration:              ${Math.round((endTime - startTime) / 1000)}s`);
  if (batchFailures > 0) {
    log(`WARNING: ${batchFailures} batch(es) failed — re-run to recover missing leads.`);
  }

  return { total: withWebsite.length, cost: finalCost, path: XLSX_PATH };
}

// ─── CLI Entry ────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run');
runScraper(isDryRun).catch((err) => {
  log(`FATAL ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
});
