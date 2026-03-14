// pipeline/8-emailcontent.mjs — Generate full 3-email outreach sequence per lead
//
// Usage:
//   node pipeline/8-emailcontent.mjs
//   node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina
//   node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina --dry-run
//   node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina --lead <safeName>
//
// Input:  output/{neighborhood}/runs/{runId}/leads_audited.xlsx      (latest run)
//         output/{neighborhood}/leads/<safeName>/content.json
// Output: output/{neighborhood}/leads/<safeName>/email.json
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
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { getNeighborhoodName, sanitizeName, getTargetLeads, getNeighborhoodDirs, getLatestRunDir, logDate } from './utils.mjs'

// ── Config ────────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName()
const dirs         = getNeighborhoodDirs(NEIGHBORHOOD)
let RUN_DIR
try {
  RUN_DIR = getLatestRunDir(NEIGHBORHOOD)
} catch (err) {
  console.error(`[ERROR] ${err.message}`)
  process.exit(1)
}
const INPUT_FILE = `${RUN_DIR}/leads_audited.xlsx`
const LEADS_DIR  = dirs.leads
const LOG_FILE   = `${dirs.logs}/emailcontent_${logDate()}.log`
mkdirSync(dirs.logs, { recursive: true })
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 192 // JSON with problema sentence + tipo field
const SLEEP_MS = 200

// ── CLI flags ─────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run')

function getLeadFilter() {
  const idx = process.argv.indexOf('--lead')
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null
}
const LEAD_FILTER = getLeadFilter()

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  if (!isDryRun) appendFileSync(LOG_FILE, line + '\n')
}

function logError(msg) {
  const line = `[${new Date().toISOString()}] [ERROR] ${msg}`
  console.error(line)
  if (!isDryRun) appendFileSync(LOG_FILE, line + '\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

// Truncate long business names for subject lines (50-char limit recommended).
// "Area2 Instalaciones Eléctricas y Mecánicas S.A., algo que notamos..." → too long.
function truncateName(name, maxLen = 28) {
  if (!name || name.length <= maxLen) return name
  return name.slice(0, maxLen).trimEnd() + '…'
}

// ── Prompt: asks Haiku for ONE problem sentence only ─────────────────────────

function buildProblemPrompt(content) {
  const name = content.name || 'este negocio'
  const category = content.category || 'negocio local'
  const pitch = content.pitch_angle || ''
  const description = content.description || '' // Google Maps business description

  const sectionTitles = (content.sections || [])
    .slice(0, 3)
    .map((s) => s.heading)
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
${description ? `- Descripción (Google Maps): ${description}` : ''}
- Problema detectado (pitch): ${pitch || '(no especificado — deduce del contexto)'}
- ${siteStatus}

CAMPOS A DEVOLVER:
1. "problema": UNA sola frase en español describiendo el problema específico detectado en su web.
   - Máximo 25 palabras. Empieza en minúscula (irá después de dos puntos en el email).
   - Sé específico: menciona el problema concreto (móvil, velocidad, SEO, diseño anticuado, web no accesible, sin web, etc.).
   - Debe sonar como si hubieras mirado la web de verdad, no genérico.
   - Sin comillas, sin punto final. En español.

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
    throw new Error(
      `Response is not valid JSON: ${err.message}\nRaw: ${rawText.slice(0, 200)}`
    )
  }

  const problema = (parsed.problema || '').replace(/\.$/, '').trim()
  const tipo = (parsed.tipo || '').toLowerCase().trim()

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

// LSSI-compliant footer appended to every email (required by Spanish law).
// V2: replace reply-based opt-out with mejoraweb.app/unsubscribe + backend endpoint.
const LEGAL_FOOTER = [
  '--',
  'Andrés Ramírez · mejoraweb.app',
  'IE Business School · María de Molina 31, 28006 Madrid',
  'Para darte de baja, responde con "No gracias".',
].join('\n')

function assembleEmail1(content, problemSentence, tipo) {
  const name = content.name || 'su negocio'
  const subject = `${truncateName(name)}, algo que notamos en tu web`

  const body = [
    'Hola,',
    '',
    'Somos dos estudiantes del IE lanzando mejoraweb.app aquí en el barrio de María de Molina.',
    '',
    `Antes de escribirte, analizamos tu web: ${problemSentence}. Eso se traduce en clientes que buscan ${tipo} en la zona y que no llegan a encontrarte.`,
    '',
    `Ya preparamos un diseño nuevo de ${name} teniendo esto en cuenta. ¿Te lo mandamos? Si te gusta, podemos hablar 5 minutos.`,
    '',
    'Un saludo,',
    'Andrés',
    'mejoraweb.app',
    '',
    LEGAL_FOOTER,
  ].join('\n')

  return { subject, body }
}

function assembleEmail2(content, subject1) {
  const name = content.name || 'su negocio'
  const subject = `Re: ${subject1}`

  const body = [
    'Hola,',
    '',
    `Te escribí hace unos días sobre ${name}. Por si no lo viste, preparamos un diseño nuevo. Aquí lo tienes:`,
    '',
    '{{PREVIEW_URL}}',
    '',
    'Si te gusta, dime y buscamos un momento para hablarlo.',
    '',
    'Andrés',
    'mejoraweb.app',
    '',
    LEGAL_FOOTER,
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
    '',
    LEGAL_FOOTER,
  ].join('\n')

  return { subject, body }
}

// ── Main ──────────────────────────────────────────────────────────────────────

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
    const content = readJson(join(LEADS_DIR, LEAD_FILTER, 'content.json'))
    if (!content) {
      console.error(
        `[ERROR] content.json not found for --lead "${LEAD_FILTER}"`
      )
      console.error(
        `        Expected: ${join(LEADS_DIR, LEAD_FILTER, 'content.json')}`
      )
      process.exit(1)
    }
    leads = [{ name: content.name || LEAD_FILTER }]
  } else {
    leads = await getTargetLeads(INPUT_FILE)
  }

  if (leads.length === 0) {
    log(`[EMAIL] No target leads found in ${INPUT_FILE}`)
    process.exit(0)
  }

  log(`[EMAIL] Neighborhood : ${NEIGHBORHOOD}`)
  log(
    `[EMAIL] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`
  )
  log(`[EMAIL] Mode         : ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`)
  log(`[EMAIL] Model        : ${MODEL}`)
  log(`[EMAIL] Template     : PAS — 3-email sequence (Day 0 / Day 4 / Day 12)`)

  const startTime = Date.now()
  let processed = 0
  let skipped = 0
  let errors = 0
  let dryRunCount = 0
  let totalCost = 0

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]
    const safeName = LEAD_FILTER || sanitizeName(lead.name)
    const emailPath = join(LEADS_DIR, safeName, 'email.json')
    const displayName = lead.name || safeName

    // Resume: skip if email.json already has a complete sequence
    if (!isDryRun) {
      const existing = readJson(emailPath)
      if (
        existing?.email1?.subject &&
        existing?.email2?.body &&
        existing?.email3?.body
      ) {
        log(`[EMAIL] SKIP  ${displayName} — email.json exists`)
        skipped++
        continue
      }
    }

    const content = readJson(join(LEADS_DIR, safeName, 'content.json'))
    if (!content) {
      log(`[EMAIL] SKIP  ${displayName} — content.json not found`)
      skipped++
      continue
    }

    // Backfill XLSX fields that content.json might not have stored
    if (lead.pitch_angle && !content.pitch_angle)
      content.pitch_angle = lead.pitch_angle
    if (lead.full_address && !content.full_address)
      content.full_address = lead.full_address

    const prompt = buildProblemPrompt(content)

    // ── Dry-run: print prompt + all 3 assembled emails ────────────────────
    if (isDryRun) {
      dryRunCount++
      const placeholder = '[PROBLEMA_ESPECIFICO — generado por Haiku]'
      const placeholderTipo = (
        content.category || 'negocios locales'
      ).toLowerCase()
      const e1 = assembleEmail1(content, placeholder, placeholderTipo)
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
    let attempt = 0
    let success = false

    while (attempt < 2 && !success) {
      attempt++
      try {
        process.stdout.write(
          `[EMAIL] GEN   ${displayName}${attempt > 1 ? ' (retry)' : ''} ... `
        )

        const message = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }]
        })

        const rawText = message.content[0]?.text || ''
        const { problemSentence, tipo } = parseProblemResponse(rawText)

        const email1 = assembleEmail1(content, problemSentence, tipo)
        const email2 = assembleEmail2(content, email1.subject)
        const email3 = assembleEmail3(content, email1.subject)

        const emailData = { email1, email2, email3, previewUrl: null }
        writeFileSync(emailPath, JSON.stringify(emailData, null, 2), 'utf-8')

        // Haiku pricing: $1.00/1M input, $5.00/1M output
        const inputTokens = message.usage.input_tokens
        const outputTokens = message.usage.output_tokens
        const cost = inputTokens * 0.000001 + outputTokens * 0.000005
        totalCost += cost

        console.log('✓')
        log(`  ↳ Problem  : ${problemSentence}`)
        log(`  ↳ Tipo     : ${tipo}`)
        log(`  ↳ Subject1 : ${email1.subject}`)
        log(
          `  ↳ Tokens   : ${inputTokens} in / ${outputTokens} out | Cost: $${cost.toFixed(5)}`
        )

        if (LEAD_FILTER) {
          log(`\n  EMAIL 1 (Day 0):\n`)
          log(email1.body)
          log(`\n  EMAIL 2 (Day 4):\n`)
          log(email2.body)
          log(`\n  EMAIL 3 (Day 12):\n`)
          log(email3.body)
          log(`\n  File: ${emailPath}`)
        }

        processed++
        success = true

        if (i < leads.length - 1) {
          await sleep(SLEEP_MS)
        }
      } catch (err) {
        if (attempt === 1 && err instanceof Anthropic.RateLimitError) {
          console.log('✗ RATE LIMIT')
          log(`  [RATE LIMIT] Waiting 30s then retrying...`)
          await sleep(30_000)
          // Loop continues for attempt 2
        } else {
          console.log('✗ ERROR')
          if (err instanceof Anthropic.RateLimitError) {
            logError(`${displayName} — rate limited on retry, giving up`)
          } else if (err instanceof Anthropic.APIError) {
            logError(`${displayName} — API error ${err.status}: ${err.message}`)
          } else {
            logError(`${displayName} — ${err.message}`)
          }
          errors++
          break
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)

  if (isDryRun) {
    console.log(
      `\n[EMAIL] Dry run complete — ${dryRunCount} prompt(s) printed, no API calls made`
    )
    return
  }

  log('')
  log('═'.repeat(46))
  log('  EMAIL CONTENT COMPLETE')
  log('═'.repeat(46))
  log(`  Neighborhood : ${NEIGHBORHOOD}`)
  log(`  Template     : PAS (3-email sequence)`)
  log(`  Processed    : ${processed}`)
  log(`  Skipped      : ${skipped}`)
  log(`  Errors       : ${errors}`)
  log(`  Total cost   : $${totalCost.toFixed(4)}`)
  log(`  Duration     : ${elapsed}s`)
  log(`  Output       : ${LEADS_DIR}/*/email.json`)
  log(`  Log          : ${LOG_FILE}`)
  log('═'.repeat(46))
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
