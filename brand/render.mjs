// Renders PNG exports and a preview sheet from the SVGs. Run from brand/: node render.mjs
import { chromium } from '../node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const svg = (f) => readFileSync(f, 'utf8');
const size = (file, w, h) => svg(file).replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 2 });

async function png(file, width, height, out, bg = 'transparent') {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:${bg}">${size(file, width, height)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width, height } });
}

const logoW = Number(svg('riadtax-logo.svg').match(/viewBox="0 0 (\d+) 64"/)[1]);
const scaled = (h) => Math.round((logoW * h) / 64);

await png('riadtax-icon.svg', 256, 256, 'riadtax-icon-512.png');
await png('riadtax-logo.svg', scaled(160), 160, 'riadtax-logo-1290.png');
await png('riadtax-logo-dark.svg', scaled(160), 160, 'riadtax-logo-dark-1290.png', '#0f0f10');

const sheet = `<html><body style="margin:0;font-family:sans-serif;background:#f5f2ed">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
  <div style="padding:56px;background:#0f0f10;display:flex;align-items:center;justify-content:center">${size('riadtax-logo-dark.svg', scaled(96), 96)}</div>
  <div style="padding:56px;background:#ffffff;display:flex;align-items:center;justify-content:center">${size('riadtax-logo.svg', scaled(96), 96)}</div>
  <div style="padding:40px;background:#fff;display:flex;gap:28px;align-items:end;justify-content:center">
    ${[128, 64, 32, 16].map((s) => size('riadtax-icon.svg', s, s)).join('')}
  </div>
  <div style="padding:56px;background:#fff;display:flex;align-items:center;justify-content:center">${size('riadtax-logo-mono.svg', scaled(96), 96)}</div>
</div></body></html>`;
await page.setViewportSize({ width: 1000, height: 420 });
await page.setContent(sheet);
await page.screenshot({ path: 'preview.png', fullPage: true });
await browser.close();
console.log('rendered');
