/* Shared motion helpers for promo.html and promo-60.html. Load after #stage exists. */
'use strict';
/* ---------- timing helpers ---------- */
const EASE = {
  lin: (x) => x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
const P = (t, start, dur, ease = 'outCubic') => EASE[ease](Math.min(1, Math.max(0, (t - start) / dur)));
const L = (a, b, x) => a + (b - a) * x;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, x) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(L(v, B[i], x))).join(',')})`; };
const css = (el, props) => { for (const k in props) el.style[k] = props[k]; };
const $ = (root, sel) => root.querySelector(sel);
const $$ = (root, sel) => [...root.querySelectorAll(sel)];
const stage = document.getElementById('stage');
const layer = (bg) => { const el = document.createElement('div'); el.className = 'layer'; el.style.background = bg; stage.appendChild(el); return el; };
const show = (el, on) => { el.style.visibility = on ? 'visible' : 'hidden'; };
/* For elements inside a layer: 'inherit', so a hidden layer still hides them. */
const vis = (el, on) => { el.style.visibility = on ? 'inherit' : 'hidden'; };
const circle = (r, x = 960, y = 540) => `circle(${Math.max(0, r)}px at ${x}px ${y}px)`;

/* Headline markup: one masked line per entry; <m>..</m> becomes a lime marker. */
function headline(lines) {
  return lines.map((l) => `<span class="line"><span class="li">${l.replace(/<m>(.*?)<\/m>/, (_, w) => `<span class="mk"><span>${w}</span><span class="mk-fill"><span>${w}</span></span></span>`)}</span></span>`).join('');
}
function fit(el, maxWidth) {
  const lines = $$(el, '.li');
  const width = () => (lines.length ? Math.max(...lines.map((l) => l.getBoundingClientRect().width)) : el.getBoundingClientRect().width);
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (width() > maxWidth && size > 20) { size -= 2; el.style.fontSize = size + 'px'; }
}
/* Reveal lines (mask slide) then markers (lime sweep). */
function playHeadline(el, t, start, gap = 0.08) {
  $$(el, '.li').forEach((li, i) => { li.style.transform = `translateY(${(1 - P(t, start + i * gap, 0.55, 'outExpo')) * 110}%)`; });
  const p = P(t, start + 0.32, 0.42, 'inOutCubic');
  $$(el, '.mk-fill').forEach((m) => { m.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0 round 0.14em)`; m.style.visibility = p > 0 ? 'inherit' : 'hidden'; });
}

/* Zellige field: 8-point stars (two squares) with diamonds between, centred on the stage. */
function zellige(parent) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'zel'); svg.setAttribute('viewBox', '0 0 1920 1080'); svg.setAttribute('width', '1920'); svg.setAttribute('height', '1080');
  const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
  const items = [];
  const star = (cx, cy, R) => {
    const pts = [];
    for (let k = 0; k < 16; k++) { const a = (k * 22.5 - 90) * Math.PI / 180, r = k % 2 ? R * 0.7654 : R; pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`); }
    return 'M' + pts.join('L') + 'Z';
  };
  const add = (d, cx, cy) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('pathLength', '1'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-dasharray', '1');
    g.appendChild(p); items.push({ el: p, d: Math.hypot(cx - 960, cy - 540) });
  };
  for (let j = -4; j <= 4; j++) for (let k = -7; k <= 7; k++) {
    const x = 960 + k * 160, y = 540 + j * 160;
    add(star(x, y, 48), x, y);
    add(`M${x + 80},${y + 62}L${x + 98},${y + 80}L${x + 80},${y + 98}L${x + 62},${y + 80}Z`, x + 80, y + 80);
  }
  parent.appendChild(svg);
  return { svg, g, items };
}

/* Logo (RiadTax "Badge R"), same geometry as apps/web/components/logo.tsx, with ids to animate. */
const R_PATH = 'M8 62 V6 H36 A17 17 0 0 1 43.5 38.4 L58 62 H43 L31 42 H23 V62 Z M23 19 V29 H36 A5 5 0 0 0 36 19 Z';
function markSvg(id, ring) {
  return `<defs><linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64"><stop offset="0" stop-color="#e4f222"/><stop offset="1" stop-color="#b9cc00"/></linearGradient></defs>
    <path class="m-r" d="${R_PATH}" fill="url(#${id}g)" fill-rule="evenodd" stroke="#e4f222" stroke-width="1.6" pathLength="1" stroke-dasharray="1"/>
    <g class="m-tile" style="transform-box: fill-box; transform-origin: center"><rect x="3" y="36" width="28" height="28" rx="8" fill="${ring}"/><rect x="5.5" y="38.5" width="23" height="23" rx="6" fill="#0f0f10"/></g>
    <path class="m-check" d="M10.5 47 L15 51.5 L24 42.5" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1"/>
    <path class="m-bar" d="M11 58.5 V56" fill="none" stroke="#e4f222" stroke-width="2.8" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/>
    <path class="m-bar" d="M17 58.5 V54" fill="none" stroke="#e4f222" stroke-width="2.8" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/>
    <path class="m-bar" d="M23 58.5 V51.5" fill="none" stroke="#e4f222" stroke-width="2.8" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/>`;
}
function playMark(root, t, start) {
  $(root, '.m-r').style.strokeDashoffset = 1 - P(t, start, 0.45, 'inOutCubic');
  $(root, '.m-r').style.fillOpacity = P(t, start + 0.28, 0.25);
  $(root, '.m-tile').style.transform = `scale(${Math.max(0, P(t, start + 0.38, 0.32, 'outBack'))})`;
  $(root, '.m-check').style.strokeDashoffset = 1 - P(t, start + 0.5, 0.22, 'outCubic');
  $$(root, '.m-bar').forEach((b, i) => { b.style.strokeDashoffset = 1 - P(t, start + 0.6 + i * 0.06, 0.18, 'outCubic'); });
}

const ICONS = {
  passport: '<rect x="14" y="8" width="36" height="48" rx="5"/><circle cx="32" cy="28" r="8"/><path d="M22 44H42M26 50H38"/>',
  calendar: '<rect x="10" y="14" width="44" height="40" rx="6"/><path d="M10 26H54M22 8V18M42 8V18"/><path d="M20 36h.01M32 36h.01M44 36h.01M20 46h.01M32 46h.01" stroke-width="5"/>',
  form: '<path d="M16 8H38L48 18V56H16Z"/><path d="M38 8V18H48M22 30H42M22 38H42M22 46H34"/>',
  tax: '<path d="M16 8H48V56L42 52L36 56L30 52L24 56L16 52Z"/><circle cx="26" cy="24" r="3"/><circle cx="38" cy="38" r="3"/><path d="M39 21L25 41"/>',
  register: '<rect x="12" y="8" width="40" height="48" rx="5"/><path d="M20 20H44M20 30H44M20 40H34"/>',
  link: '<rect x="14" y="28" width="36" height="26" rx="6"/><path d="M22 28V20a10 10 0 0 1 20 0v8"/><path d="M32 38v6"/>',
  chart: '<path d="M12 54H52"/><path d="M18 46V34M30 46V22M42 46V28"/>',
  check: '<path d="M4 9l3.5 3.5L14 5"/>',
};
const icon = (name, vb = 64) => `<svg viewBox="0 0 ${vb} ${vb}">${ICONS[name]}</svg>`;
