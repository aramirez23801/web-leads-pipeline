// pipeline/5-prompts.mjs — Assemble design_prompt.md per lead for stage 6
//
// Usage:
//   node pipeline/5-prompts.mjs
//   node pipeline/5-prompts.mjs --neighborhood salamanca
//   node pipeline/5-prompts.mjs --lead intelma
//
// Reads content.json per Tier 1 + Tier 2 lead and assembles the complete prompt
// string that stage 6 will send verbatim to Claude Sonnet.
// Output: output/content_{neighborhood}/{safeName}/design_prompt.md
//
// Resume-safe: skips leads that already have design_prompt.md.
// Use --lead to re-generate a single lead regardless of skip check.

import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { getNeighborhoodName, sanitizeName, getTargetLeads } from './utils.mjs'

// ── Config ────────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName()
const INPUT_FILE   = `output/leads_audited_${NEIGHBORHOOD}.xlsx`
const CONTENT_DIR  = `output/content_${NEIGHBORHOOD}`
const LOG_FILE     = `output/prompts_${NEIGHBORHOOD}.log`

// ── CLI flags ─────────────────────────────────────────────────────────────────

function getLeadFilter() {
  const idx = process.argv.indexOf('--lead')
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null
}
const LEAD_FILTER = getLeadFilter()

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  appendFileSync(LOG_FILE, line + '\n')
}

function logError(msg) {
  const line = `[${new Date().toISOString()}] [ERROR] ${msg}`
  console.error(line)
  appendFileSync(LOG_FILE, line + '\n')
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function isUsableColor(cssColor) {
  if (!cssColor || cssColor.trim() === '') return false
  const c = cssColor.toLowerCase().replace(/\s/g, '')
  if (c.includes('255,255,255')) return false      // white
  if (c === 'rgba(0,0,0,0)') return false          // transparent
  if (c === 'transparent') return false
  if (c === 'initial' || c === 'inherit') return false
  return true
}

// Priority: buttonBg (CTA color) → primaryVar (CSS token) → headerBg → category default
function resolvePrimaryColor(colors, category) {
  if (isUsableColor(colors?.buttonBg))   return colors.buttonBg
  if (isUsableColor(colors?.primaryVar)) return colors.primaryVar
  if (isUsableColor(colors?.headerBg))   return colors.headerBg

  const cat = (category || '').toLowerCase()
  if (cat.includes('dental') || cat.includes('clínica') || cat.includes('médic'))
    return '#0ea5e9'
  if (cat.includes('abogad') || cat.includes('notari') || cat.includes('gestor'))
    return '#1e40af'
  if (cat.includes('electric') || cat.includes('fontaner') || cat.includes('instalac'))
    return '#f59e0b'
  if (cat.includes('restaur') || cat.includes('café') || cat.includes('bar'))
    return '#dc2626'
  if (cat.includes('inmobiliar') || cat.includes('arquitect'))
    return '#0d9488'
  if (cat.includes('psicolog') || cat.includes('fisioter') || cat.includes('wellness') || cat.includes('spa'))
    return '#7c3aed'
  if (cat.includes('limpiez') || cat.includes('jardin') || cat.includes('mantenimient'))
    return '#16a34a'
  if (cat.includes('peluquer') || cat.includes('estetica') || cat.includes('belleza'))
    return '#ec4899'
  return '#2563eb'
}

// ── Working hours formatter ───────────────────────────────────────────────────

const DAY_ES = {
  lunes: 'Lun', martes: 'Mar', miércoles: 'Mié', jueves: 'Jue',
  viernes: 'Vie', sábado: 'Sáb', domingo: 'Dom',
}
const DAY_ORDER = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

function formatWorkingHours(raw) {
  if (!raw || raw === 'null') return null
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }

  // Group consecutive days with same hours
  const schedule = DAY_ORDER.map(d => ({
    day: d, hours: (parsed[d] || ['Cerrado']).join(', ')
  }))

  const groups = []
  let i = 0
  while (i < schedule.length) {
    let j = i + 1
    while (j < schedule.length && schedule[j].hours === schedule[i].hours) j++
    const days = schedule.slice(i, j).map(s => DAY_ES[s.day])
    const label = days.length === 1
      ? days[0]
      : `${days[0]}–${days[days.length - 1]}`
    groups.push(`${label}: ${schedule[i].hours}`)
    i = j
  }
  return groups.join(' | ')
}

// ── Font pairing by category ──────────────────────────────────────────────────

function getFontPairing(category) {
  const cat = (category || '').toLowerCase()
  if (cat.includes('restaur') || cat.includes('café') || cat.includes('bar'))
    return { heading: 'Oswald', headingWeights: '400;600;700', body: 'Merriweather', bodyWeights: '400;700', feel: 'bold and warm' }
  if (cat.includes('abogad') || cat.includes('notari') || cat.includes('gestor') || cat.includes('asesor'))
    return { heading: 'Playfair Display', headingWeights: '600;700', body: 'Source Sans 3', bodyWeights: '400;600', feel: 'authoritative and trustworthy' }
  if (cat.includes('médic') || cat.includes('clínica') || cat.includes('dental') || cat.includes('salud'))
    return { heading: 'Nunito', headingWeights: '600;700;800', body: 'Open Sans', bodyWeights: '400;600', feel: 'friendly and clean' }
  if (cat.includes('inmobiliar') || cat.includes('arquitect'))
    return { heading: 'Libre Baskerville', headingWeights: '400;700', body: 'Libre Franklin', bodyWeights: '400;500', feel: 'trustworthy and premium' }
  if (cat.includes('psicolog') || cat.includes('fisioter') || cat.includes('wellness') || cat.includes('spa'))
    return { heading: 'DM Serif Display', headingWeights: '400', body: 'DM Sans', bodyWeights: '400;500', feel: 'soft and refined' }
  if (cat.includes('peluquer') || cat.includes('estetica') || cat.includes('belleza'))
    return { heading: 'Cormorant Garamond', headingWeights: '500;600;700', body: 'Lato', bodyWeights: '400;700', feel: 'elegant' }
  if (cat.includes('electric') || cat.includes('fontaner') || cat.includes('instalac') ||
      cat.includes('construc') || cat.includes('reform') || cat.includes('cerrajer'))
    return { heading: 'Barlow Condensed', headingWeights: '600;700', body: 'Barlow', bodyWeights: '400;500', feel: 'strong and direct' }
  if (cat.includes('tecnolog') || cat.includes('software') || cat.includes('informát'))
    return { heading: 'Space Grotesk', headingWeights: '500;600;700', body: 'Inter', bodyWeights: '400;500', feel: 'modern and technical' }
  // default: professional services
  return { heading: 'Plus Jakarta Sans', headingWeights: '600;700', body: 'Plus Jakarta Sans', bodyWeights: '400;500', feel: 'clean and versatile' }
}

// ── Hero visual direction by category ────────────────────────────────────────

function getHeroVisual(category, ogImage) {
  if (ogImage) return `Use the real business photo above as the hero visual (right side on desktop).`

  const cat = (category || '').toLowerCase()
  if (cat.includes('electric') || cat.includes('fontaner') || cat.includes('instalac') ||
      cat.includes('construc') || cat.includes('reform') || cat.includes('cerrajer'))
    return `Dark panel (--color-neutral-900) on the right third with an abstract geometric SVG — intersecting diagonal lines or a circuit/bolt motif in the primary color at low opacity. Conveys industrial precision.`
  if (cat.includes('médic') || cat.includes('clínica') || cat.includes('dental') || cat.includes('salud'))
    return `Clean white card with a soft primary-color gradient border and a minimal SVG icon (cross or stethoscope outline). Light and reassuring, never clinical-cold.`
  if (cat.includes('abogad') || cat.includes('notari') || cat.includes('gestor') || cat.includes('asesor'))
    return `Deep navy or dark-grey panel with a single subtle SVG motif (balanced scales or column). Restrained and authoritative — no gradients.`
  if (cat.includes('restaur') || cat.includes('café') || cat.includes('bar'))
    return `Warm-toned gradient (primary color → slightly darker) with a thin-line SVG illustration of tableware or food item. Inviting texture, not busy.`
  if (cat.includes('inmobiliar') || cat.includes('arquitect'))
    return `Full-height photo placeholder (grey with dashed border labeled "foto proyecto") or a clean isometric building outline SVG in the primary color. Aspirational and minimal.`
  if (cat.includes('psicolog') || cat.includes('fisioter') || cat.includes('wellness') || cat.includes('spa'))
    return `Soft gradient blob shape (primary color at 15% opacity) as an organic background. Calm, airy, and unhurried.`
  if (cat.includes('peluquer') || cat.includes('estetica') || cat.includes('belleza'))
    return `Elegant vertical strip of the primary color with a thin SVG floral or scissors motif. Minimal luxury aesthetic.`
  if (cat.includes('tecnolog') || cat.includes('software') || cat.includes('informát'))
    return `Dark panel with a subtle dot-grid or code-bracket SVG pattern in the primary color at low opacity. Modern and technical.`
  // fallback
  return `Primary-color gradient panel (primary → primary-dark) on the right side with a simple abstract SVG shape. Professional and distinctive.`
}

// ── Industry section requirements (from FRONTEND_GUIDELINES.md §10) ──────────

function getIndustryRules(category) {
  const cat = (category || '').toLowerCase()

  if (cat.includes('restaur') || cat.includes('café') || cat.includes('bar')) return `
INDUSTRY: Food & Restaurant
- Must include: hero with appetizing description, menu/dishes section, hours + address prominent, reservation/contact CTA
- Trust signals: years open, awards, chef or owner name
- Avoid: stock food photos (use placeholder with correct ratio), cluttered layout, tiny text`

  if (cat.includes('abogad') || cat.includes('notari') || cat.includes('gestor') || cat.includes('asesor')) return `
INDUSTRY: Professional Services (Legal / Finance / Consulting)
- Must include: clear service descriptions, team/attorney profiles or credentials, multiple contact methods, consultation CTA
- Colors: conservative — navy, dark grey (honor the primary color but keep palette restrained)
- Trust signals: years in practice, bar/professional association memberships, certifications, client sectors served
- Avoid: flashy animations, informal tone, humor`

  if (cat.includes('médic') || cat.includes('clínica') || cat.includes('dental') || cat.includes('salud')) return `
INDUSTRY: Healthcare & Medical
- Must include: service list, appointment booking CTA, location + hours prominent, doctor/staff profiles if available
- Trust signals: certifications, accreditations, years of experience, patient-friendly language
- Avoid: red (danger association), fear-based copy, complexity, jargon`

  if (cat.includes('inmobiliar') || cat.includes('arquitect')) return `
INDUSTRY: Real Estate / Architecture
- Must include: services / project types, contact form or CTA, location/service area, portfolio or past work (placeholder if none)
- Trust signals: years of experience, notable projects, professional associations
- Avoid: hiding contact info, generic stock photos`

  if (cat.includes('psicolog') || cat.includes('fisioter') || cat.includes('wellness') || cat.includes('spa')) return `
INDUSTRY: Wellness & Therapy
- Must include: service menu, appointment/consultation CTA, therapist profile (name + credentials), calming visual tone
- Trust signals: certifications, years of practice, professional associations
- Avoid: clinical coldness, overwhelming information, aggressive CTAs`

  if (cat.includes('peluquer') || cat.includes('estetica') || cat.includes('belleza')) return `
INDUSTRY: Beauty & Salon
- Must include: service menu with key treatments, booking CTA, address + hours prominent, gallery placeholder
- Trust signals: products used (if known), years open, team profiles
- Avoid: cluttered service menus, missing prices, weak mobile booking`

  if (cat.includes('electric') || cat.includes('fontaner') || cat.includes('instalac') ||
      cat.includes('construc') || cat.includes('reform') || cat.includes('cerrajer')) return `
INDUSTRY: Construction & Trades
- Must include: service list with specific specializations, service area (city/region), quote request CTA, license/certifications if known
- Trust signals: license numbers, professional associations (APIEM, gremios), years in business, types of projects (industrial, residential, commercial)
- Avoid: generic "we do everything" language — be specific with the services found in the content
- CTA should be: "Solicitar Presupuesto" or "Llamar Ahora" — trades clients want quick contact`

  if (cat.includes('limpiez') || cat.includes('jardin') || cat.includes('mantenimient')) return `
INDUSTRY: Maintenance & Cleaning Services
- Must include: service list, service area, contact/quote CTA, availability hours
- Trust signals: years in business, insured/professional equipment, client types (residential, commercial, industrial)
- Avoid: unprofessional tone, missing contact`

  // fallback
  return `
INDUSTRY: Local Business / Professional Service
- Must include: clear service descriptions, contact info prominent, address + hours, primary CTA
- Trust signals: years in business, certifications, client types
- Avoid: generic content — use the specific services and details from the content block above`
}

// ── Prompt assembler ──────────────────────────────────────────────────────────

function buildDesignPrompt(content) {
  const year = new Date().getFullYear()
  const name = content.name || 'Negocio'
  const category = content.category || ''
  const address = content.full_address || '—'
  const phone = content.phone || ''
  const emails = content.contactInfo?.emails || []
  const emailStr = emails.length > 0 ? emails[0] : ''
  const ogImage = content.ogImage || ''
  const primaryColor = resolvePrimaryColor(content.colors, category)
  const fonts = getFontPairing(category)
  const heroVisual = getHeroVisual(category, ogImage)
  const industryRules = getIndustryRules(category)
  const hours = formatWorkingHours(content.working_hours)
  const rating = content.rating
  const reviews = content.reviews
  const hasLogo = !!content.logoUrl

  // ── Social proof string for hero ──────────────────────────────────────────
  let trustSignal = ''
  if (rating && reviews && reviews > 0) {
    trustSignal = `⭐ ${rating} sobre 5 en Google (${reviews} reseñas)`
  }

  // ── Sections block ────────────────────────────────────────────────────────
  const sectionsBlock = (content.sections || [])
    .slice(0, 8)
    .filter(s => s.heading && !s.heading.toLowerCase().includes('flash'))
    .map(s => {
      const text = s.content ? `\n${s.content.slice(0, 300)}` : ''
      return `### ${s.heading}${text}`
    })
    .join('\n\n')

  // ── Body paragraphs block ─────────────────────────────────────────────────
  const PARA_SKIP = /©|cookie|política de privacidad|diseñado (por|y construido)|aviso legal|todos los derechos/i
  const parasBlock = (content.bodyParagraphs || [])
    .filter(p => !PARA_SKIP.test(p))
    .slice(0, 6)
    .map(p => `- ${p.slice(0, 250)}`)
    .join('\n')

  // ── Services block ────────────────────────────────────────────────────────
  // Flatten serviceLists, deduplicate, take best 12 items
  const NAV_SKIP = /^(inicio|home|volver|ver más|leer más|contacto|privacidad|legal|aviso|quiénes\s*somos|quienes\s*somos|dónde\s*trabajamos|donde\s*trabajamos|presupuesto[s]?$|recursos\s*humanos|international|clientes$|actividades$|calidad|servicios$|inicio$)/i
  const allServices = (content.serviceLists || [])
    .flat()
    .filter(s => s && typeof s === 'string')
    .filter(s => !s.includes('\t') && !s.includes('\n'))  // skip multiline/indented nav
    .filter(s => s.length > 8 && s.length < 120)
    .filter(s => !NAV_SKIP.test(s.trim()))
  const uniqueServices = [...new Set(allServices)].slice(0, 12)
  const servicesBlock = uniqueServices.length > 0
    ? uniqueServices.map(s => `- ${s}`).join('\n')
    : ''

  // ── Testimonials block ────────────────────────────────────────────────────
  const testimonialsBlock = (content.testimonials || [])
    .slice(0, 3)
    .map(t => `"${t.slice(0, 200)}"`)
    .join('\n')

  // ── Partner/client names ──────────────────────────────────────────────────
  const partnersBlock = (content.partnerNames || [])
    .slice(0, 8)
    .join(', ')

  // ── JSON-LD structured data ───────────────────────────────────────────────
  // Only include if there's useful info beyond just the name
  const jsonLdText = (content.jsonLd || [])
    .slice(0, 2)
    .map(item => {
      try {
        const parsed = typeof item === 'string' ? JSON.parse(item) : item
        const parts = []
        if (parsed.description) parts.push(`description: ${parsed.description}`)
        if (parsed.openingHours) parts.push(`hours: ${Array.isArray(parsed.openingHours) ? parsed.openingHours.join(', ') : parsed.openingHours}`)
        if (parsed.priceRange) parts.push(`priceRange: ${parsed.priceRange}`)
        if (parsed.servesCuisine) parts.push(`cuisine: ${parsed.servesCuisine}`)
        if (parsed.areaServed) parts.push(`area: ${Array.isArray(parsed.areaServed) ? parsed.areaServed.join(', ') : parsed.areaServed}`)
        return parts.length > 0 ? parts.join(' | ') : null
      } catch { return null }
    })
    .filter(Boolean)
    .join('\n')

  // ── Social links ──────────────────────────────────────────────────────────
  const social = content.socialLinks || {}
  const socialLines = Object.entries(social)
    .filter(([, url]) => url && !url.includes('intent/tweet') && !url.includes('share?'))
    .map(([platform, url]) => `${platform}: ${url}`)
    .join('\n')

  // ── Keywords ──────────────────────────────────────────────────────────────
  const keywords = content.metaKeywords || ''
  const metaDesc = content.metaDescription || ''
  const description = content.description || ''  // Google Maps description
  const cmsDetected = content.cms_detected || ''
  const pitchAngle = content.pitch_angle || ''
  const scrapeError = content.scrapeError || null

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD THE PROMPT
  // ─────────────────────────────────────────────────────────────────────────

  const lines = []

  lines.push(`You are an expert frontend developer and UI/UX designer specializing in Spanish SME websites.`)
  lines.push(`Create a complete, single-file HTML homepage mockup for the business below.`)
  lines.push(`This is a PROPOSAL mockup — the goal is for the business owner to see it and think "I want this for my business."`)
  if (scrapeError) {
    lines.push(``)
    lines.push(`> ⚠️ NOTE: The website scrape returned an error (${scrapeError}). Content may be limited. Rely on the business details and category defaults where content is missing.`)
  }
  lines.push(``)

  // ── BUSINESS DETAILS ─────────────────────────────────────────────────────
  lines.push(`## BUSINESS DETAILS`)
  lines.push(``)
  lines.push(`- **Name:** ${name}`)
  lines.push(`- **Category:** ${category}`)
  lines.push(`- **Address:** ${address}`)
  if (phone)       lines.push(`- **Phone:** ${phone}`)
  if (emailStr)    lines.push(`- **Email:** ${emailStr}`)
  if (hours)       lines.push(`- **Hours:** ${hours}`)
  if (trustSignal) lines.push(`- **Google rating:** ${trustSignal}`)
  if (description) lines.push(`- **Business description (Google Maps):** ${description}`)
  if (cmsDetected) lines.push(`- **Current CMS:** ${cmsDetected}`)
  lines.push(`- **Current site problems:** ${pitchAngle}`)
  lines.push(``)

  // ── CONTENT TO USE ────────────────────────────────────────────────────────
  lines.push(`## CONTENT TO USE IN THE MOCKUP`)
  lines.push(``)
  lines.push(`Use this real content. Do not invent facts about the business.`)
  lines.push(`If a field is missing or empty, use appropriate placeholder content for this category.`)
  lines.push(``)

  if (metaDesc) {
    lines.push(`### How the business describes itself`)
    lines.push(metaDesc)
    lines.push(``)
  }

  if (sectionsBlock) {
    lines.push(`### Website sections (current site content)`)
    lines.push(sectionsBlock)
    lines.push(``)
  }

  if (parasBlock) {
    lines.push(`### Additional business description`)
    lines.push(parasBlock)
    lines.push(``)
  }

  if (servicesBlock) {
    lines.push(`### Services / specializations — use these for the services section`)
    lines.push(servicesBlock)
    lines.push(``)
  }

  if (testimonialsBlock) {
    lines.push(`### Customer testimonials — include a testimonials section`)
    lines.push(testimonialsBlock)
    lines.push(``)
  }

  if (partnersBlock) {
    lines.push(`### Notable clients / partners`)
    lines.push(partnersBlock)
    lines.push(``)
  }

  if (jsonLdText) {
    lines.push(`### Structured data (high reliability — use if more specific than sections above)`)
    lines.push(jsonLdText)
    lines.push(``)
  }

  if (socialLines) {
    lines.push(`### Social media — link these in the footer`)
    lines.push(socialLines)
    lines.push(``)
  }

  if (keywords) {
    lines.push(`### SEO keywords the business uses`)
    lines.push(keywords)
    lines.push(``)
  }

  // ── DESIGN DECISIONS ─────────────────────────────────────────────────────
  lines.push(`## DESIGN DECISIONS`)
  lines.push(``)
  lines.push(`### Primary color`)
  lines.push(`**${primaryColor}**`)
  lines.push(`Build the complete palette around this color. Define as CSS custom properties:`)
  lines.push(`- \`--color-primary\`: ${primaryColor}`)
  lines.push(`- \`--color-primary-dark\`: 15% darker (for hover states)`)
  lines.push(`- \`--color-primary-light\`: 15% lighter (for section backgrounds / tints)`)
  lines.push(`- \`--color-secondary\`: complementary accent — your design judgment`)
  lines.push(`- \`--color-neutral-900\` through \`--color-neutral-50\`: full grey scale`)
  lines.push(`- \`--color-bg\`: #fafafa (never pure white for large backgrounds)`)
  lines.push(`- Rule: 60% neutral/background · 30% primary · 10% accent on CTAs`)
  lines.push(``)
  lines.push(`### Typography`)
  lines.push(`- **Heading font:** ${fonts.heading} — load weights: ${fonts.headingWeights} (Google Fonts)`)
  lines.push(`- **Body font:** ${fonts.body} — load weights: ${fonts.bodyWeights} (Google Fonts)`)
  lines.push(`- **Feel:** ${fonts.feel}`)
  lines.push(`- Body minimum: 16px | Line-height body: 1.65 | Headings: 1.1–1.3`)
  lines.push(`- H1: \`font-size: clamp(2rem, 5vw, 4.5rem)\``)
  lines.push(`- Paragraphs: \`max-width: 65ch\``)
  lines.push(``)
  lines.push(`### Logo`)
  if (hasLogo) {
    lines.push(`Logo available — reference as \`./logo.png\` in an \`<img>\` tag in the header.`)
  } else {
    lines.push(`No logo available — use a styled text logo: business name in the heading font, bold.`)
  }
  lines.push(``)
  if (ogImage) {
    lines.push(`### Hero image`)
    lines.push(`A real business photo is available: \`${ogImage}\``)
    lines.push(`Use this as the hero visual element (right side on desktop, or as a background).`)
    lines.push(``)
  }

  // ── INDUSTRY RULES ───────────────────────────────────────────────────────
  lines.push(`## INDUSTRY REQUIREMENTS`)
  lines.push(``)
  lines.push(industryRules.trim())
  lines.push(``)

  // ── REQUIRED PAGE SECTIONS ────────────────────────────────────────────────
  lines.push(`## REQUIRED PAGE STRUCTURE`)
  lines.push(``)
  lines.push(`Build these sections in this order:`)
  lines.push(``)
  lines.push(`### 1. Header (sticky)`)
  lines.push(`- Logo (left) + nav links (max 5 items) + primary CTA button (right)`)
  lines.push(`- \`backdrop-filter: blur(8px)\` + border-bottom that appears on scroll`)
  lines.push(`- Mobile: hamburger menu (slide-in drawer)`)
  lines.push(``)
  lines.push(`### 2. Hero`)
  lines.push(`- Eyebrow: small uppercase label (e.g. the category)`)
  lines.push(`- H1: strong value proposition, 6–10 words, in Spanish`)
  lines.push(`- Subheadline: one sentence expanding the H1`)
  lines.push(`- Primary CTA button (e.g. "Solicitar Presupuesto", "Llamar Ahora", "Pedir Cita")`)
  lines.push(`- Trust signal below CTA: ${trustSignal ? `"${trustSignal}"` : 'years in business, certifications, or association memberships from the content above'}`)
  lines.push(`- Right side (desktop): ${heroVisual}`)
  lines.push(``)
  lines.push(`### 3. Trust bar`)
  lines.push(`Horizontal strip between hero and services. 3–4 key facts as icon + text pairs.`)
  lines.push(`Pick from whichever are available in the content:`)
  if (trustSignal) lines.push(`- Google rating: ${trustSignal}`)
  if (hours)       lines.push(`- Hours: ${hours}`)
  lines.push(`- Years in business (if mentioned in content)`)
  lines.push(`- Service area or coverage (if mentioned)`)
  lines.push(`- Key certification or association (APIEM, Colegio, etc., if mentioned)`)
  lines.push(`Style: light background (\`--color-primary-light\` tint or \`#f8f9ff\`), subtle dividers between items, centered on desktop.`)
  lines.push(``)
  lines.push(`### 4. Services / Specializations`)
  lines.push(`- 3–6 service cards, each with: inline SVG icon, title, 1-line description`)
  lines.push(`- Use the specific services listed in the content block — not generic ones`)
  lines.push(`- Cards: subtle border + shadow, lift on hover (\`translateY(-4px)\`)`)
  lines.push(``)
  lines.push(`### 5. About / Why Us`)
  lines.push(`- 1–2 paragraphs using the business's own words from the content block`)
  lines.push(`- 3–4 key differentiators as icon + text rows (years of experience, certifications, service area, etc.)`)
  lines.push(``)
  if (testimonialsBlock) {
    lines.push(`### 6. Testimonials`)
    lines.push(`- Use the real testimonials from the content block`)
    lines.push(`- Quote card layout with quotation mark, text, attribution`)
    lines.push(``)
    lines.push(`### 7. Contact`)
  } else {
    lines.push(`### 6. Contact`)
  }
  lines.push(`- Phone: large, prominent, clickable \`tel:\` link — the most important CTA on the page`)
  if (emailStr) lines.push(`- Email: ${emailStr}`)
  lines.push(`- Address: ${address}`)
  if (hours) lines.push(`- Hours: ${hours}`)
  lines.push(`- Simple lead form: name + phone/email + message + submit button`)
  lines.push(`  - Submit button copy: "Solicitar Presupuesto" or "Enviar Mensaje"`)
  lines.push(`  - Every input must have a \`<label>\` — never use placeholder as label`)
  lines.push(``)
  lines.push(`### Footer`)
  lines.push(`- Logo + one-line brand description`)
  lines.push(`- Nav links grouped by topic`)
  lines.push(`- Contact info: phone${address ? ', address' : ''}${hours ? ', hours' : ''}`)
  if (socialLines) lines.push(`- Social media icons (use the links from the content block)`)
  lines.push(`- Legal row: © ${year} ${name} · Política de Privacidad`)
  lines.push(``)

  // ── TECHNICAL REQUIREMENTS ────────────────────────────────────────────────
  lines.push(`## TECHNICAL REQUIREMENTS`)
  lines.push(``)
  lines.push(`- Single HTML file: \`<style>\` and \`<script>\` embedded — no external CSS/JS files`)
  lines.push(`- Only allowed external resource: Google Fonts (\`preconnect\` + font \`<link>\`)`)
  lines.push(`- Mobile-first responsive — base styles for mobile, \`min-width\` to scale up`)
  lines.push(`  Breakpoints: 640px · 768px · 1024px · 1280px`)
  lines.push(`- \`<meta name="viewport" content="width=device-width, initial-scale=1">\` required`)
  lines.push(`- CSS custom properties for all colors, spacing, shadows, border-radius`)
  lines.push(`- Spacing: 8pt grid only — use values: 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96px`)
  lines.push(`- \`scroll-behavior: smooth\` on \`html\``)
  lines.push(`- Scroll-triggered entrance animations: \`IntersectionObserver\` + fade-in + \`translateY(20px → 0)\``)
  lines.push(`- Animate ONLY \`transform\` and \`opacity\` — never \`width\`, \`height\`, \`top\`, \`left\``)
  lines.push(`- \`@media (prefers-reduced-motion: reduce)\` — disable all animations`)
  lines.push(`- All interactive elements must have \`:focus-visible\` outline`)
  lines.push(`- Touch targets: minimum 44×44px`)
  lines.push(`- All text in Spanish (including aria-labels, button text, form labels, error messages)`)
  lines.push(`- LocalBusiness JSON-LD in \`<head>\` with name, phone, address, url, openingHours`)
  lines.push(`- ONE \`<h1>\` per page — the hero headline`)
  lines.push(``)

  // ── QUALITY BAR ───────────────────────────────────────────────────────────
  lines.push(`## QUALITY BAR`)
  lines.push(``)
  lines.push(`Target aesthetic: think Stripe, Linear, or the best local business site you've ever seen.`)
  lines.push(`The business owner must look at this and think: "I want this for my business."`)
  lines.push(``)
  lines.push(`**DO:**`)
  lines.push(`- Clean visual hierarchy with generous whitespace between sections`)
  lines.push(`- Distinctive typography — the fonts above were chosen for this industry`)
  lines.push(`- One strong accent color, used deliberately — not on every element`)
  lines.push(`- Light or off-white base (\`#fafafa\`) — dark sections only for footer and hero accents`)
  lines.push(`- Phone number visible in header, hero, and contact section`)
  lines.push(`- CTA buttons: action verbs — "Solicitar Presupuesto", "Llamar Ahora", "Ver Servicios"`)
  lines.push(`- Consistent border-radius — define once as \`--radius\` CSS variable`)
  lines.push(`  Sharp (4px): trades, legal, finance | Rounded (8–12px): wellness, food, retail`)
  lines.push(`- Section alternating background: white → \`--color-bg-subtle\` → white`)
  lines.push(``)
  lines.push(`**NEVER:**`)
  lines.push(`- \`#000000\` for text — use \`--color-neutral-900\` (#18181b)`)
  lines.push(`- \`#ffffff\` for large backgrounds — use \`#fafafa\` or \`#f8f9ff\``)
  lines.push(`- More than 2 Google Fonts`)
  lines.push(`- Full dark background for the whole page`)
  lines.push(`- Emoji in service cards — use inline SVG icons`)
  lines.push(`- Fake stat counters ("100% satisfacción", "∞ clientes", "500+ proyectos" without data)`)
  lines.push(`- "Haz clic aquí", "Enviar", or "Submit" on buttons`)
  lines.push(`- Body text below 16px`)
  lines.push(`- Justified text alignment`)
  lines.push(`- Arbitrary spacing values (13px, 17px, 22px) — 8pt grid only`)
  lines.push(`- Placeholder text as the only label for form inputs`)
  lines.push(``)

  // ── OUTPUT SPEC ───────────────────────────────────────────────────────────
  lines.push(`## OUTPUT`)
  lines.push(``)
  lines.push(`Return ONLY the complete HTML. No explanation, no markdown, no code fences.`)
  lines.push(`Start with \`<!DOCTYPE html>\`. End with \`</html>\`.`)
  lines.push(`Target: 600–900 lines. Complete is more important than elaborate.`)
  lines.push(`The file must be self-contained and render correctly when opened directly in a browser.`)

  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(CONTENT_DIR)) {
    console.error(`[ERROR] Content directory not found: ${CONTENT_DIR}`)
    console.error(`        Run stage 4 first: node pipeline/4-content.mjs --neighborhood ${NEIGHBORHOOD}`)
    process.exit(1)
  }

  if (!existsSync(INPUT_FILE) && !LEAD_FILTER) {
    console.error(`[ERROR] Audited XLSX not found: ${INPUT_FILE}`)
    console.error(`        Run stage 2 first: node pipeline/2-auditor.mjs --neighborhood ${NEIGHBORHOOD}`)
    process.exit(1)
  }

  log(`[INIT] Neighborhood: ${NEIGHBORHOOD}`)

  let leads
  if (LEAD_FILTER) {
    const contentPath = join(CONTENT_DIR, LEAD_FILTER, 'content.json')
    if (!existsSync(contentPath)) {
      console.error(`[ERROR] content.json not found for --lead "${LEAD_FILTER}"`)
      process.exit(1)
    }
    leads = [{ name: LEAD_FILTER }]
    log(`[INIT] Single lead mode: ${LEAD_FILTER}`)
  } else {
    leads = await getTargetLeads(INPUT_FILE)
    log(`[INIT] ${leads.length} target leads (Tier 1 + Tier 2)`)
  }

  if (leads.length === 0) {
    log('[INIT] No target leads found.')
    process.exit(0)
  }

  const startTime = Date.now()
  let generated = 0
  let skipped = 0
  let errors = 0

  for (const lead of leads) {
    const safeName = LEAD_FILTER || sanitizeName(lead.name)
    const contentPath = join(CONTENT_DIR, safeName, 'content.json')
    const outputPath  = join(CONTENT_DIR, safeName, 'design_prompt.md')

    // Resume check — skip if already done (unless --lead forces regen)
    if (!LEAD_FILTER && existsSync(outputPath)) {
      log(`[SKIP] ${lead.name} — design_prompt.md exists`)
      skipped++
      continue
    }

    if (!existsSync(contentPath)) {
      log(`[SKIP] ${lead.name} — content.json not found`)
      skipped++
      continue
    }

    let content
    try {
      content = JSON.parse(readFileSync(contentPath, 'utf-8'))
    } catch (err) {
      logError(`${lead.name} — could not parse content.json: ${err.message}`)
      errors++
      continue
    }

    try {
      const prompt = buildDesignPrompt(content)
      writeFileSync(outputPath, prompt, 'utf-8')
      const lines = prompt.split('\n').length
      const kb = (prompt.length / 1024).toFixed(1)
      log(`[${generated + skipped + errors + 1}/${leads.length}] ✓ ${content.name} — ${lines} lines, ${kb}KB`)
      generated++
    } catch (err) {
      logError(`${lead.name} — failed to build prompt: ${err.message}`)
      errors++
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)

  log('')
  log('═══════════════════════════════════════════')
  log('  DESIGN PROMPTS COMPLETE')
  log('═══════════════════════════════════════════')
  log(`  Neighborhood:  ${NEIGHBORHOOD}`)
  log(`  Generated:     ${generated}`)
  log(`  Skipped:       ${skipped}`)
  log(`  Errors:        ${errors}`)
  log(`  Duration:      ${elapsed}s`)
  log(`  Output:        ${CONTENT_DIR}/<name>/design_prompt.md`)
  log('═══════════════════════════════════════════')
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
