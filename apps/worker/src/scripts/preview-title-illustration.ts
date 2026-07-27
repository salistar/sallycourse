// Aperçu ponctuel : rend la slide de titre AVEC illustration SDXL (data URI)
// pour vérification visuelle. Usage : tsx src/scripts/preview-title-illustration.ts <png> <out>
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderTemplate, SlideTemplateEnum } from '../shared.js';

const [png, out] = process.argv.slice(2);
if (!png || !out) throw new Error('usage: preview-title-illustration.ts <png> <out>');

const dataUri = `data:image/png;base64,${readFileSync(png).toString('base64')}`;
const html = renderTemplate(SlideTemplateEnum.Title, {
  lang: 'fr',
  direction: 'ltr',
  courseTitle: "QA + IA : Tester les logiciels à l'ère de l'Intelligence Artificielle",
  progress: 11,
  lessonLabel: 'Leçon',
  lessonNumber: 1,
  title: "L'IA dans le QA : Révolution et Syllabus ISTQB CT-AI",
  subtitle: 'Redéfinir le rôle du testeur',
  illustrationDataUri: dataUri,
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent(html, { waitUntil: 'networkidle' });
writeFileSync(out, await page.screenshot({ type: 'png' }));
await browser.close();
console.log('ok →', out);
