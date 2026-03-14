// pipeline/9-deploy.mjs — Deploy lead mockups to Cloudflare Pages
//
// Usage:
//   node pipeline/9-deploy.mjs
//   node pipeline/9-deploy.mjs --neighborhood maria_de_molina
//   node pipeline/9-deploy.mjs --neighborhood maria_de_molina --dry-run
//   node pipeline/9-deploy.mjs --neighborhood maria_de_molina --lead <safeName>
//
// Input:  output/{neighborhood}/runs/{runId}/leads_audited.xlsx       (latest run)
//         output/{neighborhood}/leads/<safeName>/mockdesign.html
//         output/{neighborhood}/leads/<safeName>/email.json           (needs {{PREVIEW_URL}} in email2/email3)
// Output: output/{neighborhood}/leads/<safeName>/email.json           (previewUrl set, email2/email3 updated)
//
// Each lead's mockdesign.html (+ logo.png if present) is uploaded to a dedicated
// Cloudflare Pages deployment. The returned preview URL replaces {{PREVIEW_URL}} in
// email2.body and email3.body, and is stored as email.json.previewUrl.
//
// Cleanup runs at the start of each full (non-lead-filter) run: any deployment on the
// project that is older than STALE_DAYS days is deleted.
//
// Resume-safe: skips leads where email.json.previewUrl is already set.
// --dry-run: prints what would be deployed / cleaned, makes no API calls.
//
// Required env vars:
//   CLOUDFLARE_ACCOUNT_ID       — found in Cloudflare dashboard → Workers & Pages
//   CLOUDFLARE_API_TOKEN        — API token with Pages:Edit permission
//   CLOUDFLARE_PAGES_PROJECT    — name of your Pages project (must already exist)
//
// Project setup (one-time):
//   1. cloudflare.com → Workers & Pages → Create application → Pages → Direct Upload
//   2. Give it a project name (e.g. "mejoraweb-previews") and upload any placeholder
//   3. Copy the Account ID and create an API token with Pages:Edit scope

import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getNeighborhoodName, sanitizeName, getTargetLeads, getNeighborhoodDirs, getLatestRunDir } from './utils.mjs'

// ── Config ────────────────────────────────────────────────────────────────────

const NEIGHBORHOOD  = getNeighborhoodName()
const dirs          = getNeighborhoodDirs(NEIGHBORHOOD)
let RUN_DIR
try {
  RUN_DIR = getLatestRunDir(NEIGHBORHOOD)
} catch (err) {
  console.error(`[ERROR] ${err.message}`)
  process.exit(1)
}
const INPUT_FILE    = `${RUN_DIR}/leads_audited.xlsx`
const LEADS_DIR     = dirs.leads
const CF_BASE       = 'https://api.cloudflare.com/client/v4'
const STALE_DAYS    = 15
const SLEEP_MS      = 600  // between deploys — CF Pages rate limit headroom

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

// ── Minimal ZIP writer — store mode (no compression) ─────────────────────────
// Implements just enough of the ZIP spec (PKZIP 2.0) to bundle 1–10 small files.
// Uses CRC-32 and uncompressed storage; no ZIP64 (files must be < 4 GB each).

function crc32(buf) {
  if (!crc32._table) {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[i] = c
    }
    crc32._table = t
  }
  let c = 0xFFFFFFFF
  for (const b of buf) c = (c >>> 8) ^ crc32._table[(c ^ b) & 0xFF]
  return (c ^ 0xFFFFFFFF) >>> 0
}

function buildZip(entries) {
  // entries: Array<{ name: string, data: Buffer }>
  const localParts  = []   // local file header + data chunks
  const centralParts = []  // central directory chunks
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf-8')
    const crc       = crc32(data)
    const size      = data.length

    // Local file header — 30 bytes fixed + variable filename
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)       // local file header signature
    lh.writeUInt16LE(20, 4)               // version needed (2.0)
    lh.writeUInt16LE(0, 6)               // general purpose flags
    lh.writeUInt16LE(0, 8)               // compression method (0 = store)
    lh.writeUInt16LE(0, 10)              // last mod time
    lh.writeUInt16LE(0, 12)              // last mod date
    lh.writeUInt32LE(crc, 14)            // CRC-32
    lh.writeUInt32LE(size, 18)           // compressed size
    lh.writeUInt32LE(size, 22)           // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26) // file name length
    lh.writeUInt16LE(0, 28)              // extra field length

    localParts.push(lh, nameBytes, data)

    // Central directory header — 46 bytes fixed + variable filename
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)       // central directory signature
    ch.writeUInt16LE(20, 4)               // version made by
    ch.writeUInt16LE(20, 6)               // version needed
    ch.writeUInt16LE(0, 8)               // flags
    ch.writeUInt16LE(0, 10)              // compression method
    ch.writeUInt16LE(0, 12)              // mod time
    ch.writeUInt16LE(0, 14)              // mod date
    ch.writeUInt32LE(crc, 16)            // CRC-32
    ch.writeUInt32LE(size, 20)           // compressed size
    ch.writeUInt32LE(size, 24)           // uncompressed size
    ch.writeUInt16LE(nameBytes.length, 28) // file name length
    ch.writeUInt16LE(0, 30)              // extra field length
    ch.writeUInt16LE(0, 32)              // file comment length
    ch.writeUInt16LE(0, 34)              // disk number start
    ch.writeUInt16LE(0, 36)              // internal attributes
    ch.writeUInt32LE(0, 38)              // external attributes
    ch.writeUInt32LE(offset, 42)         // offset of local header

    centralParts.push(ch, nameBytes)
    offset += 30 + nameBytes.length + size
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0)

  // End of central directory record — 22 bytes
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)       // EOCD signature
  eocd.writeUInt16LE(0, 4)               // disk number
  eocd.writeUInt16LE(0, 6)               // disk with central dir
  eocd.writeUInt16LE(entries.length, 8)  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(centralSize, 12)    // size of central directory
  eocd.writeUInt32LE(offset, 16)         // offset of central directory
  eocd.writeUInt16LE(0, 20)             // comment length

  return Buffer.concat([...localParts, ...centralParts, eocd])
}

// ── Cloudflare Pages API ──────────────────────────────────────────────────────

function cfHeaders() {
  return { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
}

function cfUrl(path) {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_PAGES_PROJECT } = process.env
  return `${CF_BASE}/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${CLOUDFLARE_PAGES_PROJECT}${path}`
}

async function cfJson(method, path, body) {
  const opts = { method, headers: cfHeaders() }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res  = await fetch(cfUrl(path), opts)
  const json = await res.json()
  if (!json.success) {
    throw new Error(`CF API ${method} ${path} → ${JSON.stringify(json.errors)}`)
  }
  return json.result
}

// Upload files to a new Cloudflare Pages deployment.
// Returns the deployment object { id, url, created_on }.
async function cfDeploy(entries) {
  const zipBuf   = buildZip(entries)
  const formData = new FormData()
  formData.set('file', new Blob([zipBuf], { type: 'application/zip' }), 'site.zip')

  const res  = await fetch(cfUrl('/deployments'), {
    method:  'POST',
    headers: cfHeaders(),
    body:    formData,
  })
  const json = await res.json()
  if (!json.success) {
    throw new Error(`CF deploy error: ${JSON.stringify(json.errors)}`)
  }
  return json.result
}

// List all deployments for the project (handles pagination).
async function cfListDeployments() {
  const all  = []
  let page   = 1
  while (true) {
    const result = await cfJson('GET', `/deployments?per_page=100&page=${page}`)
    const items  = Array.isArray(result) ? result : []
    all.push(...items)
    if (items.length < 100) break
    page++
  }
  return all
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!LEAD_FILTER && !existsSync(INPUT_FILE)) {
    console.error(`[ERROR] Input file not found: ${INPUT_FILE}`)
    console.error(`        Run the auditor first: node pipeline/2-auditor.mjs --neighborhood ${NEIGHBORHOOD}`)
    process.exit(1)
  }

  if (!isDryRun) {
    const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_PAGES_PROJECT']
    const missing  = required.filter(k => !process.env[k]?.trim())
    if (missing.length) {
      console.error(`[ERROR] Missing env vars: ${missing.join(', ')}`)
      console.error('        Add them to your .env file.')
      process.exit(1)
    }
  }

  // ── Build lead list ────────────────────────────────────────────────────────
  let leads
  if (LEAD_FILTER) {
    leads = [{ name: LEAD_FILTER }]
  } else {
    leads = await getTargetLeads(INPUT_FILE)
  }

  if (leads.length === 0) {
    console.log(`[DEPLOY] No target leads found in ${INPUT_FILE}`)
    process.exit(0)
  }

  const project = process.env.CLOUDFLARE_PAGES_PROJECT || '(not set)'
  console.log(`[DEPLOY] Neighborhood : ${NEIGHBORHOOD}`)
  console.log(`[DEPLOY] Leads        : ${leads.length}${LEAD_FILTER ? ` (filtered: ${LEAD_FILTER})` : ''}`)
  console.log(`[DEPLOY] Mode         : ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`)
  console.log(`[DEPLOY] Project      : ${project}`)

  // ── Cleanup stale deployments (full run only) ──────────────────────────────
  if (!isDryRun && !LEAD_FILTER) {
    console.log(`\n[DEPLOY] Checking stale deployments (older than ${STALE_DAYS} days)...`)
    try {
      const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000)
      const all    = await cfListDeployments()
      const stale  = all.filter(d => new Date(d.created_on) < cutoff)

      if (stale.length === 0) {
        console.log(`[DEPLOY] No stale deployments found`)
      } else {
        console.log(`[DEPLOY] Deleting ${stale.length} stale deployment(s)...`)
        for (const d of stale) {
          try {
            await cfJson('DELETE', `/deployments/${d.id}?force=true`)
            console.log(`  ↳ Deleted ${d.id} (${d.created_on.slice(0, 10)})`)
          } catch (err) {
            console.error(`  ↳ Failed to delete ${d.id}: ${err.message}`)
          }
        }
      }
    } catch (err) {
      console.error(`[DEPLOY] Cleanup error: ${err.message}`)
    }
  } else if (isDryRun && !LEAD_FILTER) {
    console.log(`\n[DEPLOY] (Dry run — stale cleanup skipped)`)
  }

  const startTime  = Date.now()
  let deployed     = 0
  let skipped      = 0
  let errors       = 0
  let dryRunCount  = 0

  // ── Process each lead ──────────────────────────────────────────────────────
  for (const lead of leads) {
    const safeName    = LEAD_FILTER || sanitizeName(lead.name)
    const leadDir     = join(LEADS_DIR, safeName)
    const displayName = lead.name || safeName

    const mockdesignPath = join(leadDir, 'mockdesign.html')
    const emailPath      = join(leadDir, 'email.json')
    const logoPath       = join(leadDir, 'logo.png')

    // Validate required inputs
    if (!existsSync(mockdesignPath)) {
      console.log(`[DEPLOY] SKIP  ${displayName} — mockdesign.html not found`)
      skipped++
      continue
    }

    const emailData = readJson(emailPath)
    if (!emailData?.email1?.subject || !emailData?.email2?.body || !emailData?.email3?.body) {
      console.log(`[DEPLOY] SKIP  ${displayName} — email.json missing or incomplete (run stage 8 first)`)
      skipped++
      continue
    }

    // Resume: skip if already deployed
    if (emailData.previewUrl) {
      console.log(`[DEPLOY] SKIP  ${displayName} — already deployed: ${emailData.previewUrl}`)
      skipped++
      continue
    }

    const hasLogo = existsSync(logoPath)

    if (isDryRun) {
      dryRunCount++
      console.log(`\n[DEPLOY] DRY   ${displayName}`)
      console.log(`  ↳ HTML      : ${mockdesignPath}`)
      console.log(`  ↳ Logo      : ${hasLogo ? logoPath : '(none)'}`)
      console.log(`  ↳ Would write previewUrl to: ${emailPath}`)
      continue
    }

    // Live: build ZIP and deploy
    try {
      process.stdout.write(`[DEPLOY] UP    ${displayName} ... `)

      const entries = [
        { name: 'index.html', data: readFileSync(mockdesignPath) },
      ]
      if (hasLogo) {
        entries.push({ name: 'logo.png', data: readFileSync(logoPath) })
      }

      const deployment  = await cfDeploy(entries)
      const previewUrl  = deployment?.url

      if (!previewUrl) {
        throw new Error(`No URL in deployment response. Got: ${JSON.stringify(deployment)}`)
      }

      // Update email.json: set previewUrl, inject into email2 and email3
      emailData.previewUrl      = previewUrl
      emailData.email2.body     = emailData.email2.body.replace('{{PREVIEW_URL}}', previewUrl)
      emailData.email3.body     = emailData.email3.body.replace('{{PREVIEW_URL}}', previewUrl)
      writeFileSync(emailPath, JSON.stringify(emailData, null, 2), 'utf-8')

      console.log('✓')
      console.log(`  ↳ URL       : ${previewUrl}`)
      console.log(`  ↳ Deploy ID : ${deployment.id}`)
      if (hasLogo) console.log(`  ↳ Logo      : included`)

      deployed++

      if (leads.indexOf(lead) < leads.length - 1) {
        await sleep(SLEEP_MS)
      }
    } catch (err) {
      console.log('✗ ERROR')
      console.error(`  [ERROR] ${err.message}`)
      errors++
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)

  if (isDryRun) {
    console.log(`\n[DEPLOY] Dry run complete — ${dryRunCount} lead(s) would be deployed, ${skipped} skipped`)
    return
  }

  console.log('\n' + '═'.repeat(46))
  console.log('  DEPLOY COMPLETE')
  console.log('═'.repeat(46))
  console.log(`  Neighborhood : ${NEIGHBORHOOD}`)
  console.log(`  Deployed     : ${deployed}`)
  console.log(`  Skipped      : ${skipped}`)
  console.log(`  Errors       : ${errors}`)
  console.log(`  Duration     : ${elapsed}s`)
  console.log(`  Project      : ${project}`)
  console.log(`  URL pattern  : https://{id}.${project}.pages.dev`)
  console.log('═'.repeat(46))
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
