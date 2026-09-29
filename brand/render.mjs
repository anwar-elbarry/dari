// Renders PNG exports and a preview sheet from the SVGs. Run from brand/: node render.mjs
import { chromium } from '../node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const svg = (f) => readFileSync(f, 'utf8');
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 2 });

async function png(file, width, height, out, bg = 'transparent') {
  await page.setViewportSize({ width, height });
  const inner = svg(file).replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`);
  await page.setContent(`<html><body style="margin:0;background:${bg}">${inner}</body></html>`);
  await page.screenshot({ path: out, omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width, height } });
}

await png('riadtax-icon.svg', 256, 256, 'riadtax-icon-512.png');
await png('riadtax-logo.svg', 645, 160, 'riadtax-logo-1290.png');
await png('riadtax-logo-dark.svg', 645, 160, 'riadtax-logo-dark-1290.png', '#10231f');

const sheet = `<html><body style="margin:0;font-family:sans-serif;background:#f5f2ed">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
  <div style="padding:56px;background:#fbf7f2;display:flex;align-items:center;justify-content:center">${svg('riadtax-logo.svg').replace(/width="\d+" height="\d+"/, 'width="387" height="96"')}</div>
  <div style="padding:56px;background:#10231f;display:flex;align-items:center;justify-content:center">${svg('riadtax-logo-dark.svg').replace(/width="\d+" height="\d+"/, 'width="387" height="96"')}</div>
  <div style="padding:40px;background:#fff;display:flex;gap:28px;align-items:end;justify-content:center">
    ${[128, 64, 32, 16].map((s) => svg('riadtax-icon.svg').replace(/width="\d+" height="\d+"/, `width="${s}" height="${s}"`)).join('')}
  </div>
  <div style="padding:56px;background:#fff;display:flex;align-items:center;justify-content:center">${svg('riadtax-logo-mono.svg').replace(/width="\d+" height="\d+"/, 'width="387" height="96"')}</div>
</div></body></html>`;
await page.setViewportSize({ width: 1000, height: 420 });
await page.setContent(sheet);
await page.screenshot({ path: 'preview.png', fullPage: true });
await browser.close();
console.log('rendered');
