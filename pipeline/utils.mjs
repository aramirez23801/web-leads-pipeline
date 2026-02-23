/**
 * pipeline/utils.mjs — Shared utility functions for the web-leads-pipeline.
 *
 * Import in other pipeline scripts:
 *   import { sanitizeName, getTargetLeads, isValidColor,
 *            extractPrimaryColor, findLogo, getNeighborhoodName } from './utils.mjs';
 *
 * Scripts outside the pipeline/ folder should adjust the path:
 *   import { ... } from '../pipeline/utils.mjs';
 */

import XLSX from 'xlsx';

// ── CDN domains to exclude from logo candidates ──────────────────────────────
const CDN_DOMAINS = [
  'gstatic.com', 'googleapis.com', 'google.com',
  'facebook.com', 'fbcdn.net',
  'cloudflare.com', 'cloudfront.net', 'amazonaws.com',
  'gravatar.com', 'wp.com', 'wordpress.com',
  'bootstrapcdn.com', 'jsdelivr.net', 'unpkg.com',
];

// ── Common CSS named colors ───────────────────────────────────────────────────
const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
  'pink', 'brown', 'gray', 'grey', 'cyan', 'magenta', 'lime', 'maroon',
  'navy', 'olive', 'silver', 'teal', 'aqua', 'fuchsia', 'coral', 'gold',
  'indigo', 'ivory', 'khaki', 'lavender', 'linen', 'salmon', 'sienna',
  'tan', 'tomato', 'turquoise', 'violet', 'wheat',
]);

// ── sanitizeName ─────────────────────────────────────────────────────────────

/**
 * Lowercases a business name, strips special characters (keeps Spanish letters
 * áéíóúñü), replaces spaces with underscores, caps at 50 chars, and trims
 * trailing underscores. Used to create safe filesystem directory names.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s_-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50)
    .replace(/_+$/, '');
}

// ── getTargetLeads ────────────────────────────────────────────────────────────

/**
 * Reads an audited XLSX (output of 2-auditor.mjs) and returns the leads that
 * are worth targeting: all Tier 1 leads plus Tier 2 leads with
 * opportunity_score >= minTier2Score. Deduplicates by URL.
 *
 * @param {string} inputFile - Path to the audited XLSX file.
 * @param {number} [minTier2Score=50] - Minimum score to include Tier 2 leads.
 * @returns {Array<object>}
 */
export function getTargetLeads(inputFile, minTier2Score = 50) {
  const wb = XLSX.readFile(inputFile);

  const tier1Sheet = wb.Sheets['Tier 1 Hot Leads'];
  const allSheet = wb.Sheets['All Leads'];

  const tier1 = tier1Sheet ? XLSX.utils.sheet_to_json(tier1Sheet) : [];
  const allLeads = allSheet ? XLSX.utils.sheet_to_json(allSheet) : [];

  const tier2high = allLeads.filter(
    r => r.tier === 'Tier 2' && r.opportunity_score >= minTier2Score
  );

  const combined = [...tier1, ...tier2high];
  const seen = new Set();

  return combined.filter(lead => {
    const url = lead.final_url || lead.website;
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

// ── isValidColor ─────────────────────────────────────────────────────────────

/**
 * Returns false for colors that are effectively invisible or missing:
 *   - null / undefined / empty string
 *   - "transparent"
 *   - rgba(..., 0) — fully transparent
 *
 * Returns true for valid hex (#rgb / #rrggbb), rgb(...), rgba(...) with alpha > 0,
 * hsl/hsla(...), or common named CSS colors.
 *
 * @param {string|null|undefined} color
 * @returns {boolean}
 */
export function isValidColor(color) {
  if (!color || typeof color !== 'string') return false;
  const c = color.trim().toLowerCase();
  if (!c || c === 'transparent') return false;

  // rgba with alpha = 0 (fully transparent)
  const rgbaMatch = c.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/);
  if (rgbaMatch) return parseFloat(rgbaMatch[1]) > 0;

  // Hex colors: #rgb, #rrggbb, #rrggbbaa
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(c)) return true;

  // rgb(r, g, b)
  if (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(c)) return true;

  // hsl(...) / hsla(...)
  if (/^hsla?\(/.test(c)) return true;

  // Named CSS colors
  if (NAMED_COLORS.has(c)) return true;

  return false;
}

// ── extractPrimaryColor ───────────────────────────────────────────────────────

/**
 * Given a colors object { headerBg, linkColor, bodyBg } (as produced by
 * 4-content.mjs), returns the first valid color in the order:
 *   headerBg → linkColor → bodyBg
 * Falls back to `fallback` if none are valid.
 *
 * @param {{ headerBg?: string, linkColor?: string, bodyBg?: string }} colors
 * @param {string} [fallback='#2563eb']
 * @returns {string}
 */
export function extractPrimaryColor(colors, fallback = '#2563eb') {
  if (!colors || typeof colors !== 'object') return fallback;
  for (const key of ['headerBg', 'linkColor', 'bodyBg']) {
    if (isValidColor(colors[key])) return colors[key];
  }
  return fallback;
}

// ── findLogo ─────────────────────────────────────────────────────────────────

/**
 * Finds the best logo image from a list of scraped image objects
 * ({ src, alt, width, height, isLogo }) produced by 4-content.mjs.
 *
 * 1. Filters out images hosted on third-party CDN domains (see CDN_DOMAINS).
 * 2. From the remaining candidates, returns the first image where:
 *    - src or alt contains "logo", OR
 *    - isLogo === true
 * Returns null if no suitable logo is found.
 *
 * @param {Array<{ src: string, alt: string, isLogo: boolean }>} images
 * @returns {{ src: string, alt: string, isLogo: boolean }|null}
 */
export function findLogo(images) {
  if (!Array.isArray(images) || images.length === 0) return null;

  const isCdnUrl = (src) => {
    try {
      const hostname = new URL(src).hostname.toLowerCase();
      return CDN_DOMAINS.some(cdn => hostname === cdn || hostname.endsWith('.' + cdn));
    } catch {
      return false;
    }
  };

  const candidates = images.filter(img => img.src && !isCdnUrl(img.src));

  return candidates.find(img => {
    const src = (img.src || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    return src.includes('logo') || alt.includes('logo') || img.isLogo === true;
  }) || null;
}

// ── getNeighborhoodName ───────────────────────────────────────────────────────

/**
 * Resolves the current neighborhood name with this priority:
 *   1. --neighborhood <name> or -n <name> CLI flag
 *   2. NEIGHBORHOOD_NAME environment variable
 *   3. Hardcoded default: 'maria_de_molina'
 *
 * @returns {string}
 */
export function getNeighborhoodName() {
  const args = process.argv;
  for (let i = 2; i < args.length; i++) {
    if ((args[i] === '--neighborhood' || args[i] === '-n') && args[i + 1]) {
      return args[i + 1];
    }
  }
  return process.env.NEIGHBORHOOD_NAME || 'maria_de_molina';
}
