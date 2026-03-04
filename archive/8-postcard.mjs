// pipeline/8-postcard.mjs — Generate personalised sales proposal PDF per lead
//
// Usage:
//   node pipeline/8-postcard.mjs
//   node pipeline/8-postcard.mjs --neighborhood maria_de_molina
//   node pipeline/8-postcard.mjs --neighborhood maria_de_molina --dry-run
//   node pipeline/8-postcard.mjs --neighborhood maria_de_molina --lead area2_instalaciones_eléctricas_y_mecánicas_s_a
//
// Step 1: load content.json + images per lead
// Step 2: call Claude Haiku to generate Spanish sales copy → save {slug}_email.json
// Step 3: render 2-page portrait A4 HTML → PDF via Playwright
//
// Resumable: skips leads where {slug}_postcard.pdf already exists.

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { chromium } from 'playwright'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync
} from 'fs'
import { join, resolve } from 'path'
import { getNeighborhoodName, sanitizeName, getTargetLeads } from './utils.mjs'

// ── Config ───────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName()
const INPUT_FILE = `output/leads_audited_${NEIGHBORHOOD}.xlsx`
const CONTENT_DIR = `output/content_${NEIGHBORHOOD}`
const SCREENSHOTS_DIR = `output/screenshots_${NEIGHBORHOOD}`
const POSTCARDS_DIR = `output/postcards_${NEIGHBORHOOD}`
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 1000
const RATE_LIMIT_MS = 1000

// Haiku 4.5 pricing
const INPUT_CPT = 0.8 / 1_000_000 // $0.80/MTok
const OUTPUT_CPT = 4.0 / 1_000_000 // $4.00/MTok

// ── CLI flags ────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run')

function getLeadFilter() {
  const idx = process.argv.indexOf('--lead')
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null
}
const LEAD_FILTER = getLeadFilter()

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fileSizeKB(p) {
  try {
    return (statSync(p).size / 1024).toFixed(1)
  } catch {
    return '?'
  }
}

function toDataUri(filePath) {
  if (!filePath || !existsSync(filePath)) return null
  const ext = filePath.split('.').pop().toLowerCase()
  const mime =
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp'
    }[ext] || 'image/png'
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`
}

function extractCity(content) {
  const addr = content.full_address || ''
  for (const part of addr
    .split(',')
    .map((p) => p.trim())
    .reverse()) {
    if (part.length > 2 && !/^\d{5}/.test(part)) return part
  }
  return 'Madrid'
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url || ''
  }
}

function readContentJson(safeName) {
  const p = join(CONTENT_DIR, safeName, 'content.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

// ── LLM prompt ────────────────────────────────────────────────────────────────

function buildLlmPrompt(content) {
  return `Genera copy de ventas para una propuesta de rediseño web dirigida a esta empresa española:

Empresa: ${content.name}
Categoría: ${content.category}
Web actual: ${content.url || content.website || 'N/A'}
Puntuación de auditoría: ${content.score}/100 (${content.tier})
Problemas detectados: ${content.pitch_angle}
Teléfono: ${content.phone || 'No disponible'}
Ciudad: ${extractCity(content)}

Devuelve exactamente este JSON:
{
  "headline": "frase gancho de 8-12 palabras que mencione el nombre de la empresa y el problema principal",
  "issue_title": "título de sección: 3-4 palabras (ej: 'Lo que encontramos')",
  "issues": ["problema 1 en 10-15 palabras", "problema 2 en 10-15 palabras", "problema 3 en 10-15 palabras"],
  "after_title": "título de sección: 3-4 palabras (ej: 'Su nueva presencia digital')",
  "benefits": [
    {"title": "título del beneficio en 3-5 palabras", "desc": "explicación en 20-30 palabras, específica para esta empresa"},
    {"title": "título del beneficio en 3-5 palabras", "desc": "explicación en 20-30 palabras, específica para esta empresa"},
    {"title": "título del beneficio en 3-5 palabras", "desc": "explicación en 20-30 palabras, específica para esta empresa"},
    {"title": "título del beneficio en 3-5 palabras", "desc": "explicación en 20-30 palabras, específica para esta empresa"}
  ],
  "offer_title": "título de sección: 3-4 palabras",
  "offer_blurb": "2 frases explicando qué hace mejoraweb y por qué es la solución ideal para esta empresa",
  "cta_headline": "llamada a la acción de 6-10 palabras",
  "email_subject": "asunto del email de 6-10 palabras, personalizado para esta empresa, que invite a abrir",
  "email_body": "cuerpo del email en español, 5-6 líneas, tono profesional y cercano, menciona que se adjunta una propuesta personalizada con el rediseño de su web, invita a responder o llamar para agendar una llamada de 15 minutos sin compromiso. Firma como equipo mejoraweb."
}`
}

// ── HTML template ─────────────────────────────────────────────────────────────
// Design source: pipeline/_gen_preview.mjs — port CSS here whenever template is updated.
// Height budget:
//   Page 1: topbar(18mm) + p1-content(flex:1) + pgfoot(8mm) = 297mm
//   Page 2: topbar(18mm) + p2-body(flex:1) + pgfoot(8mm) = 297mm
//     p2-body: hero(32mm) + middle(flex:1) + banner(36mm) + cta(42mm) = 271mm ✓
//
// Note: no Google Fonts (Playwright headless has no network access).
// Uses system sans-serif + Georgia for serif headings.

// Inline SVG icons — feather-style, stroke-based, render cleanly in Playwright.
const BENEFIT_ICONS = [
  // Smartphone
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1" fill="#f59e0b" stroke="none"/></svg>`,
  // Shield check
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
  // Trending up
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  // Map pin
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
]

function buildHtml(content, copy, desktopUri, mockUri, logoUri, mobileUri) {
  const name   = content.name || 'Empresa'
  const domain = extractDomain(content.url || content.website || '')

  // Topbar: logo pill (if available) + "mejoraweb" brand + amber badge
  const logoPillHtml = logoUri
    ? `<div class="logo-pill"><img src="${logoUri}" alt="${name}"></div>`
    : ''

  const topbarHtml = `<div class="topbar">
    <div class="topbar-brand">
      ${logoPillHtml}
      <div>
        <div class="brand-name">mejoraweb</div>
        <div class="brand-sub">Diseño web para negocios locales</div>
      </div>
    </div>
    <div class="topbar-badge"><div class="badge-dot"></div>Propuesta exclusiva</div>
  </div>`

  // Issue rows — numbered pills + single string
  const issueRowsHtml = (copy.issues || [])
    .map((text, i) => `
    <div class="issue-row">
      <div class="issue-num">0${i + 1}</div>
      <div class="issue-body">${text}</div>
    </div>`)
    .join('')

  // Benefit cards — {title, desc} × 4, SVG icons; backwards-compat with plain strings
  const benefitCardsHtml = (copy.benefits || [])
    .slice(0, 4)
    .map((b, i) => {
      const title = typeof b === 'string' ? b : b.title || ''
      const desc  = typeof b === 'string' ? '' : b.desc  || ''
      const icon  = BENEFIT_ICONS[i] || BENEFIT_ICONS[0]
      return `
    <div class="benefit-card">
      <div class="benefit-icon">${icon}</div>
      <div class="benefit-body">
        <div class="benefit-title">${title}</div>
        ${desc ? `<div class="benefit-desc">${desc}</div>` : ''}
      </div>
    </div>`
    })
    .join('')

  // Desktop screenshot in browser frame (required)
  const imgOrPh = (uri, alt) => uri
    ? `<img src="${uri}" alt="${alt}">`
    : `<div class="ph">${alt}</div>`

  const browserFrameHtml = `
    <div class="bframe">
      <div class="bchrome">
        <div class="bdots">
          <div class="bdot bdot-r"></div>
          <div class="bdot bdot-y"></div>
          <div class="bdot bdot-g"></div>
        </div>
        <div class="burl-bar">${domain}</div>
      </div>
      <div class="bscreenshot">${imgOrPh(desktopUri, 'Sitio web actual')}</div>
    </div>
    <div class="bframe-caption">Su web hoy · ${domain}</div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light">
<style>
/* ── Reset ──────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4 portrait; margin: 0; }
html, body {
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  font-family: 'Helvetica Neue', Arial, Helvetica, sans-serif;
  color: #0f172a;
}

/* ── Page card ──────────────────────────────────────────────── */
.page {
  width: 210mm; height: 297mm;
  overflow: hidden;
  display: flex; flex-direction: column;
  background: #f8fafc;
  page-break-after: always;
}
.page:last-child { page-break-after: avoid; }

/* ── Topbar — 18mm ──────────────────────────────────────────── */
.topbar {
  flex-shrink: 0; height: 18mm;
  background: #0f172a;
  border-bottom: 2.5px solid #f59e0b;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 9mm;
}
.topbar-brand { display: flex; align-items: center; gap: 10px; }
.logo-pill {
  background: #fff; border-radius: 4px; padding: 3px 7px;
  display: flex; align-items: center; flex-shrink: 0;
}
.logo-pill img { height: 20px; display: block; }
.brand-name { font-weight: 700; font-size: 15px; color: #f59e0b; letter-spacing: -0.02em; line-height: 1.1; }
.brand-sub  { font-size: 9px; color: #475569; letter-spacing: 0.03em; }
.topbar-badge {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(245,158,11,0.10);
  border: 1px solid rgba(245,158,11,0.28);
  border-radius: 3px; padding: 4px 10px;
  font-size: 9px; font-weight: 700; letter-spacing: 0.12em;
  color: #f59e0b; text-transform: uppercase;
}
.badge-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #f59e0b; flex-shrink: 0;
}

/* ── Page footer — 8mm ──────────────────────────────────────── */
.pgfoot {
  flex-shrink: 0; height: 8mm;
  background: #0f172a;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 9mm;
  font-size: 9px; color: #475569;
}
.pgfoot.centered { justify-content: center; }
.pgfoot .hi { color: #64748b; }

/* ── Section label ──────────────────────────────────────────── */
.slabel {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: #f59e0b;
}

/* ══════════════════════════════════════════════════════════
   PAGE 1 — ANÁLISIS
   ══════════════════════════════════════════════════════════ */

.p1-content {
  flex: 1; padding: 7mm 9mm 5mm;
  overflow: hidden;
  display: flex; flex-direction: column; min-height: 0;
}
.p1-slabel { margin-bottom: 3.5mm; flex-shrink: 0; }
.p1-headline {
  font-family: Georgia, 'Times New Roman', Times, serif;
  font-size: 27px; color: #0f172a; line-height: 1.25;
  margin-bottom: 5mm; flex-shrink: 0;
}

/* Issue rows */
.issues {
  flex-shrink: 0;
  display: flex; flex-direction: column;
  border-top: 1px solid #e2e8f0; margin-bottom: 4.5mm;
}
.issue-row {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 3.2mm 0; border-bottom: 1px solid #f1f5f9;
}
.issue-num {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
  background: #0f172a; color: #f59e0b;
  font-size: 9.5px; font-weight: 800;
  display: flex; align-items: center; justify-content: center; margin-top: 1px;
}
.issue-body { flex: 1; min-width: 0; font-size: 11px; color: #475569; line-height: 1.55; }

/* Browser frame — fills remaining height */
.bframe-wrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.bframe {
  flex: 1; border: 1.5px solid #cbd5e1; border-radius: 7px;
  overflow: hidden; display: flex; flex-direction: column; min-height: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.07), 0 8px 24px rgba(0,0,0,0.10);
}
.bchrome {
  flex-shrink: 0; height: 8.5mm;
  background: linear-gradient(180deg, #e8ecf1 0%, #dce1e8 100%);
  display: flex; align-items: center; padding: 0 10px; gap: 8px;
  border-bottom: 1px solid #cdd4dc;
}
.bdots { display: flex; gap: 5px; flex-shrink: 0; }
.bdot { width: 9px; height: 9px; border-radius: 50%; }
.bdot-r { background: #fc5753; } .bdot-y { background: #fdbc40; } .bdot-g { background: #33c748; }
.burl-bar {
  flex: 1; background: #fff; border: 1px solid #dde2e8; border-radius: 4px;
  padding: 3.5px 10px; font-size: 9.5px; color: #64748b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bscreenshot { flex: 1; overflow: hidden; }
.bscreenshot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.ph { width: 100%; height: 100%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 10px; }
.bframe-caption {
  flex-shrink: 0; margin-top: 2.5mm;
  font-size: 8.5px; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.09em; text-align: center;
}

/* ══════════════════════════════════════════════════════════
   PAGE 2 — SOLUCIÓN
   p2-body: hero(32mm) + middle(flex:1) + banner(36mm) + cta(42mm) = 271mm ✓
   ══════════════════════════════════════════════════════════ */

.p2-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

/* Hero — 32mm */
.p2-hero {
  flex-shrink: 0; height: 32mm;
  background:
    radial-gradient(ellipse at 10% 65%, rgba(245,158,11,0.13) 0%, transparent 42%),
    radial-gradient(ellipse at 85% 20%, rgba(245,158,11,0.07) 0%, transparent 38%),
    linear-gradient(140deg, #0c1623 0%, #0f172a 45%, #16213a 100%);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 0 12mm; text-align: center; gap: 3mm;
}
.hero-title {
  font-family: Georgia, 'Times New Roman', Times, serif;
  font-size: 25px; color: #fff; line-height: 1.22; letter-spacing: -0.01em;
}
.hero-tags { display: flex; gap: 2.5mm; flex-wrap: wrap; justify-content: center; }
.hero-tag {
  font-size: 9px; font-weight: 700; color: #f59e0b;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 2.5px 7px; border: 1px solid rgba(245,158,11,0.32); border-radius: 3px;
}

/* Middle — flex:1 (~161mm) */
.p2-middle { flex: 1; display: flex; overflow: hidden; min-height: 0; }

/* Offer column — left 52% */
.p2-offer-col {
  flex: 0 0 52%; background: #f8fafc; padding: 7mm 8mm;
  overflow: hidden; display: flex; flex-direction: column;
  border-right: 1px solid #e2e8f0;
}
.offer-col-header {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 3.5mm; border-bottom: 1px solid #e2e8f0;
  margin-bottom: 4mm; flex-shrink: 0;
}
.offer-accent-bar {
  width: 3px; height: 18px;
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
  border-radius: 2px; flex-shrink: 0;
}
.offer-blurb { font-size: 10.5px; color: #475569; line-height: 1.65; margin-bottom: 4.5mm; flex-shrink: 0; }
.offer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 2.5mm; flex-shrink: 0; }
.offer-item {
  display: flex; align-items: center; gap: 5px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 5px;
  padding: 4px 8px; font-size: 10px; color: #334155; font-weight: 500; line-height: 1.3;
}
.offer-check { color: #f59e0b; font-weight: 900; font-size: 11px; flex-shrink: 0; }
.no-perm {
  margin-top: auto; padding-top: 3.5mm; border-top: 1px dashed #e2e8f0;
  font-size: 9.5px; color: #94a3b8; font-style: italic; flex-shrink: 0; line-height: 1.5;
}

/* Benefit column — right 48% */
.p2-benefit-col {
  flex: 0 0 48%; background: #fff; padding: 7mm 8mm;
  overflow: hidden; display: flex; flex-direction: column;
}
.benefit-col-header { padding-bottom: 3.5mm; border-bottom: 1px solid #f1f5f9; margin-bottom: 4mm; flex-shrink: 0; }
.benefit-items { flex: 1; display: flex; flex-direction: column; gap: 3mm; min-height: 0; }
.benefit-card {
  flex: 1; display: flex; align-items: center; gap: 9px;
  background: #f8fafc; border-radius: 7px;
  border-left: 3px solid #f59e0b; padding: 8px 9px 8px 8px; min-height: 0;
}
.benefit-icon {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%;
  background: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 4px rgba(0,0,0,0.09);
}
.benefit-body { flex: 1; min-width: 0; }
.benefit-title { font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 2px; line-height: 1.3; }
.benefit-desc  { font-size: 10px; color: #64748b; line-height: 1.55; }

/* Price banner — 36mm */
.p2-banner {
  flex-shrink: 0; height: 36mm;
  background: linear-gradient(135deg, #0c1623 0%, #0f172a 60%, #141f30 100%);
  border-top: 3px solid #f59e0b;
  display: flex; align-items: center; padding: 0 9mm;
}
.banner-pkg { flex: 1; padding-right: 7mm; }
.banner-pkg-eyebrow {
  font-size: 8.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.14em; color: #f59e0b; margin-bottom: 2mm;
}
.banner-pkg-name { font-size: 14px; font-weight: 700; color: #fff; line-height: 1.3; }
.banner-vr { width: 1px; height: 22mm; background: rgba(255,255,255,0.10); flex-shrink: 0; }
.banner-price-block { padding: 0 7mm; display: flex; flex-direction: column; align-items: center; }
.banner-desde {
  font-size: 8.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.10em; color: #64748b; margin-bottom: -1.5mm;
}
.banner-price {
  font-family: Georgia, 'Times New Roman', Times, serif;
  font-size: 52px; color: #f59e0b; line-height: 1; letter-spacing: -0.02em;
}
.banner-details { padding-left: 7mm; border-left: 1px solid rgba(255,255,255,0.10); text-align: right; }
.banner-detail { font-size: 10px; color: #64748b; line-height: 1.9; }
.banner-detail.em { color: #e2e8f0; font-weight: 600; }

/* CTA — 42mm */
.p2-cta {
  flex-shrink: 0; height: 42mm;
  background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 0 14mm; text-align: center; gap: 2.5mm; overflow: hidden;
}
.cta-headline {
  font-family: Georgia, 'Times New Roman', Times, serif;
  font-size: 24px; color: #0f172a; line-height: 1.22; flex-shrink: 0;
}
.cta-sub { font-size: 10.5px; color: rgba(15,23,42,0.65); line-height: 1.5; flex-shrink: 0; max-width: 130mm; }
.cta-contacts { display: flex; gap: 3mm; align-items: center; justify-content: center; flex-shrink: 0; }
.cta-pill {
  display: inline-flex; align-items: center;
  background: #0f172a; color: #f8fafc;
  font-size: 10.5px; font-weight: 500;
  padding: 4.5px 12px; border-radius: 20px; white-space: nowrap;
}
.cta-pill.accent { color: #f59e0b; font-weight: 700; }
</style>
</head>
<body>

<!-- ════════════════ PAGE 1 — ANÁLISIS ════════════════ -->
<div class="page">
  ${topbarHtml}
  <div class="p1-content">

    <div class="p1-slabel"><span class="slabel">${copy.issue_title || 'Lo que encontramos'}</span></div>
    <h1 class="p1-headline">${copy.headline}</h1>

    <div class="issues">${issueRowsHtml}</div>

    <div class="bframe-wrap">
      ${browserFrameHtml}
    </div>

  </div>
  <div class="pgfoot">
    <span>${domain}</span>
    <span class="hi">mejoraweb.app &nbsp;·&nbsp; Página 1 de 2</span>
  </div>
</div>

<!-- ════════════════ PAGE 2 — SOLUCIÓN ════════════════ -->
<div class="page">
  ${topbarHtml}
  <div class="p2-body">

    <div class="p2-hero">
      <div class="hero-title">${copy.after_title}</div>
      <div class="hero-tags">
        <span class="hero-tag">Responsive</span>
        <span class="hero-tag">SSL activo</span>
        <span class="hero-tag">Google-ready</span>
        <span class="hero-tag">Diseño a medida</span>
        <span class="hero-tag">Sin permanencia</span>
      </div>
    </div>

    <div class="p2-middle">

      <div class="p2-offer-col">
        <div class="offer-col-header">
          <div class="offer-accent-bar"></div>
          <span class="slabel">${copy.offer_title || 'Nuestra propuesta'}</span>
        </div>
        <p class="offer-blurb">${copy.offer_blurb}</p>
        <div class="offer-grid">
          <div class="offer-item"><span class="offer-check">✓</span>Diseño moderno responsive</div>
          <div class="offer-item"><span class="offer-check">✓</span>Optimización Google</div>
          <div class="offer-item"><span class="offer-check">✓</span>Formulario de contacto</div>
          <div class="offer-item"><span class="offer-check">✓</span>Hosting incluido 1 año</div>
          <div class="offer-item"><span class="offer-check">✓</span>Dominio incluido</div>
          <div class="offer-item"><span class="offer-check">✓</span>Soporte post-lanzamiento</div>
        </div>
        <p class="no-perm">Sin permanencia · Sin costes ocultos · Entrega garantizada en 7 días</p>
      </div>

      <div class="p2-benefit-col">
        <div class="benefit-col-header">
          <span class="slabel">Lo que cambia para usted</span>
        </div>
        <div class="benefit-items">${benefitCardsHtml}</div>
      </div>

    </div>

    <div class="p2-banner">
      <div class="banner-pkg">
        <div class="banner-pkg-eyebrow">Paquete completo</div>
        <div class="banner-pkg-name">Rediseño web<br>profesional</div>
      </div>
      <div class="banner-vr"></div>
      <div class="banner-price-block">
        <div class="banner-desde">Desde</div>
        <div class="banner-price">€299</div>
      </div>
      <div class="banner-vr"></div>
      <div class="banner-details">
        <div class="banner-detail em">Pago único</div>
        <div class="banner-detail">Entrega en 7 días</div>
        <div class="banner-detail">Sin permanencia</div>
      </div>
    </div>

    <div class="p2-cta">
      <div class="cta-headline">${copy.cta_headline}</div>
      <div class="cta-sub">Responda a este email o escríbanos — revisamos su caso sin ningún compromiso y sin coste.</div>
      <div class="cta-contacts">
        <div class="cta-pill">hola@mejoraweb.app</div>
        <div class="cta-pill accent">mejoraweb.app</div>
      </div>
    </div>

  </div>
  <div class="pgfoot centered">
    <span class="hi">mejoraweb © 2026 &nbsp;·&nbsp; Propuesta exclusiva para ${name}</span>
  </div>
</div>

</body>
</html>`
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!LEAD_FILTER && !existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`)
    console.error(
      `        Run the auditor first: node pipeline/2-auditor.mjs --neighborhood ${NEIGHBORHOOD}`
    )
    console.error(
      `        Or use --lead <safeName> to process a single lead directly.`
    )
    process.exit(1)
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!isDryRun && (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.trim() === '')) {
    console.error('[ERROR] ANTHROPIC_API_KEY not set in .env')
    process.exit(1)
  }

  mkdirSync(POSTCARDS_DIR, { recursive: true })

  const client = isDryRun ? null : new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  // Build lead list
  let leads
  if (LEAD_FILTER) {
    const content = readContentJson(LEAD_FILTER)
    if (!content) {
      console.error(
        `[ERROR] content.json not found for --lead "${LEAD_FILTER}"`
      )
      console.error(
        `        Expected: ${join(CONTENT_DIR, LEAD_FILTER, 'content.json')}`
      )
      process.exit(1)
    }
    leads = [{ name: content.name, _safeName: LEAD_FILTER }]
  } else {
    leads = getTargetLeads(INPUT_FILE).map((l) => ({
      ...l,
      _safeName: sanitizeName(l.name)
    }))
  }

  if (leads.length === 0) {
    console.log(`[POSTCARD] No target leads found in ${INPUT_FILE}`)
    process.exit(0)
  }

  console.log(`[POSTCARD] Neighborhood : ${NEIGHBORHOOD}`)
  console.log(
    `[POSTCARD] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`
  )
  console.log(
    `[POSTCARD] Mode         : ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`
  )
  console.log(`[POSTCARD] Model        : ${MODEL}`)
  console.log(`[POSTCARD] Output       : ${POSTCARDS_DIR}/`)

  const browser = isDryRun ? null : await chromium.launch({ headless: true })

  const startTime = Date.now()
  let processed = 0,
    skipped = 0,
    errors = 0,
    dryRunCount = 0
  let totalIn = 0,
    totalOut = 0

  for (const lead of leads) {
    const safeName = lead._safeName
    const pdfPath = join(POSTCARDS_DIR, `${safeName}_postcard.pdf`)
    const emailPath = join(POSTCARDS_DIR, `${safeName}_email.json`)
    const displayName = LEAD_FILTER ? safeName : lead.name || safeName

    // Resumable
    if (!isDryRun && existsSync(pdfPath)) {
      console.log(`[POSTCARD] SKIP  ${displayName} — postcard.pdf exists`)
      skipped++
      continue
    }

    const content = readContentJson(safeName)
    if (!content) {
      console.log(`[POSTCARD] SKIP  ${displayName} — content.json not found`)
      skipped++
      continue
    }

    // mockdesign_preview.png is required
    const mockPreviewPath = join(
      CONTENT_DIR,
      safeName,
      'mockdesign_preview.png'
    )
    if (!existsSync(mockPreviewPath)) {
      console.log(
        `[POSTCARD] SKIP  ${displayName} — mockdesign_preview.png not found (run stage 7 first)`
      )
      skipped++
      continue
    }

    // Load images (desktop + mobile optional, logo optional)
    const desktopPath = join(SCREENSHOTS_DIR, `${safeName}_desktop.png`)
    const mobilePath = join(SCREENSHOTS_DIR, `${safeName}_mobile.png`)
    const logoPath = join(CONTENT_DIR, safeName, 'logo.png')
    const mockUri = toDataUri(mockPreviewPath)
    const desktopUri = toDataUri(desktopPath)
    const mobileUri = toDataUri(mobilePath)
    const logoUri = toDataUri(logoPath)

    if (!desktopUri) {
      console.log(
        `  [WARN] ${displayName}: desktop screenshot missing — using placeholder`
      )
    }
    if (!mobileUri) {
      console.log(
        `  [INFO] ${displayName}: no mobile screenshot — showing desktop only`
      )
    }

    // ── Dry run ─────────────────────────────────────────────────────────────
    if (isDryRun) {
      dryRunCount++
      console.log(`\n${'═'.repeat(70)}`)
      console.log(`DRY RUN — Lead ${dryRunCount}: ${displayName}`)
      console.log(`PDF would be: ${pdfPath}`)
      console.log(`${'─'.repeat(70)}`)
      console.log('LLM PROMPT:')
      console.log(buildLlmPrompt(content))
      if (dryRunCount >= 2) break
      continue
    }

    process.stdout.write(`[POSTCARD] GEN  ${displayName} ... `)

    // ── Step 2: LLM call ─────────────────────────────────────────────────────
    let copy
    try {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system:
          'Eres un experto en marketing digital y ventas B2B para pequeñas empresas españolas. Generas copy profesional, directo y de confianza. Nunca uses jerga técnica innecesaria. Responde ÚNICAMENTE con JSON válido, sin markdown, sin backticks, sin explicaciones.',
        messages: [{ role: 'user', content: buildLlmPrompt(content) }]
      })

      const raw = message.content[0]?.text?.trim() || ''
      totalIn += message.usage.input_tokens
      totalOut += message.usage.output_tokens
      const cost =
        message.usage.input_tokens * INPUT_CPT +
        message.usage.output_tokens * OUTPUT_CPT

      // Strip markdown code fences (Haiku sometimes wraps JSON despite instructions)
      const jsonStr = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim()

      try {
        copy = JSON.parse(jsonStr)
      } catch {
        console.log(`✗ JSON PARSE ERROR`)
        console.error(`  [RAW] ${raw.slice(0, 300)}`)
        errors++
        continue
      }

      writeFileSync(
        emailPath,
        JSON.stringify({ lead: displayName, ...copy }, null, 2)
      )
      process.stdout.write(`copy ✓ ($${cost.toFixed(4)}) ... `)
    } catch (err) {
      console.log(`✗ LLM ERROR`)
      console.error(`  [ERROR] ${err.message}`)
      errors++
      continue
    }

    // ── Step 3: Playwright render ────────────────────────────────────────────
    const page = await browser.newPage()
    try {
      const html = buildHtml(content, copy, desktopUri, mockUri, logoUri, mobileUri)
      await page.setContent(html, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        landscape: false,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      })

      console.log(`pdf ✓ (${fileSizeKB(pdfPath)}KB)`)

      if (LEAD_FILTER) {
        console.log(`\n  PDF   : file://${resolve(pdfPath)}`)
        console.log(`  Email : file://${resolve(emailPath)}`)
      }

      processed++
    } catch (err) {
      console.log(`✗ RENDER ERROR`)
      console.error(`  [ERROR] ${err.message}`)
      errors++
    } finally {
      await page.close()
    }

    if (leads.indexOf(lead) < leads.length - 1) {
      await sleep(RATE_LIMIT_MS)
    }
  }

  if (browser) await browser.close()

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
  const totalCost = totalIn * INPUT_CPT + totalOut * OUTPUT_CPT

  if (isDryRun) {
    console.log(
      `\n[POSTCARD] Dry run complete — ${dryRunCount} prompt(s) printed, no API calls made`
    )
    return
  }

  console.log('\n' + '═'.repeat(50))
  console.log('  POSTCARD GENERATION COMPLETE')
  console.log('═'.repeat(50))
  console.log(`  Neighborhood : ${NEIGHBORHOOD}`)
  console.log(`  Processed    : ${processed}`)
  console.log(`  Skipped      : ${skipped}`)
  console.log(`  Errors       : ${errors}`)
  console.log(`  Duration     : ${elapsed}s`)
  console.log(`  LLM tokens   : ${totalIn} in / ${totalOut} out`)
  console.log(`  Total cost   : $${totalCost.toFixed(4)}`)
  console.log(`  Output       : ${POSTCARDS_DIR}/`)
  console.log('═'.repeat(50))
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
