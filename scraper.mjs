import 'dotenv/config';
import * as XLSX from 'xlsx';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');
const XLSX_PATH = join(OUTPUT_DIR, 'businesses_near_maria_de_molina.xlsx');
const LOG_PATH = join(OUTPUT_DIR, 'scraper_log.txt');

// Ensure output dir exists
mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.OUTSCRAPER_API_KEY;
if (!API_KEY || API_KEY === '<key goes here>') {
  console.error('ERROR: Set OUTSCRAPER_API_KEY in .env');
  process.exit(1);
}

const ORIGIN_LAT = 40.437750;
const ORIGIN_LON = -3.681861;
const BASE_URL = 'https://api.outscraper.cloud/google-maps-search';
const POLL_URL = 'https://api.outscraper.cloud/requests';
const BUDGET_LIMIT = 18; // $18 hard stop, $2 safety margin
const FREE_TIER = 500;
const COST_PER_1000 = 3;
const FETCH_TIMEOUT = 300_000; // 5 minutes
const BATCH_DELAY = 5_000; // 5 seconds between batches
const POLL_INTERVAL = 30_000; // 30 seconds
const MAX_RETRIES = 3;

const FIELDS = [
  'query', 'name', 'full_address', 'street', 'postal_code', 'city', 'state',
  'country', 'latitude', 'longitude', 'website', 'phone', 'type', 'category',
  'subtypes', 'rating', 'reviews', 'photos_count', 'place_id', 'google_id',
  'working_hours', 'description', 'located_in'
].join(',');

const BATCHES = [
  [
    'restaurantes María de Molina Madrid',
    'abogados María de Molina Madrid',
    'dentistas María de Molina Madrid',
    'clínicas María de Molina Madrid',
    'gimnasios María de Molina Madrid',
    'peluquerías María de Molina Madrid',
    'ópticas María de Molina Madrid',
    'farmacias María de Molina Madrid',
    'veterinarios María de Molina Madrid',
    'academias María de Molina Madrid',
  ],
  [
    'hoteles María de Molina Madrid',
    'inmobiliarias María de Molina Madrid',
    'seguros María de Molina Madrid',
    'gestorías María de Molina Madrid',
    'consultoría María de Molina Madrid',
    'agencias de viajes María de Molina Madrid',
    'tiendas de ropa María de Molina Madrid',
    'cafeterías María de Molina Madrid',
    'fisioterapia María de Molina Madrid',
    'psicólogos María de Molina Madrid',
  ],
  [
    'talleres mecánicos María de Molina Madrid',
    'arquitectos María de Molina Madrid',
    'notarías María de Molina Madrid',
    'empresas de limpieza María de Molina Madrid',
    'electricistas María de Molina Madrid',
    'fontaneros María de Molina Madrid',
    'agencias de marketing María de Molina Madrid',
    'contabilidad María de Molina Madrid',
    'coworking María de Molina Madrid',
    'clínicas dentales María de Molina Madrid',
  ],
];

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

function buildUrl(queries, limit = 500) {
  const url = new URL(BASE_URL);
  for (const q of queries) {
    url.searchParams.append('query', q);
  }
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('coordinates', `${ORIGIN_LAT},${ORIGIN_LON}`);
  url.searchParams.set('dropDuplicates', 'true');
  url.searchParams.set('language', 'es');
  url.searchParams.set('region', 'ES');
  url.searchParams.set('async', 'false');
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
        await sleep(60_000);
        continue;
      }
      if (resp.status === 202) {
        // Async queued — need to poll
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
      }
      throw err;
    }
  }
  return [];
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runScraper(dryRun = false) {
  const startTime = new Date();
  log(`=== Outscraper Lead Scraper Started ===`);
  log(`Origin: ${ORIGIN_LAT}, ${ORIGIN_LON} (María de Molina 31, Madrid)`);
  log(`Mode: ${dryRun ? 'DRY RUN' : 'FULL SCRAPE'}`);

  const allRecords = new Map(); // google_id -> record
  let cumulativeApiRecords = 0;

  const batchesToRun = dryRun
    ? [[BATCHES[0][0]]] // Single query for dry run
    : BATCHES;

  const limitPerQuery = dryRun ? 3 : 500;

  for (let i = 0; i < batchesToRun.length; i++) {
    const batch = batchesToRun[i];
    log(`\n--- Batch ${i + 1}/${batchesToRun.length} (${batch.length} queries) ---`);

    const url = buildUrl(batch, limitPerQuery);
    log(`Fetching: ${batch.length} queries, limit=${limitPerQuery}`);

    const records = await fetchWithRetry(url);
    cumulativeApiRecords += records.length;

    let newCount = 0;
    for (const record of records) {
      const key = record.google_id || record.place_id || `${record.name}_${record.full_address}`;
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

  // Filter for businesses with websites
  const withWebsite = [];
  for (const record of allRecords.values()) {
    if (record.website && record.website.trim() !== '') {
      withWebsite.push(record);
    }
  }
  log(`\nFiltered: ${withWebsite.length} businesses with websites (from ${allRecords.size} total)`);

  // Calculate distance and sort
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

  // Build XLSX
  const rows = withWebsite.map((r) => ({
    distance_meters: r.distance_meters,
    name: r.name || '',
    website: r.website || '',
    phone: r.phone || '',
    category: r.category || r.type || '',
    subtypes: Array.isArray(r.subtypes) ? r.subtypes.join(', ') : (r.subtypes || ''),
    full_address: r.full_address || '',
    postal_code: r.postal_code || '',
    city: r.city || '',
    rating: r.rating || '',
    reviews: r.reviews || '',
    latitude: r.latitude || '',
    longitude: r.longitude || '',
    google_id: r.google_id || '',
    place_id: r.place_id || '',
    working_hours: typeof r.working_hours === 'object' ? JSON.stringify(r.working_hours) : (r.working_hours || ''),
    description: r.description || '',
    query_source: r.query || '',
  }));

  const wb = XLSX.utils.book_new();

  // Main sheet
  const ws = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  ws['!cols'] = [
    { wch: 15 }, // distance_meters
    { wch: 35 }, // name
    { wch: 40 }, // website
    { wch: 18 }, // phone
    { wch: 25 }, // category
    { wch: 40 }, // subtypes
    { wch: 50 }, // full_address
    { wch: 12 }, // postal_code
    { wch: 15 }, // city
    { wch: 8 },  // rating
    { wch: 10 }, // reviews
    { wch: 12 }, // latitude
    { wch: 12 }, // longitude
    { wch: 25 }, // google_id
    { wch: 25 }, // place_id
    { wch: 40 }, // working_hours
    { wch: 50 }, // description
    { wch: 40 }, // query_source
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Businesses');

  // Summary sheet
  const endTime = new Date();
  const finalCost = estimateCost(cumulativeApiRecords);
  const categories = [...new Set(withWebsite.map((r) => r.query || '').filter(Boolean))];

  const summaryData = [
    { metric: 'Total businesses found (with website)', value: withWebsite.length },
    { metric: 'Total unique businesses (after dedup)', value: allRecords.size },
    { metric: 'Total API records received', value: cumulativeApiRecords },
    { metric: 'Estimated API cost', value: `$${finalCost.toFixed(2)}` },
    { metric: 'Categories scraped', value: categories.length },
    { metric: 'Category list', value: categories.join('; ') },
    { metric: 'Date/time of scrape', value: startTime.toISOString() },
    { metric: 'Duration', value: `${Math.round((endTime - startTime) / 1000)}s` },
    { metric: 'Origin coordinates', value: `${ORIGIN_LAT}, ${ORIGIN_LON}` },
    { metric: 'Origin address', value: 'María de Molina 31, Madrid' },
  ];
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);
  summaryWs['!cols'] = [{ wch: 35 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  XLSX.writeFile(wb, XLSX_PATH);
  log(`\nXLSX written to: ${XLSX_PATH}`);

  // Final stats
  log(`\n=== FINAL STATS ===`);
  log(`Total records with website: ${withWebsite.length}`);
  log(`Total unique records (all): ${allRecords.size}`);
  log(`API records received: ${cumulativeApiRecords}`);
  log(`Estimated cost: $${finalCost.toFixed(2)}`);
  log(`File: ${XLSX_PATH}`);
  log(`Duration: ${Math.round((endTime - startTime) / 1000)}s`);

  return { total: withWebsite.length, cost: finalCost, path: XLSX_PATH };
}

// ─── CLI Entry ────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run');
runScraper(isDryRun).catch((err) => {
  log(`FATAL ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
});
