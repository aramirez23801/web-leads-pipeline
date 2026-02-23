// postcards.mjs — Generate printable A5 postcard PDFs for Tier 1 leads
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import XLSX from 'xlsx';

const MANIFEST_FILE = 'output/screenshots/manifest.json';
const INPUT_FILE = 'output/leads_audited.xlsx';
const POSTCARD_DIR = 'output/postcards';

// A5 in points (1mm = 2.835pt)
const A5_WIDTH = 148 * 2.835;  // ~419.6pt
const A5_HEIGHT = 210 * 2.835; // ~595.4pt

const MARGIN = 28;
const CONTENT_WIDTH = A5_WIDTH - MARGIN * 2;

// ── Helpers ─────────────────────────────────────────────────────────────────
function translatePitch(pitch) {
  // Simple key phrase translations for common English patterns
  const translations = [
    [/not mobile-responsive \(penalized by Google\)/gi, 'no es responsive en móvil (penalizada por Google)'],
    [/marked as "Not Secure" by browsers \(losing trust\)/gi, 'marcada como "No segura" por los navegadores (pierde confianza)'],
    [/site content outdated since (\d{4})/gi, 'contenido desactualizado desde $1'],
    [/built with obsolete technology from 10\+ years ago/gi, 'construida con tecnología obsoleta de hace más de 10 años'],
    [/Website has (\d+) technical issues?:/gi, 'Tu web tiene $1 problemas técnicos:'],
    [/Website is completely down\/dead\. Needs a new website immediately\./gi, 'Tu web está caída/muerta. Necesita una nueva web urgentemente.'],
    [/Website is extremely slow\/broken\. Losing customers to load times\./gi, 'Tu web es extremadamente lenta. Pierdes clientes por los tiempos de carga.'],
  ];
  let text = pitch;
  for (const [pattern, replacement] of translations) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Load manifest
  if (!existsSync(MANIFEST_FILE)) {
    console.error(`[ERROR] Manifest not found: ${MANIFEST_FILE}. Run screenshot.mjs first.`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'));

  // Load lead data for pitch angles
  const wb = XLSX.readFile(INPUT_FILE);
  const allLeads = XLSX.utils.sheet_to_json(wb.Sheets['All Leads']);
  const leadMap = new Map();
  for (const lead of allLeads) {
    leadMap.set(lead.name, lead);
  }

  // Filter to Tier 1 only for postcards
  const tier1Entries = manifest.filter(e => e.tier === 'Tier 1');
  console.log(`[POSTCARDS] Generating ${tier1Entries.length} postcards for Tier 1 leads`);

  const combinedPdf = await PDFDocument.create();
  let generated = 0;

  for (const entry of tier1Entries) {
    try {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([A5_WIDTH, A5_HEIGHT]);
      const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);

      let y = A5_HEIGHT - MARGIN;

      // ── Header ──
      const headerText = '¿Tu web se ve así en el móvil?';
      page.drawText(headerText, {
        x: MARGIN,
        y: y,
        size: 17,
        font: helveticaBold,
        color: rgb(0.13, 0.13, 0.13),
      });
      y -= 24;

      // ── Business name ──
      page.drawText(entry.name, {
        x: MARGIN,
        y: y,
        size: 10,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= 18;

      // ── Mobile screenshot ──
      const mobileImgPath = entry.mobilePath;
      if (existsSync(mobileImgPath)) {
        const imgBytes = readFileSync(mobileImgPath);
        const pngImage = await pdf.embedPng(imgBytes);
        const imgWidth = 130;
        const imgHeight = (pngImage.height / pngImage.width) * imgWidth;
        const cappedHeight = Math.min(imgHeight, 200);
        const imgX = (A5_WIDTH - imgWidth) / 2;
        page.drawImage(pngImage, {
          x: imgX,
          y: y - cappedHeight,
          width: imgWidth,
          height: cappedHeight,
        });
        y -= cappedHeight + 6;
      } else {
        // Placeholder rect
        page.drawRectangle({
          x: (A5_WIDTH - 130) / 2,
          y: y - 200,
          width: 130,
          height: 200,
          color: rgb(0.9, 0.9, 0.9),
        });
        page.drawText('Captura no disponible', {
          x: (A5_WIDTH - 130) / 2 + 10,
          y: y - 105,
          size: 8,
          font: helvetica,
          color: rgb(0.5, 0.5, 0.5),
        });
        y -= 206;
      }

      // ── Caption under mobile screenshot ──
      page.drawText('Tu sitio actual en móvil', {
        x: MARGIN,
        y: y,
        size: 9,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 20;

      // ── "After" section ──
      page.drawText('Así podría verse >', {
        x: MARGIN,
        y: y,
        size: 13,
        font: helveticaBold,
        color: rgb(0.13, 0.55, 0.33),
      });
      y -= 16;

      // Mockup placeholder
      page.drawRectangle({
        x: (A5_WIDTH - 130) / 2,
        y: y - 120,
        width: 130,
        height: 120,
        color: rgb(0.93, 0.97, 0.95),
        borderColor: rgb(0.13, 0.55, 0.33),
        borderWidth: 1.5,
      });
      page.drawText('MOCKUP', {
        x: (A5_WIDTH - 130) / 2 + 38,
        y: y - 55,
        size: 14,
        font: helveticaBold,
        color: rgb(0.13, 0.55, 0.33),
      });
      page.drawText('(reemplazar con diseño)', {
        x: (A5_WIDTH - 130) / 2 + 10,
        y: y - 72,
        size: 8,
        font: helvetica,
        color: rgb(0.4, 0.6, 0.4),
      });
      y -= 130;

      // ── Divider line ──
      y -= 8;
      page.drawLine({
        start: { x: MARGIN, y: y },
        end: { x: A5_WIDTH - MARGIN, y: y },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 14;

      // ── Pitch text ──
      const lead = leadMap.get(entry.name);
      const pitch = lead ? translatePitch(lead.pitch_angle) : '';
      if (pitch) {
        const pitchLines = wrapText(pitch, helvetica, 9, CONTENT_WIDTH);
        for (const line of pitchLines.slice(0, 4)) {
          page.drawText(line, {
            x: MARGIN,
            y: y,
            size: 9,
            font: helvetica,
            color: rgb(0.25, 0.25, 0.25),
          });
          y -= 13;
        }
      }
      y -= 4;

      // ── CTA ──
      const ctaText = 'Lo arreglo en 48 horas. €299 + IVA.';
      page.drawText(ctaText, {
        x: MARGIN,
        y: y,
        size: 11,
        font: helveticaBold,
        color: rgb(0.13, 0.13, 0.13),
      });
      y -= 16;

      page.drawText('Llámame: [TU TELÉFONO]', {
        x: MARGIN,
        y: y,
        size: 10,
        font: helveticaBold,
        color: rgb(0.13, 0.55, 0.33),
      });
      y -= 18;

      // ── Footer ──
      page.drawText('Kevin León — Diseño Web Profesional', {
        x: MARGIN,
        y: Math.max(y, MARGIN),
        size: 9,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });

      // Save individual PDF
      const pdfBytes = await pdf.save();
      const pdfPath = `${POSTCARD_DIR}/${entry.safeName}_postcard.pdf`;
      writeFileSync(pdfPath, pdfBytes);

      // Add to combined PDF
      const [copiedPage] = await combinedPdf.copyPages(pdf, [0]);
      combinedPdf.addPage(copiedPage);

      generated++;
      console.log(`[${generated}/${tier1Entries.length}] ✓ ${entry.name} > ${pdfPath}`);
    } catch (err) {
      console.error(`[${generated + 1}/${tier1Entries.length}] ✗ ${entry.name} — ERROR: ${err.message}`);
      generated++;
    }
  }

  // Save combined PDF
  const combinedBytes = await combinedPdf.save();
  const combinedPath = `${POSTCARD_DIR}/all_postcards.pdf`;
  writeFileSync(combinedPath, combinedBytes);

  console.log('\n═══════════════════════════════════════════');
  console.log('  POSTCARDS COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Postcards generated: ${generated}`);
  console.log(`  Individual PDFs:     ${POSTCARD_DIR}/`);
  console.log(`  Combined PDF:        ${combinedPath}`);
  console.log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
