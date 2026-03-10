# MejoraWeb — Design Prompt Guide
# UI/UX Principles & Technical Standards for HTML Mockups
#
# HOW TO USE THIS FILE
# This guide sets the quality floor and creative principles.
# The per-lead design_prompt.md that follows sets the business-specific
# requirements: colors, fonts, content, and industry feel.
#
# Your job: use both together, plus your own creative judgment.
# Every mockup must look like it was designed specifically for that
# business — not like a template with swapped colors.
# An architecture firm and a law firm both need formal sites, but
# they must look completely different. A trades company and a
# restaurant both need energy, but through opposite aesthetics.
#
# These are the standards every mockup must meet.
# How you meet them is up to you.

---

## PART A — DESIGN PHILOSOPHY

### What makes a great local business website

A great mockup does one thing: makes the business owner think
"I want this for my business." Not "this looks like a website."

The difference is **specificity**. Generic sites have:
- Stock-looking layouts anyone could buy for €20
- Colors that match the logo but not the personality
- Headlines that could belong to any company in the industry
- Cards and grids that feel like a template

Specific sites have:
- A visual personality that matches how the business feels in person
- A headline only this company could have
- Design choices that reinforce the brand story
- Sections that clearly grew from the actual business content

Use every piece of data from the per-lead prompt — the real services,
the real certifications, the real Google rating, the actual brand color —
to make decisions that no other business would share.

---

## PART B — DESIGN PRINCIPLES

### 1. Visual Hierarchy

Every page has one job: guide the visitor's eye in the right sequence.
Control this through size, weight, color, contrast, and whitespace.

- **One dominant element per section.** The hero headline owns the hero.
  The section H2 owns its section. Never let two elements compete equally.
- **Size signals importance.** The most important thing should be visually
  largest. If the phone number matters most, make it large.
- **Weight before color.** A bold 400px headline needs no color.
  Color is for accents and CTAs, not for establishing hierarchy.
- **Contrast draws the eye first.** The primary CTA button must stand
  out more than anything near it. If it doesn't, redesign the button or
  the surrounding area — not the other way around.

### 2. Whitespace

Whitespace is not empty space — it is a design element.
Amateur sites cram content together. Professional sites breathe.

- **Between sections:** generous vertical space (80px desktop / 48px mobile).
  Sections that feel cramped feel low-budget.
- **Within sections:** give headings room to breathe above and below.
  A heading that touches the content above it loses authority.
- **Around CTAs:** a button surrounded by negative space converts better
  than a button buried in content.
- **Text columns:** body paragraphs max 65 characters wide. Lines longer
  than this cause reading fatigue, regardless of font size.
- **Cards:** internal padding should feel generous. 32px internal padding
  on a card feels premium. 12px feels like a data table.

### 3. Color Discipline

The per-lead prompt gives you the primary color. Use it as a tool, not paint.

- **60 / 30 / 10 rule:** 60% neutral backgrounds, 30% primary (headings,
  accents, icons), 10% high-contrast CTA moments.
- **One dominant CTA color.** The primary button color should appear on
  only one or two elements per section. If everything is the primary
  color, nothing stands out.
- **Background rhythm:** alternate sections between white and a very subtle
  off-white or light tint. Never the same background for 3 sections in a row.
  Never use the primary color as a section background for more than one section.
- **Dark sections sparingly.** One dark section per page maximum (usually the
  footer, occasionally a hero). Full-dark pages feel heavy and don't convert.
- **Text colors:** never pure black (#000000). Use near-black (#18181b) for
  primary text, mid-grey (#52525b) for secondary, light-grey (#a1a1aa) for
  captions. This creates depth without harsh contrast.

### 4. Typography as Personality

The fonts in the per-lead prompt were chosen for the industry. Use them
with intention — different weights and sizes carry different emotional weight.

- **Headings are your voice.** Large, bold headings set the personality.
  A trades company heading should feel strong and direct — tight leading,
  condensed weight, no softness. A wellness center heading should feel
  calm — generous spacing, lighter weight.
- **The eyebrow label above H2s.** Small, uppercase, spaced, primary color.
  This pattern (eyebrow → H2 → lead text) creates a visual intro sequence
  that draws the eye correctly every time. Use it on every content section.
- **Fluid sizing.** H1 must use `clamp()` — never a fixed px H1 that
  looks wrong at some viewport width. Minimum H1: `clamp(2rem, 5vw, 4.5rem)`.
- **Leading.** Body text: 1.6–1.7. Headings: 1.0–1.2. Tighter leading on
  large headlines (especially condensed fonts) feels intentional and modern.
- **Letter-spacing.** Uppercase labels and eyebrows: `0.08–0.12em`. Large
  headings (especially display sizes): `-0.01 to -0.02em` (slightly tight).
  Body text: 0 (never add letter-spacing to body copy).

### 5. Section Flow and Narrative

A page tells a story. Each section is a chapter. The sequence should feel
inevitable — each section answers the question raised by the previous one.

Standard narrative arc for local service businesses:
1. **Hero** — "Who are you and what do you do?" (attention + value prop)
2. **Trust bar** — "Why should I believe you?" (social proof, fast)
3. **Services** — "What specifically do you offer?" (clarity)
4. **About** — "Who is behind this?" (credibility + connection)
5. **Testimonials** (if available) — "What do others say?" (validation)
6. **Contact** — "How do I start?" (conversion)

Avoid interrupting this arc. Don't put contact above services. Don't bury
testimonials after the contact form. The visitor's trust increases
incrementally — don't ask for conversion before you've earned it.

### 6. Personality Per Industry

Use the industry context to make creative decisions. These are directions,
not rules — push them as far as the content supports:

- **Architecture / design firms:** Asymmetric layouts, large whitespace,
  editorial typography, minimal color, strong black-and-white contrast.
  Think portfolio, not brochure.
- **Law / finance / consulting:** Authority through restraint. Dark navies,
  charcoals, conservative spacing. Typography that feels like a published book.
  No decoration that doesn't serve a purpose.
- **Healthcare / dental / therapy:** Warmth and cleanliness simultaneously.
  Generous padding, friendly rounded shapes, blues and greens. Never cold,
  never clinical. Think "caring professional."
- **Trades / construction / electrical:** Confidence and reliability.
  Bold headlines, strong color blocks, very clear CTAs. The customer is
  stressed (emergency repair) — make it obvious how to reach them.
- **Restaurants / food:** Sensory and warm. Rich background textures or
  color, generous imagery treatment, warm typography. Everything should
  make the visitor feel hungry or comfortable.
- **Wellness / beauty / spa:** Calm, elevated, unhurried. Soft gradients,
  generous whitespace, elegant thin weights, muted accents. Nothing loud.
- **Technology / software:** Modern, confident, somewhat minimal. Can use
  dark sections effectively. Geometric, precise, systematic.
- **Real estate:** Premium and aspirational. Photography-forward where
  possible, editorial layouts, confident typography.

---

## PART C — TECHNICAL STANDARDS

These are non-negotiable. Every mockup must meet every item below.

### CSS Design System

Define every design value as a CSS custom property before using it anywhere.
Never hardcode a hex color, px spacing value, or shadow definition in a rule.

```css
:root {
  /* Brand — fill from per-lead design decisions */
  --color-primary:       /* from per-lead prompt */;
  --color-primary-dark:  /* 15% darker, for hover */;
  --color-primary-light: /* 15% lighter, for tints */;
  --color-secondary:     /* complementary accent — your judgment */;

  /* Neutrals — always define the full scale */
  --color-neutral-50:  #fafafa;
  --color-neutral-100: #f4f4f5;
  --color-neutral-200: #e4e4e7;
  --color-neutral-300: #d4d4d8;
  --color-neutral-400: #a1a1aa;
  --color-neutral-500: #71717a;
  --color-neutral-600: #52525b;
  --color-neutral-700: #3f3f46;
  --color-neutral-800: #27272a;
  --color-neutral-900: #18181b;

  /* Surfaces */
  --color-bg:         #fafafa;   /* NEVER #ffffff for large backgrounds */
  --color-bg-subtle:  #f4f4f5;
  --color-border:     #e4e4e7;

  /* Spacing — 8pt grid. Only use these values. */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;
  --space-4: 16px;  --space-5: 20px;  --space-6: 24px;
  --space-8: 32px;  --space-10: 40px; --space-12: 48px;
  --space-16: 64px; --space-20: 80px; --space-24: 96px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.04);

  /* Transitions */
  --transition-fast: all 0.1s ease;
  --transition-base: all 0.15s ease;
  --transition-slow: all 0.3s ease;

  /* Border radius — choose a set that fits the industry, define once */
  /* Sharp (4–6px): trades, legal, finance, luxury */
  /* Soft (8–12px): tech, healthcare, food, education */
  /* Round (12–16px): wellness, beauty, consumer */
  --radius-sm: ;
  --radius-md: ;
  --radius-lg: ;
  --radius-full: 9999px;
}
```

### Font Loading

Always use this exact pattern. The `display=swap` prevents FOUT.
Specify only the weights listed in the per-lead typography section.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=HEADING_FONT:wght@WEIGHTS&family=BODY_FONT:wght@WEIGHTS&display=swap" rel="stylesheet">
```

Apply with system-font fallbacks:
```css
body        { font-family: 'Body Font', system-ui, sans-serif; }
h1,h2,h3,h4 { font-family: 'Heading Font', system-ui, sans-serif; }
```

### Spacing and Layout

- **8pt grid only.** Every margin, padding, and gap must be a multiple of 4 or 8.
  Never use 13px, 17px, 22px, or any value not in the spacing scale above.
- **Max content width:** 1280–1400px. Full-bleed backgrounds (color bands,
  hero backgrounds) can be 100vw. Content inside is always constrained.
- **Section vertical rhythm:** 80px top/bottom on desktop, 48px on mobile.
  Consistency here makes the whole page feel intentional.
- **Mobile-first:** write base styles for mobile, scale up with `min-width`.
  Breakpoints: 640px · 768px · 1024px · 1280px.

### Typography Scale

```css
h1 { font-size: clamp(2rem, 5vw, 4.5rem);   line-height: 1.1;  letter-spacing: -0.02em; }
h2 { font-size: clamp(1.75rem, 3.5vw, 2.5rem); line-height: 1.15; letter-spacing: -0.01em; }
h3 { font-size: 1.25rem;  line-height: 1.3; }
p  { font-size: 1rem;     line-height: 1.65; max-width: 65ch; color: var(--color-neutral-700); }

/* Eyebrow labels above section headings */
.eyebrow {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-primary);
}
```

Every content section starts with: eyebrow → H2 → optional lead sentence.

### Responsive Images

When using real images from the per-lead prompt:
```html
<img src="[url]" alt="[descriptive text]" width="800" height="600" loading="lazy">
```
Hero images: remove `loading="lazy"` (above the fold).

When no real image is available: use CSS shapes, SVG patterns, or gradients.
**Never use placeholder image services** (Unsplash, Lorem Picsum, etc.).

---

## PART D — SECTION STANDARDS

### Navigation

**Must have:** logo (left) + nav links + one primary CTA button (right) + mobile hamburger.

Sticky behavior: `position: sticky; top: 0;` with `backdrop-filter: blur` and a
border-bottom that appears on scroll (add a `.scrolled` class via JS).

Mobile: hamburger triggers a slide-in drawer or full overlay. Never `display:none` toggle.
Touch targets: minimum 44×44px on all interactive elements.

First element in `<body>`: a skip-to-main link (visible on focus only):
```html
<a href="#main" class="skip-link">Ir al contenido principal</a>
```
```css
.skip-link { position:absolute; top:-100%; left:1rem; padding:.5rem 1rem;
  background:var(--color-primary); color:white; font-weight:600; z-index:9999; }
.skip-link:focus { top:1rem; }
```

### Hero

**Must achieve:** immediately communicate the value proposition + make the
primary CTA impossible to miss.

**Required elements (execution is your creative choice):**
- Eyebrow label (category or tagline)
- H1: strong value proposition, 6–10 words, Spanish
- Subheadline: one sentence, expands the H1
- Primary CTA button (above the fold, high contrast)
- Trust signal near the CTA (Google rating, years in business, certification)
- Visual element on the right side on desktop (from per-lead prompt or your design)

The visual element direction is specified per-lead. On mobile, the visual
typically stacks below or becomes a background — use your judgment.

### Trust Bar

**Must achieve:** confirm credibility in 3 seconds without requiring reading.

Between the hero and the first content section. 3–4 items with icons.
Use only facts from the per-lead content (Google rating, hours, years,
certifications). Light background tint.

### Services Section

**Must achieve:** the visitor can immediately understand what's offered
and whether it matches their need.

Use the specific services from the per-lead content — not invented generic ones.
3–6 items. Each needs a name, a short description, and a visual element (icon or graphic).

Layout is your creative choice: cards, horizontal rows, large feature blocks,
a grid of tiles — choose what fits the industry personality.
Trades: bold clear cards. Law: horizontal rows with icon. Architecture: full-width
editorial-style blocks.

### About / Why Us

**Must achieve:** build personal connection and specific credibility.

Use the business's own words from the per-lead content. 2–4 differentiators
that are specific to this company (not generic like "quality" or "experience").
If certifications, license numbers, or associations are in the content — use them.
These are the highest-credibility signals for trades and professional services.

### Testimonials

**Must achieve:** social proof that feels real, not placeholder.

Use only real testimonials from the per-lead content. If none available, omit
the section entirely — do not invent quotes. Quote cards with quotation mark,
full text, and attribution.

### Contact Section

**Must achieve:** make it trivially easy to reach the business.

**Required on desktop:** two-column layout — contact information on the left,
lead form on the right. On mobile, stack vertically (info first, form second).

The phone number is the most important CTA on the page. It must be:
- Large (H2-level or larger)
- A clickable `tel:` link
- Visible without scrolling to the bottom

The form: name + phone or email + message. No more than 4 fields.
Every input has an associated `<label>` (never use placeholder as label).
Input font-size minimum 16px (prevents iOS Safari auto-zoom).
Submit button: use an action phrase — "Solicitar Presupuesto Gratis", "Enviar Consulta".

### Footer

**Must have:** logo + brand tagline, navigation columns (grouped by topic),
full contact info (phone, address, hours), social links if available,
legal row (© year + business name + Política de Privacidad).

Dark footer (neutral-900) works for most categories. A light footer works
for wellness, beauty, and similar. Match the page's overall tone.

---

## PART E — INTERACTION & ANIMATION

### Principles

Animations serve communication — they draw attention to what matters,
confirm interactions, and make transitions feel smooth. They must never
be decorative noise.

**Scroll-triggered entrance:** sections and cards should fade up as they
enter the viewport. Use IntersectionObserver — not scroll events.
```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }});
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('[data-animate]').forEach(el => observer.observe(el));
```
Pattern: `opacity: 0; transform: translateY(20px)` → `opacity: 1; transform: none`.
Duration: 350–450ms. Stagger children by 80–100ms.

**Hover states:** every interactive element must have a visible hover state.
Cards: `translateY(-4px)` + stronger shadow. Buttons: darken + subtle lift.
Nav links: underline slide-in or color shift.

**Only animate `transform` and `opacity`** — never `width`, `height`, `top`, `left`,
`margin`, or `padding`. Those cause layout reflow and produce jank.

**Reduced motion:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

---

## PART F — ACCESSIBILITY BASELINE

These are non-negotiable minimums.

**Focus indicator:** never remove without replacement.
```css
:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: 2px;
}
:focus:not(:focus-visible) { outline: none; }
```

**External links:** all links opening in a new tab:
```html
<a href="..." target="_blank" rel="noopener noreferrer">...</a>
```

**Semantic HTML:** use correct elements.
- `<button>` for actions, `<a href>` for navigation
- `<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`
- ONE `<h1>` per page (the hero headline)
- Never skip heading levels (H1 → H3 without H2)
- All images have descriptive `alt` text. Decorative images: `alt=""`

**Forms:** every `<input>` and `<textarea>` has an associated `<label for="...">`.
Required fields marked with `*` and `aria-required="true"`.

**Touch targets:** 44×44px minimum on all buttons, links, and icons.

**JSON-LD:** LocalBusiness schema in `<head>` with name, phone, address, openingHours.

---

## PART G — HTML HEAD REQUIREMENTS

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>[Primary service] en [City] — [Business name]</title>
  <meta name="description" content="[150-160 chars: service + city + key differentiator + CTA]">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="[fonts-url-with-display=swap]" rel="stylesheet">
  <script type="application/ld+json">{ LocalBusiness schema }</script>
  <style>/* all CSS */</style>
</head>
<body>
  <a href="#main" class="skip-link">Ir al contenido principal</a>
  <header>...</header>
  <main id="main">...</main>
  <footer>...</footer>
  <script>/* all JS */</script>
</body>
</html>
```

---

## PART H — NEVER DO

### Design violations
- `#000000` for text — use `var(--color-neutral-900)` (#18181b)
- `#ffffff` for large section backgrounds — use `#fafafa`
- More than 2 Google Fonts
- Full dark background for the entire page
- Emoji icons in service cards or CTAs — use inline SVG
- Fake statistics without data from the per-lead content
  ("500+ proyectos", "100% satisfacción", "Miles de clientes")
- Body text below 16px
- Justified text alignment
- Arbitrary spacing (13px, 17px, 22px) — 8pt grid only
- Two equally weighted CTAs competing in the same section

### Technical violations
- External CSS files or JS libraries — everything embedded in the HTML
- Placeholder image services (Unsplash, Lorem Picsum, placeholder.com)
- `<div onclick>` instead of `<button>` for actions
- Placeholder text as the only form label (always use `<label>`)
- `outline: none` without a replacement focus indicator
- Animating `width`, `height`, `top`, `left` — transform + opacity only
- External links without `rel="noopener noreferrer"`
- Multiple `<h1>` tags on one page
- Skipping heading levels (H1 → H3)

### Content violations
- Inventing facts about the business — use only the per-lead content
- Generic service descriptions ("ofrecemos calidad y experiencia")
  — use the specific services and language from the per-lead content
- English text anywhere in the page (labels, aria-labels, button text,
  placeholders, error messages — all in Spanish)
- Copy-pasting the same layout for every business — every mockup must
  feel designed for this specific company
