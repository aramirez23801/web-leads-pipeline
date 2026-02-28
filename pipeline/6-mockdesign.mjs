// pipeline/6-mockdesign.mjs — Generate HTML mockup of redesigned website via Claude API
//
// Usage:
//   node pipeline/6-mockdesign.mjs
//   node pipeline/6-mockdesign.mjs --neighborhood maria_de_molina
//   node pipeline/6-mockdesign.mjs --neighborhood maria_de_molina --dry-run
//   node pipeline/6-mockdesign.mjs --neighborhood maria_de_molina --lead area2_instalaciones_eléctricas_y_mecánicas_s_a
//
// Input:  output/leads_audited_<neighborhood>.xlsx
//         output/content_<neighborhood>/<safeName>/content.json
// Output: output/content_<neighborhood>/<safeName>/mockdesign.html
//
// Skips leads that already have mockdesign.html (resumable).
// --dry-run prints the prompt for the first 2 leads without calling the API.

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { getNeighborhoodName, sanitizeName, getTargetLeads } from './utils.mjs'

// ── Config ───────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName()
const INPUT_FILE = `output/leads_audited_${NEIGHBORHOOD}.xlsx`
const CONTENT_DIR = `output/content_${NEIGHBORHOOD}`
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 26000
const SLEEP_MS = 1200 // courtesy delay between API calls

// ── CLI flags ────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run')

function getLeadFilter() {
  const idx = process.argv.indexOf('--lead')
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null
}
const LEAD_FILTER = getLeadFilter()

// ── Color helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if the CSS color string is usable (not white, transparent, or blank).
 */
function isUsableColor(cssColor) {
  if (!cssColor || cssColor.trim() === '') return false
  const c = cssColor.toLowerCase().replace(/\s/g, '')
  if (c.includes('255,255,255')) return false // white
  if (c.startsWith('rgba(0,0,0,0)')) return false // transparent
  if (c === 'transparent') return false
  if (c === 'rgba(0,0,0,0)') return false
  return true
}

/**
 * Returns a hex or rgb brand color for the lead.
 * Uses extracted body background if usable; otherwise falls back to category defaults.
 */
function getCategoryColor(category, colors) {
  const bg = colors?.bodyBg || ''
  if (isUsableColor(bg)) return bg

  const cat = (category || '').toLowerCase()
  if (
    cat.includes('dental') ||
    cat.includes('clínica') ||
    cat.includes('médic')
  )
    return '#0ea5e9'
  if (
    cat.includes('abogad') ||
    cat.includes('notari') ||
    cat.includes('gestor')
  )
    return '#1e40af'
  if (
    cat.includes('electric') ||
    cat.includes('fontaner') ||
    cat.includes('instalac')
  )
    return '#f59e0b'
  if (cat.includes('restaur') || cat.includes('café') || cat.includes('bar'))
    return '#dc2626'
  if (cat.includes('inmobiliar') || cat.includes('arquitect')) return '#0d9488'
  if (cat.includes('psicolog') || cat.includes('fisioter')) return '#7c3aed'
  if (cat.includes('limpiez') || cat.includes('mantenimient')) return '#16a34a'
  return '#2563eb'
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildMockPrompt(content) {
  const primaryColor = getCategoryColor(content.category, content.colors)
  const year = new Date().getFullYear()
  const address = content.full_address || '—'
  const sectionsText = (content.sections || [])
    .slice(0, 8)
    .map((s) => `### ${s.heading}\n${s.content}`)
    .join('\n\n')

  return `You are an expert frontend developer and UI designer. Create a complete, single-file HTML website mockup for a Spanish business.

BUSINESS DETAILS:
- Name: ${content.name}
- Category: ${content.category}
- Phone: ${content.phone || 'No disponible'}
- Address: ${address}
- Current website issues: ${content.pitch_angle}

EXISTING CONTENT TO INCORPORATE:
${sectionsText || '(No existing content available — invent appropriate placeholder content for this category.)'}

DESIGN REQUIREMENTS:
- Single HTML file with embedded CSS and JS — no external dependencies except Google Fonts
- Mobile-first, fully responsive (flexbox/grid, viewport meta tag)
- Primary brand color: ${primaryColor} — build the entire palette around this
- Has logo: ${content.logoUrl ? 'Yes — reference it as ./logo.png in an <img> tag' : 'No — use styled text logo'}
- Language: Spanish throughout
- Modern, professional aesthetic appropriate for a Spanish SME
- Sections: sticky nav with smooth scroll, hero with clear CTA button, services/about section, contact section with phone number prominently displayed
- Subtle entrance animations (CSS or minimal vanilla JS — no libraries)
- Footer with phone, address, copyright ${year}
- Target length: 600-900 lines of HTML. Complete is more important than elaborate.

QUALITY BAR:
Think Stripe, Linear, or a well-designed local business site. Clean visual hierarchy, excellent typography from Google Fonts (choose something distinctive — NOT Inter, Roboto, or Open Sans), generous whitespace, one strong accent color. The business owner should look at this and think "I want this."
- Avoid: full dark backgrounds, emoji icons in feature cards, fake stat counters (100%, ∞)
- Light or off-white base preferred — dark sections only for footer and hero accents

OUTPUT: Return ONLY the complete HTML. No explanation, no markdown, no code fences. Start with <!DOCTYPE html>.`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readContentJson(safeName) {
  const path = join(CONTENT_DIR, safeName, 'content.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
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

  const client = isDryRun ? null : new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  let leads
  if (LEAD_FILTER) {
    // --lead mode: read directly from content.json, no XLSX dependency
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
    leads = [{ name: content.name }]
  } else {
    leads = getTargetLeads(INPUT_FILE)
  }

  if (leads.length === 0) {
    console.log(`[MOCK] No target leads found in ${INPUT_FILE}`)
    process.exit(0)
  }

  console.log(`[MOCK] Neighborhood : ${NEIGHBORHOOD}`)
  console.log(
    `[MOCK] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`
  )
  console.log(
    `[MOCK] Mode         : ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`
  )
  console.log(`[MOCK] Model        : ${MODEL}`)

  const startTime = Date.now()
  let processed = 0
  let skipped = 0
  let errors = 0
  let dryRunCount = 0

  for (const lead of leads) {
    const safeName = LEAD_FILTER || sanitizeName(lead.name)
    const outputPath = join(CONTENT_DIR, safeName, 'mockdesign.html')

    // Skip if already generated (resumable)
    if (!isDryRun && existsSync(outputPath)) {
      console.log(`[MOCK] SKIP  ${lead.name} — mockdesign.html exists`)
      skipped++
      continue
    }

    const content = readContentJson(safeName)
    if (!content) {
      console.log(`[MOCK] SKIP  ${lead.name} — content.json not found`)
      skipped++
      continue
    }

    const prompt = buildMockPrompt(content)

    // Dry-run: print prompt for first 2 leads and stop
    if (isDryRun) {
      dryRunCount++
      console.log(`\n${'═'.repeat(70)}`)
      console.log(`DRY RUN — Lead ${dryRunCount}: ${lead.name}`)
      console.log(`safeName: ${safeName}`)
      console.log(`Output would be: ${outputPath}`)
      console.log(`${'─'.repeat(70)}`)
      console.log('PROMPT:')
      console.log(prompt)
      if (dryRunCount >= 2) break
      continue
    }

    // Live: call Claude API with streaming
    try {
      process.stdout.write(`[MOCK] GEN   ${lead.name} ... `)

      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }]
      })

      const message = await stream.finalMessage()
      const html = message.content[0]?.text?.trim() || ''

      if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
        throw new Error(
          `Unexpected response format (first 100 chars): ${html.slice(0, 100)}`
        )
      }

      writeFileSync(outputPath, html, 'utf-8')
      const lines = html.split('\n').length
      console.log(`✓ (${lines} lines, ${(html.length / 1024).toFixed(1)}KB)`)
      const inputTokens = message.usage.input_tokens
      const outputTokens = message.usage.output_tokens
      const cost = inputTokens * 0.000003 + outputTokens * 0.000015
      console.log(
        `  ↳ Tokens: ${inputTokens} in / ${outputTokens} out | Cost: $${cost.toFixed(4)}`
      )
      if (outputTokens >= 24000) {
        console.log(`  ⚠️  WARNING: output near token limit — may be truncated`)
      }
      if (LEAD_FILTER) {
        console.log(`\n  Open in browser:`)
        console.log(`  file://${resolve(outputPath)}`)
      }
      processed++

      if (leads.indexOf(lead) < leads.length - 1) {
        await sleep(SLEEP_MS)
      }
    } catch (err) {
      console.log(`✗ ERROR`)
      if (err instanceof Anthropic.RateLimitError) {
        console.error(`  [RATE LIMIT] Waiting 60s before next attempt...`)
        await sleep(60_000)
      } else if (err instanceof Anthropic.APIError) {
        console.error(`  [API ERROR ${err.status}] ${err.message}`)
      } else {
        console.error(`  [ERROR] ${err.message}`)
      }
      errors++
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)

  if (isDryRun) {
    console.log(
      `\n[MOCK] Dry run complete — ${dryRunCount} prompt(s) printed, no API calls made`
    )
    return
  }

  console.log('\n' + '═'.repeat(46))
  console.log('  MOCK DESIGN COMPLETE')
  console.log('═'.repeat(46))
  console.log(`  Neighborhood : ${NEIGHBORHOOD}`)
  console.log(`  Processed    : ${processed}`)
  console.log(`  Skipped      : ${skipped}`)
  console.log(`  Errors       : ${errors}`)
  console.log(`  Duration     : ${elapsed}s`)
  console.log(`  Output       : ${CONTENT_DIR}/`)
  console.log('═'.repeat(46))
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
