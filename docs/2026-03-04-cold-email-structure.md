# Cold Email Structure — Research & Decision Log
Date: 2026-03-04

## Decision Summary
- **Selected structure:** PAS (Problem → Agitate → Solution) — Structure A
- **Link in email 1:** NO. Link goes in email 2 only.
- **Sequence:** 3 emails (Day 0, Day 4, Day 12)
- **Stage 8 approach:** Fixed template + Haiku generates only the problem sentence per lead

---

## Research Findings

### Subject Line
| What works | What to avoid |
|---|---|
| 2–4 words, lowercase, conversational | Long benefit headlines |
| Question format or curiosity gap | "gratis", "free", "oferta" (spam triggers) |
| Business name in subject | ALL CAPS, emoji clusters |
| Under 50 characters | 9+ words |

**Formula used:** `[NOMBRE_NEGOCIO], algo que notamos en tu web`

### Body
| Factor | Finding |
|---|---|
| Ideal length | 80–120 words. Under 100 words = 51% more replies vs. over 200 |
| Opening line | Must be about them, specific — earns the rest of the read |
| CTA | Soft binary question. 2x reply rate vs. hard ask |
| Plain text | ~2x better reply rate than HTML |
| Reading level | 5th–7th grade → +53% response rate |

### Personalize vs. Template
- **Personalize (per lead):** problem sentence, business name/type
- **Template (fixed):** IE intro, offer description, CTA, signature

### Reply Rate Benchmarks
| Metric | Data |
|---|---|
| Average B2B cold reply rate | 3.43% (Instantly 2026 Benchmark, 700k+ businesses) |
| Elite performers | >10% reply rate, emails under 80 words |
| 58% of replies | Come from email 1 |
| Follow-up (day 4) | +65.8% more replies vs. stopping after email 1 |
| Soft CTA vs. hard ask | 2x reply rate |
| Under 100 words vs. over 200 | +51% more replies |
| 4–7 email sequence vs. 1–3 | 27% vs. 9% reply rate (3x) |

**Realistic target for Spanish SME, created-demand offer:** 2–5% positive reply rate.
With high-personalization opener + mockup as proof-of-effort: target 3–7% total replies.

---

## Critical Finding: Do NOT put the link in email 1

### Deliverability
Links in cold email body are treated as phishing signals by Gmail and Outlook.
Plain text emails outperform HTML by ~2x in reply rates.
A reply to email 1 creates a trust signal — email 2 (with the link, in-thread) inherits it.

### `pages.dev` is actively flagged by spam classifiers
This is specific to our Cloudflare Pages setup:
- 2023: 460 phishing incidents on `pages.dev`
- 2024: 1,370 phishing incidents on `pages.dev` — tripled year-over-year
- Gmail/Outlook have trained classifiers specifically on `pages.dev` URLs from unknown senders
- Source: Fortra threat intelligence, February 2026

**Action required (stage 9):** Consider adding a custom domain in front of Cloudflare Pages
(e.g., `previews.mejoraweb.app`) to avoid the `pages.dev` spam classification.
This is a known issue to solve before going to production with real sends.

### The "ask first" advantage
- Creates a micro-commitment ("yes, send it to me")
- The prospect clicks the link with intent — not as a cold URL
- Reply to email 1 = micro-conversion that warms the thread for email 2

---

## 3-Email Sequence

| Email | Day | Goal | Length | Link? |
|---|---|---|---|---|
| Email 1 | 0 | Get a reply | 80–120 words | NO |
| Email 2 | 4 | Deliver mockup | 50–80 words | YES |
| Email 3 | 12 | Break-up | 30–50 words | YES |

---

## The 3 Structures Evaluated

### Structure A — PAS (SELECTED)
*Problem → Agitate → Solution. Alex Hormozi / Salesforge / close.com.*
Makes the reader feel the cost of inaction before offering relief.

```
SUBJECT: [NOMBRE_NEGOCIO], algo que notamos en tu web

Hola,

Somos dos estudiantes del IE empezando mejoraweb.app aquí
en el barrio de María de Molina.

Antes de escribirte, analizamos tu web: [PROBLEMA_ESPECIFICO].
Eso se traduce en clientes que buscan [TIPO_NEGOCIO] en la
zona y que no llegan a encontrarte.

Ya preparamos un diseño nuevo de [NOMBRE_NEGOCIO] teniendo
esto en cuenta. ¿Te lo mandamos para que lo veas? Si te
convence, podemos hablar 15 minutos cuando te venga bien.

Un saludo,
Andrés
mejoraweb.app

~ 95 palabras
```

**Personalized slots:** `[NOMBRE_NEGOCIO]` × 2, `[PROBLEMA_ESPECIFICO]`, `[TIPO_NEGOCIO]`

---

### Structure B — AIDA
*Attention → Interest → Desire → Action. Reply.io / Lemlist / Jake Jorgovan.*
Builds logically — earns attention before making the ask. Requires rating/reviews data.

```
SUBJECT: [NOMBRE_NEGOCIO], ¿tienes un minuto?

Hola,

Somos Andrés y un compañero del IE, arrancando mejoraweb.app
desde el barrio de María de Molina.

Estudiamos tu web y notamos: [PROBLEMA_ESPECIFICO]. Con
[RATING] estrellas y [NUM_REVIEWS] reseñas, tienes un negocio
que funciona — la web debería ayudarte a conseguir más clientes,
no quedarse atrás.

Preparamos un mockup de cómo quedaría renovada. Sin compromiso.

¿Te lo mandamos? Si te interesa, encantados de hablar un momento.

Andrés
mejoraweb.app

~ 90 palabras
```

**Personalized slots:** `[NOMBRE_NEGOCIO]`, `[PROBLEMA_ESPECIFICO]`, `[RATING]`, `[NUM_REVIEWS]`
*Note: if rating/reviews empty, drop the middle sentence.*

---

### Structure C — Proof First
*Show the work, then ask. Woodpecker / Dribbble freelance guide.*
Opening with completed work bypasses the convince-me-to-care phase.

```
SUBJECT: Tu web nueva — [NOMBRE_NEGOCIO]

Hola,

Somos dos estudiantes del IE poniendo en marcha mejoraweb.app
aquí en María de Molina. Nuestra forma de trabajar: antes de
contactar a un negocio, preparamos un diseño real de cómo
mejoraría su web.

El de [NOMBRE_NEGOCIO] ya está listo.

Lo diseñamos teniendo en cuenta que [PROBLEMA_ESPECIFICO].

¿Te lo mandamos para verlo? Si te gusta, podemos hablar
15 minutos para contarte cómo funciona.

Un saludo,
Andrés
mejoraweb.app

~ 95 palabras
```

**Personalized slots:** `[NOMBRE_NEGOCIO]` × 2, `[PROBLEMA_ESPECIFICO]`

---

## Comparison

| | A — PAS | B — AIDA | C — Proof First |
|---|---|---|---|
| **Opens with** | Us (brief) | Us (brief) | Our process |
| **Problem placement** | Early, amplified | Middle, with social proof | Late, after the reveal |
| **Tone** | Direct, analytical | Warmer, data-backed | Confident, action-oriented |
| **Risk** | "Agitate" can feel presumptuous | Needs rating/reviews data | Bolder subject line |
| **Best for** | Leads with clear measurable problems | Leads with good Google ratings | All leads, any data quality |

---

## A/B Testing Plan
Each structure can be used per neighborhood to compare reply rates:
- María de Molina v2 → Structure A (PAS)
- Next neighborhood → Structure B or C
- Track: reply rate, positive reply rate, mockup link click rate

Sources:
- Instantly 2026 Benchmark Report (700k+ businesses)
- Woodpecker outreach sequence best practices 2025
- Fortra threat intelligence (pages.dev phishing 2024)
- Salesforge / Gong CTA research
- Lemlist web design cold email templates
- Reply.io email format guide
