// pipeline/6-mockdesign.mjs — Generate HTML mockup of redesigned website via Claude API
//
// Usage:
//   node pipeline/6-mockdesign.mjs
//   node pipeline/6-mockdesign.mjs --neighborhood maria_de_molina
//   node pipeline/6-mockdesign.mjs --neighborhood maria_de_molina --dry-run
//   node pipeline/6-mockdesign.mjs --neighborhood maria_de_molina --lead area2_instalaciones_eléctricas_y_mecánicas_s_a
//
// Input:  output/leads_audited_<neighborhood>.xlsx
//         output/content_<neighborhood>/<safeName>/design_prompt.md  (stage 5)
//         docs/design-prompt-guide.md                                (shared UI/UX standards)
// Output: output/content_<neighborhood>/<safeName>/mockdesign.html
//         output/mockdesign_<neighborhood>.log
//
// Skips leads that already have mockdesign.html (resumable).
// --dry-run prints the full combined prompt for the first 2 leads without calling the API.

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join, resolve } from 'path'
import { getNeighborhoodName, sanitizeName, getTargetLeads } from './utils.mjs'

// ── Config ───────────────────────────────────────────────────────────────────

const NEIGHBORHOOD = getNeighborhoodName()
const INPUT_FILE   = `output/leads_audited_${NEIGHBORHOOD}.xlsx`
const CONTENT_DIR  = `output/content_${NEIGHBORHOOD}`
const LOG_FILE     = `output/mockdesign_${NEIGHBORHOOD}.log`
const GUIDE_FILE   = 'docs/design-prompt-guide.md'
const MODEL        = 'claude-sonnet-4-6'
// 600–900 line HTML ≈ 15–20K output tokens. 26K gives headroom for complex sites.
const MAX_TOKENS   = 26000
const SLEEP_MS     = 1200  // courtesy delay between API calls
const MIN_PROMPT_BYTES = 512  // design_prompt.md smaller than this is likely broken

// ── CLI flags ────────────────────────────────────────────────────────────────

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

// ── Prompt readers ────────────────────────────────────────────────────────────

/**
 * Reads docs/design-prompt-guide.md — shared UI/UX standards injected before
 * every per-lead prompt. Returns null (with a warning) if the file is missing.
 */
function readDesignGuide() {
  if (!existsSync(GUIDE_FILE)) {
    log(`[WARN] design-prompt-guide.md not found at ${GUIDE_FILE} — sending per-lead prompt only`)
    return null
  }
  try {
    return readFileSync(GUIDE_FILE, 'utf-8')
  } catch {
    log(`[WARN] Could not read ${GUIDE_FILE} — sending per-lead prompt only`)
    return null
  }
}

/**
 * Reads the design_prompt.md assembled by stage 5.
 * Returns null if the file doesn't exist or is too small to be valid.
 */
function readDesignPrompt(safeName) {
  const path = join(CONTENT_DIR, safeName, 'design_prompt.md')
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8')
    if (content.length < MIN_PROMPT_BYTES) return null
    return content
  } catch {
    return null
  }
}

/**
 * Combines the shared design guide with the per-lead prompt.
 * Guide comes first so per-lead instructions take precedence over guide defaults.
 */
function buildFullPrompt(guide, designPrompt) {
  if (!guide) return designPrompt
  return `${guide}\n\n---\n\n${designPrompt}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  // Load shared design guide once at startup
  const guide = readDesignGuide()

  let leads
  if (LEAD_FILTER) {
    // --lead mode: verify design_prompt.md exists, no XLSX dependency
    const promptPath = join(CONTENT_DIR, LEAD_FILTER, 'design_prompt.md')
    if (!existsSync(promptPath)) {
      console.error(`[ERROR] design_prompt.md not found for --lead "${LEAD_FILTER}"`)
      console.error(`        Expected: ${promptPath}`)
      console.error(`        Run stage 5 first: node pipeline/5-prompts.mjs --lead ${LEAD_FILTER}`)
      process.exit(1)
    }
    leads = [{ name: LEAD_FILTER }]
  } else {
    leads = await getTargetLeads(INPUT_FILE)
  }

  if (leads.length === 0) {
    log(`[MOCK] No target leads found in ${INPUT_FILE}`)
    process.exit(0)
  }

  log(`[MOCK] Neighborhood : ${NEIGHBORHOOD}`)
  log(`[MOCK] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`)
  log(`[MOCK] Mode         : ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`)
  log(`[MOCK] Model        : ${MODEL}`)
  log(`[MOCK] Guide        : ${guide ? `loaded (${(guide.length / 1024).toFixed(1)}KB)` : 'NOT FOUND — per-lead only'}`)

  const startTime = Date.now()
  let processed  = 0
  let skipped    = 0
  let errors     = 0
  let totalCost  = 0
  let dryRunCount = 0

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]
    const safeName   = LEAD_FILTER || sanitizeName(lead.name)
    const outputPath = join(CONTENT_DIR, safeName, 'mockdesign.html')

    // Skip if already generated (resumable)
    if (!isDryRun && existsSync(outputPath)) {
      log(`[MOCK] SKIP  ${lead.name} — mockdesign.html exists`)
      skipped++
      continue
    }

    const designPrompt = readDesignPrompt(safeName)
    if (!designPrompt) {
      log(`[MOCK] SKIP  ${lead.name} — design_prompt.md missing or too small (run stage 5 first)`)
      skipped++
      continue
    }

    const fullPrompt = buildFullPrompt(guide, designPrompt)

    // Dry-run: print full combined prompt for first 2 leads and stop
    if (isDryRun) {
      dryRunCount++
      console.log(`\n${'═'.repeat(70)}`)
      console.log(`DRY RUN — Lead ${dryRunCount}: ${lead.name}`)
      console.log(`safeName: ${safeName}`)
      console.log(`Output would be: ${outputPath}`)
      console.log(`Prompt size: ${(fullPrompt.length / 1024).toFixed(1)}KB (guide: ${guide ? (guide.length / 1024).toFixed(1) + 'KB' : 'none'} + per-lead: ${(designPrompt.length / 1024).toFixed(1)}KB)`)
      console.log(`${'─'.repeat(70)}`)
      console.log('FULL PROMPT:')
      console.log(fullPrompt)
      if (dryRunCount >= 2) break
      continue
    }

    // Live: call Claude API with streaming, retry once on rate limit
    let attempt = 0
    let success = false

    while (attempt < 2 && !success) {
      attempt++
      try {
        process.stdout.write(`[MOCK] GEN   ${lead.name}${attempt > 1 ? ' (retry)' : ''} ... `)

        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: fullPrompt }]
        })

        const message = await stream.finalMessage()

        // Check for truncation before accepting the output
        if (message.stop_reason === 'max_tokens') {
          throw new Error(
            `Output truncated at token limit (${message.usage.output_tokens} tokens) — HTML is incomplete. ` +
            `Consider splitting the prompt or reducing MAX_TOKENS target length.`
          )
        }

        const html = message.content[0]?.text?.trim() || ''

        if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
          throw new Error(
            `Unexpected response format (first 100 chars): ${html.slice(0, 100)}`
          )
        }

        writeFileSync(outputPath, html, 'utf-8')
        const lineCount = html.split('\n').length
        const inputTokens  = message.usage.input_tokens
        const outputTokens = message.usage.output_tokens
        const cost = inputTokens * 0.000003 + outputTokens * 0.000015
        totalCost += cost

        console.log(`✓ (${lineCount} lines, ${(html.length / 1024).toFixed(1)}KB)`)
        log(
          `  ↳ Tokens: ${inputTokens} in / ${outputTokens} out | Cost: $${cost.toFixed(4)}`
        )

        if (LEAD_FILTER) {
          log(`\n  Open in browser:`)
          log(`  file://${resolve(outputPath)}`)
        }

        processed++
        success = true

        // Courtesy delay between leads (skip after last lead)
        if (i < leads.length - 1) {
          await sleep(SLEEP_MS)
        }
      } catch (err) {
        if (attempt === 1 && err instanceof Anthropic.RateLimitError) {
          console.log(`✗ RATE LIMIT`)
          log(`  [RATE LIMIT] Waiting 60s then retrying...`)
          await sleep(60_000)
          // Loop continues for attempt 2
        } else {
          console.log(`✗ ERROR`)
          if (err instanceof Anthropic.RateLimitError) {
            logError(`${lead.name} — rate limited on retry, giving up`)
          } else if (err instanceof Anthropic.APIError) {
            logError(`${lead.name} — API error ${err.status}: ${err.message}`)
          } else {
            logError(`${lead.name} — ${err.message}`)
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
      `\n[MOCK] Dry run complete — ${dryRunCount} prompt(s) printed, no API calls made`
    )
    return
  }

  log('')
  log('═'.repeat(46))
  log('  MOCK DESIGN COMPLETE')
  log('═'.repeat(46))
  log(`  Neighborhood : ${NEIGHBORHOOD}`)
  log(`  Processed    : ${processed}`)
  log(`  Skipped      : ${skipped}`)
  log(`  Errors       : ${errors}`)
  log(`  Total cost   : $${totalCost.toFixed(4)}`)
  log(`  Duration     : ${elapsed}s`)
  log(`  Output       : ${CONTENT_DIR}/`)
  log(`  Log          : ${LOG_FILE}`)
  log('═'.repeat(46))
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
