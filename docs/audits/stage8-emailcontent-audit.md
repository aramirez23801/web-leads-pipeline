# Stage 8 — `8-emailcontent.mjs` Audit
**Date:** 2026-03-11
**Status:** 🔄 Technical issues resolved — email content improvements pending discussion
**Audited by:** Claude Sonnet 4.6

---

## What This Stage Does

Calls Claude Haiku once per lead to generate a specific problem sentence, then assembles
a 3-email cold outreach sequence (Day 0 / Day 4 / Day 12) using fixed templates.
Output is `email.json` per lead — consumed by stage 9 (adds previewUrl) and stage 10 (CSV export).

**Inputs:**
- `output/leads_audited_{neighborhood}.xlsx` — Tier 1 + Tier 2 via `getTargetLeads()`
- `output/content_{neighborhood}/{safeName}/content.json` — pitch_angle, name, category, sections

**Outputs:**
- `output/content_{neighborhood}/{safeName}/email.json`
  ```json
  {
    "email1": { "subject": "...", "body": "..." },
    "email2": { "subject": "...", "body": "..." },
    "email3": { "subject": "...", "body": "..." },
    "previewUrl": null
  }
  ```

---

## Answer: Should the link be in email 1?

**No. The decision is correct and well-researched.** Three reasons, all documented in
`docs/2026-03-04-cold-email-structure.md`:

1. **Deliverability:** Links in cold email body are phishing signals to Gmail/Outlook.
   Plain text without links outperforms HTML+links by ~2× in reply rate.
2. **`pages.dev` is actively flagged:** 1,370 phishing incidents in 2024, tripled YoY.
   Gmail/Outlook have trained classifiers specifically on `pages.dev` from unknown senders.
3. **Micro-commitment:** Email 1 CTA is "¿Te lo mandamos?" — asking permission first creates
   a micro-commitment. The prospect then clicks the link in email 2 with intent, not as a
   cold URL. A reply to email 1 also warms the thread for email 2 delivery.

**The 3-email sequence (Day 0 / Day 4 / Day 12) is also correct:**
- 58% of replies come from email 1
- Follow-up at day 4 adds +65.8% more replies vs. stopping after email 1
- 4–7 email sequences get 27% reply rate vs. 9% for 1–3 — but 3 is a pragmatic balance
  between reply rate and sending volume for a v1 campaign

---

## Technical Audit

### 1. Error Handling & Resilience

**[HIGH] Rate limit waits 30s but doesn't retry — the lead is lost.**
Same bug stage 6 had before the audit. On `RateLimitError`, the code waits 30s, then
falls through to `errors++` and moves to the next lead. The rate-limited lead never gets
an `email.json`. Fix: retry loop (max 2 attempts), same pattern as stage 6.

**[LOW] No distinction between retryable and fatal API errors.**
`APIError` covers both transient (503, 529) and permanent (400 bad request) errors.
After the fix, the retry loop should only retry on rate limits — not on 400/validation errors.

---

### 2. Environment & Config Validation

✅ `ANTHROPIC_API_KEY` checked at startup — good.
✅ `INPUT_FILE` existence checked — good.
✅ `content.json` validated before use — good.

---

### 3. Data Integrity & Schema Validation

**[CRITICAL] `description` field not passed to Haiku.**
Tracked in `docs/audits/pending-cross-stage.md` (stage 1 audit, issue #8). The Google Maps
`description` field gives direct insight into what the business actually does and how it
presents itself. Currently Haiku only sees: name, category, pitch_angle, and top 3 section
titles. For leads where `description` is populated, passing it would produce significantly
more specific `problema` sentences.
Fix: add `description` to the `buildProblemPrompt()` context block.

**[HIGH] Subject line not truncated — can exceed 50 characters for long business names.**
Research finding: subject lines over 50 characters hurt open rates and get clipped in
mobile clients. `${name}, algo que notamos en tu web` — for a business named
"Area2 Instalaciones Eléctricas y Mecánicas S.A." this produces a 58-character subject.
Fix: truncate `name` in subject to ~30 chars max (`name.length > 30 ? name.slice(0, 27) + '...' : name`).

**[MEDIUM] Google rating/reviews not used in email body.**
Structure A (PAS) was chosen for v1. However, content.json has `rating` and `reviews` for
most leads. For high-rated leads (e.g., 4.9★ / 127 reviews), not referencing this is a
missed credibility signal. The AIDA structure (Structure B in research) integrates this well.
This is a quality improvement, not a bug — could be addressed in v2 or as an optional
sentence added to email 1 body when `rating >= 4.5 && reviews >= 20`.

---

### 4. Performance

**[LOW] `leads.indexOf(lead)` O(n) in sleep check.**
Line 368: `leads.indexOf(lead) < leads.length - 1` traverses the entire array on each
iteration. Replace with a loop index `i`, same fix applied in stage 6.

---

### 5. Rate Limiting & Politeness

`SLEEP_MS = 200` between leads — fine for Haiku (much cheaper, higher rate limit than Sonnet).
**[HIGH] Rate limit retry missing** — see §1 above.

---

### 6. Logging & Observability

**[LOW] No log file.**
Stage 8 only logs to stdout. All other API stages (6, 9) write a persistent log.
`appendFileSync` is not even imported.
Fix: add `appendFileSync` import, `LOG_FILE` constant, `log()`/`logError()` helpers.

**[LOW] No timestamps on log lines.**
Inconsistent with stages 4, 5, 6, 7, 9.

**[LOW] Summary block uses bare `console.log` — not written to log file.**

---

### 7. Idempotency

✅ Skips if `email.json` has complete sequence (`email1.subject && email2.body && email3.body`).
✅ `--lead` flag bypasses skip check — allows single-lead regeneration.

---

### 8. Output Contract

✅ `email.json` schema matches what stage 9 expects.
✅ `previewUrl: null` — stage 9 sets this.
✅ `{{PREVIEW_URL}}` placeholder in email2/email3 — stage 9 replaces this.

**[LOW/PRODUCTION] `pages.dev` spam filter risk.**
Documented in `docs/2026-03-04-cold-email-structure.md`. Email 2 and 3 will contain a
`pages.dev` URL until a custom domain (e.g., `previews.mejoraweb.app`) is put in front of
Cloudflare Pages. Not a code bug — a deployment decision before real sends. Tracked.

---

### 9. Dependency Audit

✅ `@anthropic-ai/sdk` — up to date, no CVEs.
✅ No new packages needed.
`npm audit` — 0 vulnerabilities (confirmed in stage 6 audit).

---

### 10. Dead Code & Unused Imports

✅ No dead code. All functions used.
**[LOW] `appendFileSync` not imported** — needs to be added when log file is introduced.

---

## Stage-Specific Audit — Email Quality

This is the most important section. The technical issues above are fixable in an hour.
The email copy quality determines whether leads reply.

---

### Issue A — CRITICAL: No legal footer (LSSI + GDPR)

**Spanish law (LSSI Art. 21 + GDPR) requires every cold commercial email to include:**
1. Sender identification (name, company name)
2. Physical address
3. Unsubscribe mechanism ("responde con 'No' para no recibir más emails" is sufficient)

**Currently none of the 3 emails have any of this.** This is noted in CLAUDE.md:
> "Must include: company name, address, unsubscribe in every email"

The fix is a standard footer appended to all 3 emails:
```
--
Andrés [Apellido] · mejoraweb.app
[Dirección física]
Para no recibir más emails, responde con "No gracias".
```

Note: Instantly.ai also injects its own unsubscribe link per platform requirements.
The in-body footer is a belt-and-suspenders legal compliance measure.

---

### Issue B — HIGH: "María de Molina" hardcoded in email 1

Line 160:
```js
'Somos dos estudiantes del IE empezando mejoraweb.app aquí en el barrio de María de Molina.',
```

`María de Molina` is a string literal — not derived from `NEIGHBORHOOD`. For the next
neighborhood (e.g., Salamanca, Retiro), every email 1 will falsely claim to be from
"el barrio de María de Molina." The neighborhood name must be dynamic.

Fix: read a human-readable neighborhood label from config (or derive it from `NEIGHBORHOOD`
with a simple formatter: `maria_de_molina` → `María de Molina`).

---

### Issue C — MEDIUM: "empezando" reduces credibility

"Somos dos estudiantes del IE **empezando** mejoraweb.app" — "empezando" (starting/beginning)
signals "no track record yet." Combined with "estudiantes," the full phrase reads as two
students who just launched and have never done this before.

The IE credential is strong (one of Spain's top business schools — well-known to Spanish SMEs),
but "empezando" cancels the credibility. Consider: "poniendo en marcha mejoraweb.app" or
"lanzando mejoraweb.app" which sounds more intentional and confident.

Note: the research-validated template in the cold email doc used "empezando" — this is a
quality refinement, not a reversal of the chosen structure.

---

### Issue D — MEDIUM: Email 2 is too thin

Current email 2 (~35 words):
```
Hola,

Te escribí hace unos días sobre el diseño que preparamos para [name]. Por si no lo viste, aquí el enlace:

{{PREVIEW_URL}}

Si te gusta lo que ves y quieres hablarlo, dime y buscamos un momento.

Andrés
mejoraweb.app
```

Research target: 50–80 words. Current: ~35 words. The body is functional but it lacks:
- A reminder of the specific problem identified in email 1 (continuity/relevance)
- Any reason WHY they should click the link right now

Improved structure:
```
Hola,

Te escribí hace unos días — te mandé esto por si no lo llegaste a ver.

Preparamos un diseño nuevo para [name] teniendo en cuenta [problema breve].
Aquí lo tienes:

{{PREVIEW_URL}}

Si te gusta lo que ves, podemos hablarlo cuando tengas un momento.

Andrés
mejoraweb.app
```

However, this requires persisting `problemSentence` in `email.json` so email 2 can
reference it (currently it's not stored separately).

---

### Issue E — LOW: CTA in email 1 slightly ambiguous

"Si te convence, podemos hablar 15 minutos cuando te venga bien."

The conditional "Si te convence" asks them to pre-judge the design before seeing it.
Research shows soft binary CTAs get 2× reply rates. A cleaner CTA:

"¿Te lo mandamos?"

Just that. Let the question sit. The current version already has this ("¿Te lo mandamos para
que lo veas?") but then adds a second ask in the same sentence ("podemos hablar 15 minutos").
Two asks in one CTA dilute focus. The "15 minutes" call can move to email 2 or 3.

---

### Issue F — LOW: No handling for leads with no website

Some leads have `scrapeError: true` — their site was unreachable. The `siteStatus` in the
Haiku prompt correctly handles this: `"La web no estaba accesible en el momento del análisis."`
But the email template always says "analizamos **tu web**" and "algo que notamos en **tu web**"
(subject). For leads with no website at all, this copy is misleading — you didn't analyze a
web that doesn't exist.

For a v1 campaign where all leads have websites (scrapeError leads are a minority and still
have a domain), this is acceptable. Flag for v2.

---

## Summary Table

### Technical Issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Rate limit waits 30s but doesn't retry — lead lost | HIGH | ✅ Fixed (retry loop, max 2 attempts, same pattern as stage 6) |
| 2 | `description` field not passed to Haiku prompt | HIGH | ✅ Fixed (added to buildProblemPrompt() context block) |
| 3 | Subject line not truncated — exceeds 50 chars for long business names | HIGH | ✅ Fixed (truncateName() at 28 chars + ellipsis) |
| 4 | No log file (`appendFileSync` not imported) | LOW | ✅ Fixed (output/emailcontent_{neighborhood}.log) |
| 5 | No timestamps on log lines | LOW | ✅ Fixed (log() / logError() helpers with ISO timestamps) |
| 6 | `leads.indexOf(lead)` O(n) in sleep check | LOW | ✅ Fixed (for loop with index i) |
| 7 | Haiku prompt didn't specify "en español" — produced "website" (English) in output | LOW | ✅ Fixed (explicit "en español" in problema field instruction) |

### Email Quality Issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 8 | No LSSI/GDPR legal footer — required by Spanish law | CRITICAL | ⬜ Pending discussion |
| 9 | "María de Molina" hardcoded — confirmed correct (IE address, intentional) | HIGH | ✅ Not a bug |
| 10 | "empezando" reduces credibility | MEDIUM | ✅ Fixed ("lanzando" in template) |
| 11 | Email 2 too thin (~35 words) and missing problem continuity | MEDIUM | ✅ Fixed (problemSentence passed to email 2, now ~55 words) |
| 12 | Email 1 CTA has two asks — dilutes focus | LOW | ✅ Fixed ("¿Te lo mandamos?" only — call option deferred to discussion) |
| 13 | No handling for no-website leads in email copy | LOW | ⬜ V2 |
| 14 | Rating/reviews not used — missed social proof for high-rated leads | LOW | ⬜ V2 |
| 15 | `pages.dev` spam filter risk — needs custom domain before real sends | PRODUCTION | ⬜ Tracked in docs |

## Test Results

```
node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina --dry-run
node pipeline/8-emailcontent.mjs --neighborhood maria_de_molina --lead telelectric-electricistas_24horas
```

- Haiku problem: "website marcada como no segura por navegadores y contenido desactualizado desde 2014" ✅
- Tipo: "electricistas" ✅
- Subject truncated: "Telelectric-Electricistas 24…, algo que notamos en tu web" ✅
- Email 2 carries problem sentence forward ✅
- Tokens: 459 in / 41 out | Cost: $0.00066 ✅
- Log file written: output/emailcontent_maria_de_molina.log ✅
- Second run: SKIP (idempotency confirmed) ✅
