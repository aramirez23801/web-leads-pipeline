// pipeline/_gen_preview.mjs — design template for 8-postcard.mjs
//
// This is the visual design source. Iterate here until approved, then port
// the CSS + HTML structure into buildHtml() in 8-postcard.mjs.
//
// Variable mapping to 8-postcard.mjs:
//   clientName   ← content.name
//   clientDomain ← extractDomain(content.url || content.website)
//   logoB64      ← toDataUri(logoPath)
//   deskB64      ← toDataUri(desktopPath)
//   copy.*       ← LLM JSON output (buildLlmPrompt → claude-haiku)
//
// Height budget:
//   Page 1: topbar(18) + p1-content(flex:1=271) + pgfoot(8) = 297mm
//   Page 2: topbar(18) + p2-body(flex:1=271) + pgfoot(8) = 297mm
//     p2-body: hero(32) + middle(flex:1=161) + banner(36) + cta(42) = 271mm ✓
//
// Usage: node pipeline/_gen_preview.mjs
// Output: pipeline/postcard_template_preview.html

import { readFileSync, writeFileSync } from 'fs'

const LOGO_PATH = 'output/content_maria_de_molina/area2_instalaciones_eléctricas_y_mecánicas_s_a/logo.png'
const DESK_PATH = 'output/screenshots_maria_de_molina/area2_instalaciones_eléctricas_y_mecánicas_s_a_desktop.png'

const logoB64 = 'data:image/png;base64,' + readFileSync(LOGO_PATH).toString('base64')
const deskB64 = 'data:image/png;base64,' + readFileSync(DESK_PATH).toString('base64')

// ── Content variables (← content.json in 8-postcard.mjs) ─────────────────
const clientName   = 'Area2'
const clientDomain = 'area2instalaciones.com'

// ── Copy variables (← LLM output in 8-postcard.mjs) ──────────────────────
// Mirrors the exact JSON structure returned by buildLlmPrompt / claude-haiku.
// benefits[] is now [{title, desc}] × 4 — update LLM prompt to match.
const copy = {
  headline:    'Area2: su web no refleja la calidad de un negocio con más de una década de experiencia',
  issue_title: 'Lo que encontramos',
  issues: [
    'Sin adaptación móvil — el 67% de sus clientes potenciales buscan instaladores desde el teléfono.',
    'Señales de inseguridad activas: los navegadores advierten a sus visitas antes de que puedan contactarles.',
    'Diseño y contenido sin actualizar en más de diez años, dando imagen de negocio estancado.',
  ],
  after_title:  'Su nueva presencia digital, lista en 7 días',
  benefits: [
    { title: 'Clientes desde el móvil',          desc: 'Web optimizada para que cada visita desde el teléfono se convierta en una llamada de presupuesto real. Hoy, dos de cada tres búsquedas de servicios locales ocurren desde móvil.' },
    { title: 'Confianza desde el primer segundo', desc: 'SSL activo y diseño profesional que proyectan solidez antes de que el cliente lea una sola palabra. Una web segura cierra más presupuestos.' },
    { title: 'Visibilidad en Google',             desc: 'Contenido y estructura optimizados para que Area2 aparezca primero cuando alguien en Madrid busca instalaciones eléctricas o mecánicas.' },
    { title: 'Ventaja sobre la competencia',      desc: 'Una presencia moderna diferencia a Area2 de instaladores con webs anticuadas. El cliente elige al que parece más profesional antes de llamar.' },
  ],
  offer_title: 'Nuestra propuesta',
  offer_blurb: 'Hemos diseñado un rediseño específico para Area2: moderno, rápido y optimizado para reflejar su experiencia real y atraer nuevos clientes en Madrid.',
  cta_headline: '¿Le dedicamos 15 minutos?',
}

// ── Benefit SVG icons (inline, no external dependency) ───────────────────
// Feather-style, stroke-based, render cleanly at small sizes in Playwright.
const ICONS = [
  // Smartphone — benefit 0
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2"/>
    <circle cx="12" cy="17" r="1" fill="#f59e0b" stroke="none"/>
  </svg>`,
  // Shield check — benefit 1
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>`,
  // Trending up — benefit 2
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>`,
  // Map pin — benefit 3 (local presence)
  `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>`,
]

const benefitCards = copy.benefits.map((b, i) => `
  <div class="benefit-card">
    <div class="benefit-icon">${ICONS[i]}</div>
    <div class="benefit-body">
      <div class="benefit-title">${b.title}</div>
      <div class="benefit-desc">${b.desc}</div>
    </div>
  </div>`).join('')

const issueRows = copy.issues.map((text, i) => `
  <div class="issue-row">
    <div class="issue-num">0${i + 1}</div>
    <div class="issue-body">${text}</div>
  </div>`).join('')

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Serif+Display:ital@0;1&display=swap');

/* ── Reset ──────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4 portrait; margin: 0; }
html, body {
  background: #64748b;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  font-family: 'DM Sans', 'Helvetica Neue', Arial, sans-serif;
  padding: 28px 0;
}

/* ── Page card ──────────────────────────────────────────── */
.page {
  width: 210mm;
  height: 297mm;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  margin: 0 auto 36px;
  page-break-after: always;
  box-shadow:
    0 2px 4px rgba(0,0,0,0.08),
    0 8px 24px rgba(0,0,0,0.18),
    0 24px 64px rgba(0,0,0,0.22);
}
.page:last-child { page-break-after: avoid; margin-bottom: 28px; }

/* ── Topbar — 18mm ──────────────────────────────────────── */
.topbar {
  flex-shrink: 0;
  height: 18mm;
  background: #0f172a;
  border-bottom: 2.5px solid #f59e0b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 9mm;
}
.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-pill {
  background: #fff;
  border-radius: 4px;
  padding: 3px 7px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.logo-pill img { height: 20px; display: block; }
.brand-name {
  font-weight: 700;
  font-size: 15px;
  color: #f59e0b;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.brand-sub {
  font-size: 9px;
  color: #475569;
  letter-spacing: 0.03em;
}
.topbar-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(245,158,11,0.10);
  border: 1px solid rgba(245,158,11,0.28);
  border-radius: 3px;
  padding: 4px 10px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #f59e0b;
  text-transform: uppercase;
}
.badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #f59e0b;
  flex-shrink: 0;
}

/* ── Page footer — 8mm ──────────────────────────────────── */
.pgfoot {
  flex-shrink: 0;
  height: 8mm;
  background: #0f172a;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 9mm;
  font-size: 9px;
  color: #475569;
}
.pgfoot.centered { justify-content: center; }
.pgfoot .hi { color: #64748b; }

/* ── Section label ──────────────────────────────────────── */
.slabel {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #f59e0b;
}

/* ══════════════════════════════════════════════════════════
   PAGE 1 — ANÁLISIS (← copy.issue_title, copy.headline, copy.issues[])
   ══════════════════════════════════════════════════════════ */

.p1-content {
  flex: 1;
  padding: 7mm 9mm 5mm;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Section label — copy.issue_title */
.p1-slabel { margin-bottom: 3.5mm; flex-shrink: 0; }

/* Headline — copy.headline */
.p1-headline {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 27px;
  color: #0f172a;
  line-height: 1.25;
  margin-bottom: 5mm;
  flex-shrink: 0;
}

/* Issues — copy.issues[] (3 single strings) */
.issues {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #e2e8f0;
  margin-bottom: 4.5mm;
}
.issue-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 3.2mm 0;
  border-bottom: 1px solid #f1f5f9;
}
.issue-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #0f172a;
  color: #f59e0b;
  font-size: 9.5px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.issue-body {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #475569;
  line-height: 1.55;
}

/* Browser frame — fills remaining height */
.bframe-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.bframe {
  flex: 1;
  border: 1.5px solid #cbd5e1;
  border-radius: 7px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow:
    0 2px 8px rgba(0,0,0,0.07),
    0 8px 24px rgba(0,0,0,0.10);
}
.bchrome {
  flex-shrink: 0;
  height: 8.5mm;
  background: linear-gradient(180deg, #e8ecf1 0%, #dce1e8 100%);
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 8px;
  border-bottom: 1px solid #cdd4dc;
}
.bdots { display: flex; gap: 5px; flex-shrink: 0; }
.bdot { width: 9px; height: 9px; border-radius: 50%; }
.bdot-r { background: #fc5753; }
.bdot-y { background: #fdbc40; }
.bdot-g { background: #33c748; }
.burl-bar {
  flex: 1;
  background: #fff;
  border: 1px solid #dde2e8;
  border-radius: 4px;
  padding: 3.5px 10px;
  font-size: 9.5px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bscreenshot {
  flex: 1;
  overflow: hidden;
}
.bscreenshot img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.bframe-caption {
  flex-shrink: 0;
  margin-top: 2.5mm;
  font-size: 8.5px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  text-align: center;
}

/* ══════════════════════════════════════════════════════════
   PAGE 2 — SOLUCIÓN
   p2-body: hero(32) + middle(flex:1=161) + banner(36) + cta(42) = 271mm ✓
   ══════════════════════════════════════════════════════════ */

.p2-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* Hero — 32mm — copy.after_title */
.p2-hero {
  flex-shrink: 0;
  height: 32mm;
  background:
    radial-gradient(ellipse at 10% 65%, rgba(245,158,11,0.13) 0%, transparent 42%),
    radial-gradient(ellipse at 85% 20%, rgba(245,158,11,0.07) 0%, transparent 38%),
    linear-gradient(140deg, #0c1623 0%, #0f172a 45%, #16213a 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 12mm;
  text-align: center;
  gap: 3mm;
}
.hero-title {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 25px;
  color: #fff;
  line-height: 1.22;
  letter-spacing: -0.01em;
}
.hero-tags {
  display: flex;
  gap: 2.5mm;
  flex-wrap: wrap;
  justify-content: center;
}
.hero-tag {
  font-size: 9px;
  font-weight: 700;
  color: #f59e0b;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 2.5px 7px;
  border: 1px solid rgba(245,158,11,0.32);
  border-radius: 3px;
}

/* Middle — flex:1 (~161mm) */
.p2-middle {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ── Offer column — left 52% (copy.offer_title, copy.offer_blurb) ─ */
.p2-offer-col {
  flex: 0 0 52%;
  background: #f8fafc;
  padding: 7mm 8mm;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
}
.offer-col-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 3.5mm;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 4mm;
  flex-shrink: 0;
}
.offer-accent-bar {
  width: 3px;
  height: 18px;
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
  border-radius: 2px;
  flex-shrink: 0;
}
.offer-blurb {
  font-size: 10.5px;
  color: #475569;
  line-height: 1.65;
  margin-bottom: 4.5mm;
  flex-shrink: 0;
}
/* Checklist — hardcoded deliverables, same in all postcards */
.offer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2mm 2.5mm;
  flex-shrink: 0;
}
.offer-item {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 10px;
  color: #334155;
  font-weight: 500;
  line-height: 1.3;
}
.offer-check { color: #f59e0b; font-weight: 900; font-size: 11px; flex-shrink: 0; }
.no-perm {
  margin-top: auto;
  padding-top: 3.5mm;
  border-top: 1px dashed #e2e8f0;
  font-size: 9.5px;
  color: #94a3b8;
  font-style: italic;
  flex-shrink: 0;
  line-height: 1.5;
}

/* ── Benefit column — right 48% (copy.benefits[]) ───────── */
.p2-benefit-col {
  flex: 0 0 48%;
  background: #fff;
  padding: 7mm 8mm;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.benefit-col-header {
  padding-bottom: 3.5mm;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 4mm;
  flex-shrink: 0;
}
.benefit-items {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3mm;
  min-height: 0;
}
/* Each card: SVG icon + {title, desc} from copy.benefits[i] */
/* flex:1 = 4 equal-height cards; align-items:center = content vertically centred */
.benefit-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  background: #f8fafc;
  border-radius: 7px;
  border-left: 3px solid #f59e0b;
  padding: 8px 9px 8px 8px;
  min-height: 0;
}
.benefit-icon {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0,0,0,0.09);
}
.benefit-body { flex: 1; min-width: 0; }
.benefit-title {
  font-size: 11px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 2px;
  line-height: 1.3;
}
.benefit-desc {
  font-size: 10px;
  color: #64748b;
  line-height: 1.55;
}

/* ── Price banner — 36mm ──────────────────────────────────── */
.p2-banner {
  flex-shrink: 0;
  height: 36mm;
  background: linear-gradient(135deg, #0c1623 0%, #0f172a 60%, #141f30 100%);
  border-top: 3px solid #f59e0b;
  display: flex;
  align-items: center;
  padding: 0 9mm;
}
.banner-pkg { flex: 1; padding-right: 7mm; }
.banner-pkg-eyebrow {
  font-size: 8.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #f59e0b;
  margin-bottom: 2mm;
}
.banner-pkg-name {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  line-height: 1.3;
}
.banner-vr {
  width: 1px;
  height: 22mm;
  background: rgba(255,255,255,0.10);
  flex-shrink: 0;
}
.banner-price-block {
  padding: 0 7mm;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.banner-desde {
  font-size: 8.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.10em;
  color: #64748b;
  margin-bottom: -1.5mm;
}
.banner-price {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 52px;
  color: #f59e0b;
  line-height: 1;
  letter-spacing: -0.02em;
}
.banner-details {
  padding-left: 7mm;
  border-left: 1px solid rgba(255,255,255,0.10);
  text-align: right;
}
.banner-detail { font-size: 10px; color: #64748b; line-height: 1.9; }
.banner-detail.em { color: #e2e8f0; font-weight: 600; }

/* ── CTA — 42mm — copy.cta_headline ─────────────────────── */
.p2-cta {
  flex-shrink: 0;
  height: 42mm;
  background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 14mm;
  text-align: center;
  gap: 2.5mm;
  overflow: hidden;
}
.cta-headline {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 24px;
  color: #0f172a;
  line-height: 1.22;
  flex-shrink: 0;
}
.cta-sub {
  font-size: 10.5px;
  color: rgba(15,23,42,0.65);
  line-height: 1.5;
  flex-shrink: 0;
  max-width: 130mm;
}
.cta-contacts {
  display: flex;
  gap: 3mm;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cta-pill {
  display: inline-flex;
  align-items: center;
  background: #0f172a;
  color: #f8fafc;
  font-size: 10.5px;
  font-weight: 500;
  padding: 4.5px 12px;
  border-radius: 20px;
  white-space: nowrap;
}
.cta-pill.accent { color: #f59e0b; font-weight: 700; }
</style>
</head>
<body>

<!-- ════════════════ PAGE 1 — ANÁLISIS ════════════════ -->
<div class="page">

  <div class="topbar">
    <div class="topbar-brand">
      <div class="logo-pill"><img src="${logoB64}" alt="${clientName}"></div>
      <div>
        <div class="brand-name">mejoraweb</div>
        <div class="brand-sub">Diseño web para negocios locales</div>
      </div>
    </div>
    <div class="topbar-badge">
      <div class="badge-dot"></div>
      Propuesta exclusiva
    </div>
  </div>

  <div class="p1-content">

    <!-- copy.issue_title -->
    <div class="p1-slabel">
      <span class="slabel">${copy.issue_title}</span>
    </div>

    <!-- copy.headline -->
    <h1 class="p1-headline">${copy.headline}</h1>

    <!-- copy.issues[] — 3 single strings, numbered -->
    <div class="issues">${issueRows}
    </div>

    <!-- Desktop screenshot of current site -->
    <div class="bframe-wrap">
      <div class="bframe">
        <div class="bchrome">
          <div class="bdots">
            <div class="bdot bdot-r"></div>
            <div class="bdot bdot-y"></div>
            <div class="bdot bdot-g"></div>
          </div>
          <div class="burl-bar">${clientDomain}</div>
        </div>
        <div class="bscreenshot">
          <img src="${deskB64}" alt="Web actual de ${clientName}">
        </div>
      </div>
      <div class="bframe-caption">Su web hoy · ${clientDomain}</div>
    </div>

  </div>

  <div class="pgfoot">
    <span>${clientDomain}</span>
    <span class="hi">mejoraweb.app &nbsp;·&nbsp; Página 1 de 2</span>
  </div>
</div>

<!-- ════════════════ PAGE 2 — SOLUCIÓN ════════════════ -->
<div class="page">

  <div class="topbar">
    <div class="topbar-brand">
      <div class="logo-pill"><img src="${logoB64}" alt="${clientName}"></div>
      <div>
        <div class="brand-name">mejoraweb</div>
        <div class="brand-sub">Diseño web para negocios locales</div>
      </div>
    </div>
    <div class="topbar-badge">
      <div class="badge-dot"></div>
      Propuesta exclusiva
    </div>
  </div>

  <div class="p2-body">

    <!-- Hero — 32mm — copy.after_title -->
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

    <!-- Middle — flex:1 (~161mm) -->
    <div class="p2-middle">

      <!-- Offer — copy.offer_title, copy.offer_blurb + fixed checklist -->
      <div class="p2-offer-col">
        <div class="offer-col-header">
          <div class="offer-accent-bar"></div>
          <p class="slabel">${copy.offer_title}</p>
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

      <!-- Benefits — copy.benefits[] [{title,desc}×4] with SVG icons -->
      <div class="p2-benefit-col">
        <div class="benefit-col-header">
          <p class="slabel">Lo que cambia para usted</p>
        </div>
        <div class="benefit-items">${benefitCards}
        </div>
      </div>

    </div>

    <!-- Price banner — 36mm — hardcoded €299 -->
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

    <!-- CTA — 42mm — copy.cta_headline -->
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
    <span class="hi">mejoraweb © 2026 &nbsp;·&nbsp; Propuesta exclusiva para ${clientName}</span>
  </div>
</div>

</body>
</html>`

writeFileSync('pipeline/postcard_template_preview.html', html, 'utf-8')
console.log(`Written: pipeline/postcard_template_preview.html (${(html.length / 1024).toFixed(0)}KB)`)
