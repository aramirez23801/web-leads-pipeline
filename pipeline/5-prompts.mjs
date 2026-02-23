// pipeline/5-prompts.mjs — Generate client briefs for each target lead
//
// Usage:
//   node pipeline/5-prompts.mjs
//   node pipeline/5-prompts.mjs --neighborhood salamanca
//   node pipeline/5-prompts.mjs -n retiro
//
// Reads output/content_{neighborhood}/{lead}/content.json and
// output/leads_audited_{neighborhood}.xlsx, then writes a brief.md into each
// lead folder and copies it to output/briefs_{neighborhood}/ for easy access.
// The briefs are structured for use when building new websites with Claude Code.

import 'dotenv/config';
import XLSX from 'xlsx';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'fs';
import { join } from 'path';
import { getNeighborhoodName, sanitizeName, extractPrimaryColor } from './utils.mjs';

const NEIGHBORHOOD = getNeighborhoodName();
const INPUT_FILE  = `output/leads_audited_${NEIGHBORHOOD}.xlsx`;
const CONTENT_DIR = `output/content_${NEIGHBORHOOD}`;
const BRIEFS_DIR  = `output/briefs_${NEIGHBORHOOD}`;
const SCREENSHOTS_DIR = `output/screenshots_${NEIGHBORHOOD}`;

// ── Load XLSX — build map: sanitizedName → row ────────────────────────────────
function loadLeadMap(xlsxPath) {
  if (!existsSync(xlsxPath)) return new Map();
  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets['All Leads'];
  if (!sheet) return new Map();
  const rows = XLSX.utils.sheet_to_json(sheet);
  const map = new Map();
  for (const row of rows) {
    if (row.name) map.set(sanitizeName(row.name), row);
  }
  return map;
}

// ── Issue flags (from auditor) ────────────────────────────────────────────────
const ISSUE_LABELS = {
  missing_viewport:    'Missing viewport meta tag (not mobile-friendly)',
  no_ssl:              'No SSL certificate (HTTP only)',
  outdated_copyright:  'Outdated copyright year',
  has_dead_tags:       'Dead tracking tags / broken scripts',
  heavy_page:          'Heavy page (slow load times)',
};

function listIssues(row) {
  return Object.entries(ISSUE_LABELS)
    .filter(([key]) => {
      const v = row[key];
      return v === true || v === 1 || v === 'TRUE' || v === 'true';
    })
    .map(([, label]) => `  - ${label}`);
}

// ── Detect existing integrations to preserve ──────────────────────────────────
function detectKeepItems(content) {
  const text = [
    ...(content.sections || []).map(s => `${s.heading || ''} ${s.content || ''}`),
    content.footerText || '',
  ].join(' ').toLowerCase();

  const keep = [];
  if (/reserva|booking|cita\s*previa|appointment/.test(text))
    keep.push('Booking / reservation system');
  if (/google\.com\/maps|maps\.google|goo\.gl\/maps|cómo llegar/.test(text))
    keep.push('Google Maps embed');
  if (/facebook\.com|instagram\.com|twitter\.com|linkedin\.com|tiktok\.com/.test(text))
    keep.push('Social media links');
  if (/whatsapp|wa\.me/.test(text))
    keep.push('WhatsApp contact button');
  if (/tripadvisor|yelp|booking\.com/.test(text))
    keep.push('Review platform links');
  return keep;
}

// ── Build brief.md ────────────────────────────────────────────────────────────
function buildBrief(content, leadRow) {
  const name      = content.name || 'Unknown Business';
  const safeName  = content.safeName || sanitizeName(name);
  const category  = content.category  || leadRow?.category  || '';
  const address   = content.full_address || leadRow?.full_address || '';
  const phone     = content.phone  || leadRow?.phone  || '';
  const website   = content.url    || leadRow?.website || '';
  const rating    = content.rating  ?? leadRow?.rating  ?? null;
  const reviews   = content.reviews ?? leadRow?.reviews ?? null;
  const pitchAngle = content.pitch_angle || leadRow?.pitch_angle || 'Website needs modernization.';
  const score     = content.score ?? leadRow?.opportunity_score ?? 0;
  const tier      = content.tier  || leadRow?.tier  || 'Unknown';

  const primaryColor = extractPrimaryColor(content.colors);
  const linkColor    = content.colors?.linkColor || '';
  const hasLogo      = !!content.logoUrl;

  // Audit issues come from the XLSX row (not stored in content.json)
  const issues = leadRow ? listIssues(leadRow) : [];

  const sections     = (content.sections || []).filter(s => s.heading);
  const phones       = content.contactInfo?.phones || [];
  const emails       = content.contactInfo?.emails || [];
  const keepItems    = detectKeepItems(content);

  const L = [];  // output lines

  L.push(`# Client Brief: ${name}`);
  L.push('');

  // ── Business Info ──────────────────────────────────────────────────────────
  L.push('## Business Info');
  L.push(`- Category: ${category || '—'}`);
  L.push(`- Address: ${address || '—'}`);
  L.push(`- Phone: ${phone || '—'}`);
  L.push(`- Website: ${website || '—'}`);
  if (rating !== null && rating !== undefined && rating !== '') {
    L.push(`- Google Rating: ${rating} (${reviews ?? 0} reviews)`);
  } else {
    L.push('- Google Rating: not available');
  }
  L.push('');

  // ── Why They Need a Redesign ───────────────────────────────────────────────
  L.push('## Why They Need a Redesign');
  L.push('');
  L.push(pitchAngle);
  L.push('');
  L.push(`- Opportunity Score: ${score}/100 (${tier})`);
  if (issues.length > 0) {
    L.push('- Issues found:');
    L.push(...issues);
  } else if (leadRow) {
    L.push('- Issues found: none detected');
  } else {
    L.push('- Issues found: no audit data available (XLSX not found or no matching row)');
  }
  L.push('');

  // ── Current Website Analysis ───────────────────────────────────────────────
  L.push('## Current Website Analysis');
  L.push(`- Title: ${content.title || '—'}`);
  if (content.metaDescription) {
    L.push(`- Meta description: ${content.metaDescription}`);
  }
  if (sections.length > 0) {
    L.push(`- Sections found (${sections.length}):`);
    for (const s of sections) L.push(`  - ${s.heading}`);
  } else {
    L.push('- Sections found: none detected');
  }
  L.push(`- Colors: primary ${primaryColor}${linkColor ? `, links ${linkColor}` : ''}`);
  L.push(`- Has logo: ${hasLogo ? 'Yes' : 'No'}`);
  if (content.scrapeError) {
    L.push(`- Scrape error: ${content.scrapeError}`);
  }
  L.push('');

  // ── Content to Preserve ────────────────────────────────────────────────────
  L.push('## Content to Preserve');
  L.push('');
  if (sections.length > 0) {
    for (const s of sections) {
      L.push(`### ${s.heading}`);
      if (s.content) {
        const excerpt = s.content.length > 400
          ? s.content.substring(0, 400).trimEnd() + '…'
          : s.content;
        L.push(excerpt);
      }
      L.push('');
    }
  } else {
    L.push('No structured sections could be extracted from the current site.');
    L.push('');
  }
  const contactParts = [];
  if (phones.length > 0) contactParts.push(`phone: ${phones.join(', ')}`);
  if (emails.length > 0) contactParts.push(`email: ${emails.join(', ')}`);
  if (address)           contactParts.push(`address: ${address}`);
  L.push(`- Contact info found: ${contactParts.length > 0 ? contactParts.join(' | ') : 'none'}`);
  L.push('');

  // ── Build Instructions ─────────────────────────────────────────────────────
  L.push('## Build Instructions');
  L.push('');
  L.push('This is a frontend-only redesign. Do not change any backend integrations.');
  L.push('');
  if (keepItems.length > 0) {
    L.push('Keep:');
    for (const item of keepItems) L.push(`- ${item}`);
  } else {
    L.push('Keep: no existing integrations detected — build fresh.');
  }
  L.push('');
  L.push('Modernize: mobile-first layout, fast load times, clean typography, clear CTAs');
  L.push(`Primary color suggestion: ${primaryColor}`);
  L.push('');

  // ── Screenshots ────────────────────────────────────────────────────────────
  L.push('## Screenshots');
  L.push(`- Mobile: ${SCREENSHOTS_DIR}/${safeName}_mobile.png`);
  L.push(`- Desktop: ${SCREENSHOTS_DIR}/${safeName}_desktop.png`);
  L.push('');

  return L.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(CONTENT_DIR)) {
    console.error(`[ERROR] Content directory not found: ${CONTENT_DIR}`);
    console.error(`        Run the content scraper first: node pipeline/4-content.mjs --neighborhood ${NEIGHBORHOOD}`);
    process.exit(1);
  }

  if (!existsSync(INPUT_FILE)) {
    console.warn(`[WARN] Audited XLSX not found: ${INPUT_FILE}`);
    console.warn(`       Briefs will be generated from content.json only (no audit flags).`);
  }

  const leadMap = loadLeadMap(INPUT_FILE);
  console.log(`[BRIEFS] Neighborhood: ${NEIGHBORHOOD}`);
  console.log(`[BRIEFS] Lead map loaded: ${leadMap.size} rows from XLSX`);

  mkdirSync(BRIEFS_DIR, { recursive: true });

  // Enumerate lead subdirectories
  const entries = readdirSync(CONTENT_DIR).filter(entry => {
    const fullPath = join(CONTENT_DIR, entry);
    return statSync(fullPath).isDirectory();
  });

  console.log(`[BRIEFS] Content folders found: ${entries.length}`);

  let generated = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const dirName of entries) {
    const contentPath = join(CONTENT_DIR, dirName, 'content.json');
    if (!existsSync(contentPath)) {
      skipped++;
      continue;
    }

    let content;
    try {
      content = JSON.parse(readFileSync(contentPath, 'utf-8'));
    } catch (err) {
      console.warn(`[WARN] Could not parse ${contentPath}: ${err.message}`);
      skipped++;
      continue;
    }

    // Match to XLSX row by sanitized name
    const key = content.safeName || sanitizeName(content.name || dirName);
    const leadRow = leadMap.get(key) || null;
    if (!leadRow) noMatch++;

    const brief = buildBrief(content, leadRow);
    const briefFilename = `${key}_brief.md`;
    const localPath  = join(CONTENT_DIR, dirName, 'brief.md');
    const centralPath = join(BRIEFS_DIR, briefFilename);

    writeFileSync(localPath, brief);
    writeFileSync(centralPath, brief);

    generated++;
    const matchLabel = leadRow ? `score ${leadRow.opportunity_score} ${leadRow.tier}` : 'no XLSX match';
    console.log(`[${generated}] ✓ ${content.name || dirName} — ${matchLabel}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  CLIENT BRIEFS COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Neighborhood:       ${NEIGHBORHOOD}`);
  console.log(`  Briefs generated:   ${generated}`);
  if (skipped > 0)  console.log(`  Skipped (no JSON): ${skipped}`);
  if (noMatch > 0)  console.log(`  No XLSX match:      ${noMatch}`);
  console.log(`  Per-lead:           ${CONTENT_DIR}/<name>/brief.md`);
  console.log(`  Central folder:     ${BRIEFS_DIR}/`);
  console.log('═══════════════════════════════════════════');
}

main();
