// lovable-prompts.mjs — Generate Lovable-ready prompts for each target lead
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { mkdirSync } from 'fs';

const CONTENT_FILE = 'output/content/all_content.json';
const PROMPT_DIR = 'output/prompts';
const CURRENT_YEAR = new Date().getFullYear();

function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s_-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50)
    .replace(/_+$/, '');
}

function formatSections(sections) {
  if (!sections || sections.length === 0) return 'No structured content could be extracted from the current site.';
  return sections
    .filter(s => s.heading || s.content)
    .map(s => {
      let text = '';
      if (s.heading) text += `### ${s.heading}\n`;
      if (s.content) text += s.content;
      return text;
    })
    .join('\n\n');
}

function buildPrompt(lead) {
  const phone = lead.phone || lead.contactInfo?.phones?.[0] || '[PHONE]';
  const emails = lead.contactInfo?.emails || [];
  const primaryColor = lead.colors?.headerBg || lead.colors?.linkColor || '#2563eb';
  const hasLogo = lead.logoUrl ? 'Use the attached logo image' : 'Use the business name as text logo in bold sans-serif';
  const sectionsText = formatSections(lead.sections);
  const footerInfo = lead.footerText ? `\nFooter content from current site:\n${lead.footerText.substring(0, 500)}` : '';

  return `Build a modern, mobile-responsive single-page website for a local Spanish business.

Business: ${lead.name}
Type: ${lead.category || 'Local business'}
Location: ${lead.full_address || 'Madrid, Spain'}
Phone: ${phone}
${emails.length > 0 ? `Email: ${emails[0]}` : ''}

Website content to use (extracted from their current site):

${sectionsText}
${footerInfo}

Design requirements:
- Mobile-first, responsive design
- Modern and clean aesthetic (think Linear, Stripe, Vercel style)
- Colors: use ${primaryColor} as primary, white as background, dark gray for text
- Include hero section with business name and a prominent call-to-action button ("Llámanos" linking to tel:${phone})
- Include services/menu section using the content above
- Include an "About" or "Quiénes somos" section
- Include contact section with address, phone${emails.length > 0 ? ', email' : ''}, and embedded Google Maps placeholder
- Include footer with copyright © ${CURRENT_YEAR} ${lead.name}
- Spanish language throughout
- Fast loading, minimal dependencies
- SEO optimized: proper meta tags, semantic HTML, Open Graph tags
- Smooth scroll navigation between sections
- Subtle animations on scroll (fade-in)
- WhatsApp floating button linking to https://wa.me/34${phone.replace(/[^0-9]/g, '').replace(/^34/, '')}

Logo: ${hasLogo}

Rating: ${lead.rating ? `${lead.rating} stars (${lead.reviews} reviews on Google) — consider showing this as social proof` : 'No Google rating available'}

IMPORTANT: This must include <meta name="viewport" content="width=device-width, initial-scale=1"> and use HTTPS-ready assets only. All images should use placeholder services (like unsplash or placeholder.co) since we don't have the original assets.
`;
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(CONTENT_FILE)) {
    console.error(`[ERROR] Content file not found: ${CONTENT_FILE}. Run scrape-content.mjs first.`);
    process.exit(1);
  }

  mkdirSync(PROMPT_DIR, { recursive: true });

  const allContent = JSON.parse(readFileSync(CONTENT_FILE, 'utf-8'));
  console.log(`[PROMPTS] Generating Lovable prompts for ${allContent.length} leads`);

  let generated = 0;
  for (const lead of allContent) {
    const safeName = sanitizeName(lead.name);
    const prompt = buildPrompt(lead);
    const promptPath = `${PROMPT_DIR}/${safeName}_lovable_prompt.txt`;
    writeFileSync(promptPath, prompt);
    generated++;
    console.log(`[${generated}/${allContent.length}] ✓ ${lead.name} → ${promptPath}`);
  }

  // Also write a master index
  const index = allContent.map(lead => ({
    name: lead.name,
    tier: lead.tier,
    score: lead.score,
    category: lead.category,
    promptFile: `${sanitizeName(lead.name)}_lovable_prompt.txt`,
  }));
  writeFileSync(`${PROMPT_DIR}/index.json`, JSON.stringify(index, null, 2));

  console.log('\n═══════════════════════════════════════════');
  console.log('  LOVABLE PROMPTS COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Prompts generated:  ${generated}`);
  console.log(`  Output:             ${PROMPT_DIR}/`);
  console.log(`  Index:              ${PROMPT_DIR}/index.json`);
  console.log('═══════════════════════════════════════════');
}

main();
