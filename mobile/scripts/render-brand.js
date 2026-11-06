// Renders the MK Sports icon set from branding/mark.svg (needs Playwright + Chromium).
//   node scripts/render-brand.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const mark = fs.readFileSync(path.join(root, 'branding/mark.svg'), 'utf8');
const mono = mark.replace(/url\(#mkg\)/g, '#FFFFFF');
const BG = 'radial-gradient(120% 120% at 20% 0%, #1B2E63 0%, #0B1430 45%, #060A16 100%)';

const jobs = [
  { file: 'icon.png', size: 1024, scale: 0.84, bg: BG },
  { file: 'android-icon-background.png', size: 512, scale: 0, bg: BG },
  { file: 'android-icon-foreground.png', size: 512, scale: 0.62, bg: null },
  { file: 'android-icon-monochrome.png', size: 432, scale: 0.62, bg: null, svg: mono },
  { file: 'splash-icon.png', size: 1024, scale: 0.9, bg: null },
  { file: 'favicon.png', size: 48, scale: 0.96, bg: BG },
  { file: 'notification-icon.png', size: 96, scale: 0.92, bg: null, svg: mono },
];

(async () => {
  const browser = await chromium.launch();
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    const inner = j.scale ? (j.svg ?? mark).replace('<svg ', `<svg width="${Math.round(j.size * j.scale)}" height="${Math.round(j.size * j.scale)}" `) : '';
    await page.setContent(
      `<html><body style="margin:0;width:${j.size}px;height:${j.size}px;display:flex;align-items:center;justify-content:center;background:${j.bg ?? 'transparent'}">${inner}</body></html>`,
    );
    await page.screenshot({ path: path.join(root, 'assets', j.file), omitBackground: !j.bg });
    await page.close();
    console.log('wrote', j.file);
  }
  await browser.close();
})();
