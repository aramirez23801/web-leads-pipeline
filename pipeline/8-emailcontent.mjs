// pipeline/8-emailcontent.mjs — Generate full 3-email outreach sequence per lead
//
// Usage:
//   node pipeline/8-emailcontent.mjs
//   node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina
//   node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina --dry-run
//   node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina --lead <safeName>
//
// Input:  output/leads_audited_<neighborhood>.xlsx
//         output/content_<neighborhood>/<safeName>/content.json
// Output: output/content_<neighborhood>/<safeName>/email.json
//   {
//     email1: { subject, body },          ← Day 0  — plain text, no link
//     email2: { subject, body },          ← Day 4  — delivers preview link
//     email3: { subject, body },          ← Day 12 — break-up, leaves link
//     previewUrl: null                    ← stage 9 sets this and injects into email2/email3
//   }
//
// Structure: PAS (Problem → Agitate → Solution) — see docs/2026-03-04-cold-email-structure.md
//
// Haiku generates ONE sentence per lead: the specific problem on their website.
// Email 1 is assembled from a fixed template + that sentence.
// Emails 2 and 3 are pure template assembly — no API call needed.
//
// NO preview link in email 1. {{PREVIEW_URL}} placeholder lives in email2 and email3.
// Stage 9 (deploy) sets previewUrl and replaces the placeholder in both.
// Stage 10 (outreach) exports all 3 emails as CSV columns for Instantly.ai.
//
// Skips leads where a valid email.json already exists (resumable).
// --dry-run prints the prompt + all 3 assembled emails without calling the API.

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getNeighborhoodName, sanitizeName, getTargetLeads } from './utils.mjs'

// ── Config ────────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName()
const INPUT_FILE   = `output/leads_audited_${NEIGHBORHOOD}.xlsx`
const CONTENT_DIR  = `output/content_${NEIGHBORHOOD}`
const MODEL        = 'claude-haiku-4-5-20251001'
const MAX_TOKENS   = 192   // JSON with problema sentence + tipo field
const SLEEP_MS     = 200

// ── CLI flags ─────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run')

function getLeadFilter() {
  const idx = process.argv.indexOf('--lead')
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null
}
const LEAD_FILTER = getLeadFilter()

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

// ── Prompt: asks Haiku for ONE problem sentence only ─────────────────────────

function buildProblemPrompt(content) {
  const name     = content.name     || 'este negocio'
  const category = content.category || 'negocio local'
  const pitch    = content.pitch_angle || ''

  const sectionTitles = (content.sections || [])
    .slice(0, 3)
    .map(s => s.heading)
    .filter(Boolean)
    .join(', ')

  const siteStatus = content.scrapeError
    ? 'La web no estaba accesible en el momento del análisis.'
    : sectionTitles
      ? `Secciones detectadas: ${sectionTitles}.`
      : 'Web encontrada pero sin secciones estructuradas.'

  return `Analiza este negocio local y devuelve un objeto JSON con dos campos.

DATOS DEL NEGOCIO:
- Nombre: ${name}
- Sector: ${category}
- Problema detectado (pitch): ${pitch || '(no especificado — deduce del contexto)'}
- ${siteStatus}

CAMPOS A DEVOLVER:
1. "problema": UNA sola frase describiendo el problema específico detectado en su web.
   - Máximo 25 palabras. Empieza en minúscula (irá después de dos puntos en el email).
   - Sé específico: menciona el problema concreto (móvil, velocidad, SEO, diseño anticuado, web no accesible, sin web, etc.).
   - Debe sonar como si hubieras mirado la web de verdad, no genérico.
   - Sin comillas, sin punto final.

2. "tipo": el tipo de negocio en español, en plural, en minúscula, listo para usar en la frase \
"clientes que buscan [tipo] en la zona". Ejemplos: "dentistas", "peluquerías", "restaurantes", \
"clínicas veterinarias", "talleres mecánicos". Usa el término más natural en español, \
independientemente del idioma en que venga el sector.

Devuelve ÚNICAMENTE el JSON, sin texto antes ni después:
{"problema": "...", "tipo": "..."}`
}

// ── Parse Haiku response ──────────────────────────────────────────────────────

function parseProblemResponse(rawText) {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    throw new Error(`Response is not valid JSON: ${err.message}\nRaw: ${rawText.slice(0, 200)}`)
  }

  const problema = (parsed.problema || '').replace(/\.$/, '').trim()
  const tipo     = (parsed.tipo     || '').toLowerCase().trim()

  if (!problema || problema.length < 10) {
    throw new Error(`"problema" field too short or empty in model response`)
  }
  if (!tipo || tipo.length < 3) {
    throw new Error(`"tipo" field too short or empty in model response`)
  }

  return { problemSentence: problema, tipo }
}

// ── Email templates ───────────────────────────────────────────────────────────
//
// Email 1 — Day 0. PAS framework. No preview link. Goal: get a reply.
// Email 2 — Day 4. Short follow-up. Delivers the preview link.
// Email 3 — Day 12. Break-up email. Leaves the link, no pressure.
//
// {{PREVIEW_URL}} in emails 2 and 3 is replaced by stage 9 after deploy.

function assembleEmail1(content, problemSentence, tipo) {
  const name = content.name || 'su negocio'

  const subject = `${name}, algo que notamos en tu web`

  const body = [
    'Hola,',
    '',
    'Somos dos estudiantes del IE empezando mejoraweb.app aquí en el barrio de María de Molina.',
    '',
    `Antes de escribirte, analizamos tu web: ${problemSentence}. Eso se traduce en clientes que buscan ${tipo} en la zona y que no llegan a encontrarte.`,
    '',
    `Ya preparamos un diseño nuevo de ${name} teniendo esto en cuenta. ¿Te lo mandamos para que lo veas? Si te convence, podemos hablar 15 minutos cuando te venga bien.`,
    '',
    'Un saludo,',
    'Andrés',
    'mejoraweb.app',
  ].join('\n')

  return { subject, body }
}

function assembleEmail2(content, subject1) {
  const name    = content.name || 'su negocio'
  const subject = `Re: ${subject1}`

  const body = [
    'Hola,',
    '',
    `Te escribí hace unos días sobre el diseño que preparamos para ${name}. Por si no lo viste, aquí el enlace:`,
    '',
    '{{PREVIEW_URL}}',
    '',
    'Si te gusta lo que ves y quieres hablarlo, dime y buscamos un momento.',
    '',
    'Andrés',
    'mejoraweb.app',
  ].join('\n')

  return { subject, body }
}

function assembleEmail3(content, subject1) {
  const subject = `Re: ${subject1}`

  const body = [
    'Hola,',
    '',
    'Entiendo que estás ocupado — sin problema.',
    '',
    'El diseño sigue aquí por si lo quieres ver en otro momento:',
    '',
    '{{PREVIEW_URL}}',
    '',
    'Te deseo mucho éxito.',
    '',
    'Andrés',
    'mejoraweb.app',
  ].join('\n')

  return { subject, body }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!LEAD_FILTER && !existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`)
    console.error(`        Run the auditor first: node pipeline/2-auditor.mjs --neighborhood ${NEIGHBORHOOD}`)
    console.error(`        Or use --lead <safeName> to process a single lead directly.`)
    process.exit(1)
  }

  if (!isDryRun) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || !apiKey.trim()) {
      console.error('[ERROR] ANTHROPIC_API_KEY not set in .env')
      process.exit(1)
    }
  }

  const client = isDryRun ? null : new Anthropic()

  // ── Build lead list ────────────────────────────────────────────────────────
  let leads
  if (LEAD_FILTER) {
    const content = readJson(join(CONTENT_DIR, LEAD_FILTER, 'content.json'))
    if (!content) {
      console.error(`[ERROR] content.json not found for --lead "${LEAD_FILTER}"`)
      console.error(`        Expected: ${join(CONTENT_DIR, LEAD_FILTER, 'content.json')}`)
      process.exit(1)
    }
    leads = [{ name: content.name || LEAD_FILTER }]
  } else {
    leads = await getTargetLeads(INPUT_FILE)
  }

  if (leads.length === 0) {
    console.log(`[EMAIL] No target leads found in ${INPUT_FILE}`)
    process.exit(0)
  }

  console.log(`[EMAIL] Neighborhood : ${NEIGHBORHOOD}`)
  console.log(`[EMAIL] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`)
  console.log(`[EMAIL] Mode         : ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`)
  console.log(`[EMAIL] Model        : ${MODEL}`)
  console.log(`[EMAIL] Template     : PAS — 3-email sequence (Day 0 / Day 4 / Day 12)`)

  const startTime = Date.now()
  let processed   = 0
  let skipped     = 0
  let errors      = 0
  let dryRunCount = 0
  let totalCost   = 0

  for (const lead of leads) {
    const safeName    = LEAD_FILTER || sanitizeName(lead.name)
    const emailPath   = join(CONTENT_DIR, safeName, 'email.json')
    const displayName = lead.name || safeName

    // Resume: skip if email.json already has a complete sequence
    if (!isDryRun) {
      const existing = readJson(emailPath)
      if (existing?.email1?.subject && existing?.email2?.body && existing?.email3?.body) {
        console.log(`[EMAIL] SKIP  ${displayName} — email.json exists`)
        skipped++
        continue
      }
    }

    const content = readJson(join(CONTENT_DIR, safeName, 'content.json'))
    if (!content) {
      console.log(`[EMAIL] SKIP  ${displayName} — content.json not found`)
      skipped++
      continue
    }

    // Backfill XLSX fields that content.json might not have stored
    if (lead.pitch_angle  && !content.pitch_angle)  content.pitch_angle  = lead.pitch_angle
    if (lead.full_address && !content.full_address) content.full_address = lead.full_address

    const prompt = buildProblemPrompt(content)

    // ── Dry-run: print prompt + all 3 assembled emails ────────────────────
    if (isDryRun) {
      dryRunCount++
      const placeholder = '[PROBLEMA_ESPECIFICO — generado por Haiku]'
      const e1 = assembleEmail1(content, placeholder, (content.category || 'negocios locales').toLowerCase())
      const e2 = assembleEmail2(content, e1.subject)
      const e3 = assembleEmail3(content, e1.subject)

      console.log(`\n${'═'.repeat(70)}`)
      console.log(`DRY RUN — Lead ${dryRunCount}: ${displayName}`)
      console.log(`safeName : ${safeName}`)
      console.log(`Output   : ${emailPath}`)
      console.log(`${'─'.repeat(70)}`)
      console.log('PROMPT TO HAIKU:')
      console.log(prompt)
      console.log(`${'─'.repeat(70)}`)
      console.log(`EMAIL 1 (Day 0) — Subject: ${e1.subject}\n`)
      console.log(e1.body)
      console.log(`${'─'.repeat(70)}`)
      console.log(`EMAIL 2 (Day 4) — Subject: ${e2.subject}\n`)
      console.log(e2.body)
      console.log(`${'─'.repeat(70)}`)
      console.log(`EMAIL 3 (Day 12) — Subject: ${e3.subject}\n`)
      console.log(e3.body)

      if (dryRunCount >= 2) break
      continue
    }

    // ── Live: call Haiku for problem sentence, assemble all 3 emails ──────
    try {
      process.stdout.write(`[EMAIL] GEN   ${displayName} ... `)

      const message = await client.messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        messages:   [{ role: 'user', content: prompt }],
      })

      const rawText                    = message.content[0]?.text || ''
      const { problemSentence, tipo } = parseProblemResponse(rawText)

      const email1 = assembleEmail1(content, problemSentence, tipo)
      const email2 = assembleEmail2(content, email1.subject)
      const email3 = assembleEmail3(content, email1.subject)

      const emailData = { email1, email2, email3, previewUrl: null }
      writeFileSync(emailPath, JSON.stringify(emailData, null, 2), 'utf-8')

      // Haiku pricing: $1.00/1M input, $5.00/1M output
      const inputTokens  = message.usage.input_tokens
      const outputTokens = message.usage.output_tokens
      const cost = (inputTokens * 0.000001) + (outputTokens * 0.000005)
      totalCost += cost

      console.log('✓')
      console.log(`  ↳ Problem  : ${problemSentence}`)
      console.log(`  ↳ Tipo     : ${tipo}`)
      console.log(`  ↳ Subject1 : ${email1.subject}`)
      console.log(`  ↳ Tokens   : ${inputTokens} in / ${outputTokens} out | Cost: $${cost.toFixed(5)}`)

      if (LEAD_FILTER) {
        console.log(`\n  EMAIL 1 (Day 0):\n`)
        console.log(email1.body)
        console.log(`\n  EMAIL 2 (Day 4):\n`)
        console.log(email2.body)
        console.log(`\n  EMAIL 3 (Day 12):\n`)
        console.log(email3.body)
        console.log(`\n  File: ${emailPath}`)
      }

      processed++

      if (leads.indexOf(lead) < leads.length - 1) {
        await sleep(SLEEP_MS)
      }
    } catch (err) {
      console.log('✗ ERROR')
      if (err instanceof Anthropic.RateLimitError) {
        console.error(`  [RATE LIMIT] Waiting 30s before continuing...`)
        await sleep(30_000)
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
    console.log(`\n[EMAIL] Dry run complete — ${dryRunCount} prompt(s) printed, no API calls made`)
    return
  }

  console.log('\n' + '═'.repeat(46))
  console.log('  EMAIL CONTENT COMPLETE')
  console.log('═'.repeat(46))
  console.log(`  Neighborhood : ${NEIGHBORHOOD}`)
  console.log(`  Template     : PAS (3-email sequence)`)
  console.log(`  Processed    : ${processed}`)
  console.log(`  Skipped      : ${skipped}`)
  console.log(`  Errors       : ${errors}`)
  console.log(`  Total cost   : $${totalCost.toFixed(4)}`)
  console.log(`  Duration     : ${elapsed}s`)
  console.log(`  Output       : ${CONTENT_DIR}/*/email.json`)
  console.log('═'.repeat(46))
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
