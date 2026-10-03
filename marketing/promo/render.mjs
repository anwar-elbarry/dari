// Renders promo.html frame by frame with Chromium and encodes an MP4 with ffmpeg.
// Usage: node render.mjs [en|fr] [15|60]       -> out/riadtax-promo[-60]-<lang>.mp4 (with out/soundtrack[-60].wav if present)
//        STILLS=1,3.5,8 node render.mjs en 60  -> out/still[-60]-<lang>-<t>.png only
//        AUDIO_ONLY=1 node render.mjs en 60     -> re-mux the current soundtrack into the existing video
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const lang = process.argv[2] === 'fr' ? 'fr' : 'en';
const cut = process.argv[3] === '60' ? '-60' : '';
const fps = Number(process.env.FPS || 60);
const outDir = path.join(here, 'out');
mkdirSync(outDir, { recursive: true });

// AUDIO_ONLY=1 swaps the soundtrack into an already rendered video (no frame capture).
if (process.env.AUDIO_ONLY) {
  const video = path.join(outDir, `riadtax-promo${cut}-${lang}.mp4`);
  const tmp = video.replace(/\.mp4$/, '.tmp.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', path.join(outDir, `soundtrack${cut}.wav`), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp], { stdio: 'inherit' });
  const [code] = await once(ff, 'close');
  if (code !== 0) process.exit(code);
  renameSync(tmp, video);
  console.log(`new soundtrack in ${video}`);
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--force-color-profile=srgb', '--allow-file-access-from-files', '--disable-lcd-text'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
await page.goto(pathToFileURL(path.join(here, `promo${cut}.html`)).href + `?lang=${lang}`);
await page.evaluate(() => window.ready);
const duration = await page.evaluate(() => window.DURATION);
const stage = await page.$('#stage');

if (process.env.STILLS) {
  for (const t of process.env.STILLS.split(',').map(Number)) {
    await page.evaluate((x) => window.seek(x), t);
    writeFileSync(path.join(outDir, `still${cut}-${lang}-${t.toFixed(2)}.png`), await stage.screenshot({ type: 'png' }));
  }
  await browser.close();
  process.exit();
}

const out = path.join(outDir, `riadtax-promo${cut}-${lang}.mp4`);
const audio = path.join(outDir, `soundtrack${cut}.wav`);
const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
if (existsSync(audio)) args.push('-i', audio, '-c:a', 'aac', '-b:a', '192k', '-shortest');
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out);
const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = Math.round(duration * fps);
for (let f = 0; f < frames; f++) {
  await page.evaluate((x) => window.seek(x), f / fps);
  const buf = await stage.screenshot({ type: 'png' });
  if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
  if (f % fps === 0) process.stdout.write(`${lang} ${f / fps}s `);
}
ff.stdin.end();
const [code] = await once(ff, 'close');
await browser.close();
console.log(`\n${code === 0 ? 'wrote' : 'ffmpeg failed'} ${out}`);
