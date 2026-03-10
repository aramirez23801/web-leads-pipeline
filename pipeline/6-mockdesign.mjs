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

// ── Prompt reader ─────────────────────────────────────────────────────────────

/**
 * Reads the design_prompt.md assembled by stage 5.
 * Returns null if the file doesn't exist.
 */
function readDesignPrompt(safeName) {
  const path = join(CONTENT_DIR, safeName, 'design_prompt.md')
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
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

  let leads
  if (LEAD_FILTER) {
    // --lead mode: verify design_prompt.md exists, no XLSX dependency
    const promptPath = join(CONTENT_DIR, LEAD_FILTER, 'design_prompt.md')
    if (!existsSync(promptPath)) {
      console.error(
        `[ERROR] design_prompt.md not found for --lead "${LEAD_FILTER}"`
      )
      console.error(
        `        Expected: ${promptPath}`
      )
      console.error(
        `        Run stage 5 first: node pipeline/5-prompts.mjs --lead ${LEAD_FILTER}`
      )
      process.exit(1)
    }
    leads = [{ name: LEAD_FILTER }]
  } else {
    leads = await getTargetLeads(INPUT_FILE)
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

    const prompt = readDesignPrompt(safeName)
    if (!prompt) {
      console.log(`[MOCK] SKIP  ${lead.name} — design_prompt.md not found (run stage 5 first)`)
      skipped++
      continue
    }

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
