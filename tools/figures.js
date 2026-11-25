/* README figure generator.
 * Drives the real simulation through window.__lab and saves PNG/GIF files to docs/img/.
 * Needs the local dev server (POST /save). Usage, in the browser console on index.html:
 *   const s = document.createElement('script'); s.src = 'tools/figures.js'; document.body.append(s);
 *   await FIG.all();
 */
(() => {
'use strict';
const L = window.__lab, K = L.consts;
const { VW, VH, GT, GH, CW, CH, MARGIN } = K;
const C = { bg: '#0d1024', panel: '#161a36', text: '#dfe3ff', dim: '#8f96c8', acc: '#ffd39c', line: '#2a3060', on: '#5fb6cc', red: '#ff5d73' };
const FONT = '"Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
const MONO = 'ui-monospace,Menlo,monospace';
const log = (...a) => console.log('[fig]', ...a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ------------------------------------------------------------ canvas helpers
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; }
function snap() { L.render(); return new ImageData(new Uint8ClampedArray(L.img.data), VW, VH); }
function toCanvas(id) { const [c, x] = mk(id.width, id.height); x.putImageData(id, 0, 0); return c; }
function crop(id, sx, sy, w, h, s) { const src = id instanceof ImageData ? toCanvas(id) : id; const [c, x] = mk(w * s, h * s); x.drawImage(src, sx, sy, w, h, 0, 0, w * s, h * s); return c; }
function fieldImage(fn, w = CW, h = CH) { const id = new ImageData(w, h); for (let i = 0; i < w * h; i++) { const c = fn(i); id.data[i * 4] = c[0]; id.data[i * 4 + 1] = c[1]; id.data[i * 4 + 2] = c[2]; id.data[i * 4 + 3] = 255; } return id; }
const gray = arr => fieldImage(i => [arr[i], arr[i], arr[i]]);
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function hfColor(h, isW = true) {
  if (!isW) return [22, 24, 46];
  const t = clamp(h * 6, -1, 1);
  return t >= 0 ? [30 + 160 * t, 60 + 190 * t, 90 + 165 * t] : [30 - 225 * t, 60 - 100 * t, 90 + 20 * t];
}
function fig(w, h, title, sub) {
  // subtitle wraps; extra lines push the content down (callers keep using y = 80 as the top)
  const [m, mx] = mk(1, 1); mx.font = `bold 20px ${FONT}`;
  if (title) w = Math.max(w, Math.ceil(mx.measureText(title).width) + 40);
  mx.font = `13px ${FONT}`;
  const lines = [];
  if (sub) { let line = ''; for (const word of sub.split(' ')) { const t = line ? line + ' ' + word : word; if (mx.measureText(t).width > w - 40 && line) { lines.push(line); line = word; } else line = t; } lines.push(line); }
  const extra = Math.max(0, lines.length - 1) * 18;
  const [c, x] = mk(w, h + extra);
  x.fillStyle = C.bg; x.fillRect(0, 0, w, h + extra);
  if (title) { x.fillStyle = C.acc; x.font = `bold 20px ${FONT}`; x.fillText(title, 20, 34); }
  x.fillStyle = C.dim; x.font = `13px ${FONT}`; lines.forEach((l, i) => x.fillText(l, 20, 56 + i * 18));
  x.translate(0, extra);
  return { c, x };
}
function text(x, s, px, py, o = {}) {
  x.font = `${o.bold ? 'bold ' : ''}${o.size || 12}px ${o.mono ? MONO : FONT}`;
  x.fillStyle = o.color || C.text; x.textAlign = o.align || 'left'; x.textBaseline = o.base || 'alphabetic';
  x.fillText(s, px, py); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
}
function panel(x, img, px, py, cap, o = {}) {
  x.fillStyle = C.panel; x.fillRect(px - 4, py - 4, img.width + 8, img.height + 8 + (cap ? 22 : 0));
  x.strokeStyle = o.border || C.line; x.lineWidth = o.border ? 2 : 1; x.strokeRect(px - 4.5, py - 4.5, img.width + 9, img.height + 9 + (cap ? 22 : 0));
  x.drawImage(img, px, py);
  if (cap) text(x, cap, px, py + img.height + 16, { size: 12, color: o.capColor || C.dim });
}
function arrow(x, x0, y0, x1, y1, col = C.acc, w = 2) {
  x.strokeStyle = col; x.fillStyle = col; x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0); x.beginPath(); x.moveTo(x1, y1);
  x.lineTo(x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4)); x.lineTo(x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)); x.fill();
}
function swatch(x, col, px, py, label, o = {}) {
  x.fillStyle = col; x.fillRect(px, py - 11, 14, 14); x.strokeStyle = '#000'; x.lineWidth = 1; x.strokeRect(px + 0.5, py - 10.5, 13, 13);
  text(x, label, px + 20, py, { size: o.size || 12, color: o.color || C.text });
}
async function save(c, name) {
  const r = await fetch('/save?path=docs/img/' + name, { method: 'POST', body: c.toDataURL('image/png') });
  log(await r.text(), c.width + 'x' + c.height);
}
async function saveBytes(bytes, name) {
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const r = await fetch('/save?path=docs/img/' + name, { method: 'POST', body: btoa(bin) });
  log(await r.text(), (bytes.length / 1024 | 0) + 'KB');
}
const sprImage = (s, scale) => {
  const id = new ImageData(s.w, s.h);
  for (let i = 0; i < s.w * s.h; i++) { const c = s.p[i]; if (!c) continue; id.data[i * 4] = c & 255; id.data[i * 4 + 1] = (c >>> 8) & 255; id.data[i * 4 + 2] = (c >>> 16) & 255; id.data[i * 4 + 3] = 255; }
  return crop(id, 0, 0, s.w, s.h, scale);
};

// ------------------------------------------------------------ GIF encoder (LZW, global palette)
function encodeGIF(frames, w, h, scale, delayCs) {
  // palette from colour frequency; extra colours map to nearest
  const count = new Map();
  for (const f of frames) for (let i = 0; i < w * h; i++) { const k = (f.data[i * 4] << 16) | (f.data[i * 4 + 1] << 8) | f.data[i * 4 + 2]; count.set(k, (count.get(k) || 0) + 1); }
  const pal = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(e => e[0]);
  while (pal.length < 256) pal.push(0);
  const idx = new Map(); pal.forEach((k, i) => { if (!idx.has(k)) idx.set(k, i); });
  const near = k => {
    if (idx.has(k)) return idx.get(k);
    const r = k >> 16, g = (k >> 8) & 255, b = k & 255; let best = 0, bd = 1e9;
    for (let i = 0; i < 256; i++) { const p = pal[i], dr = r - (p >> 16), dg = g - ((p >> 8) & 255), db = b - (p & 255), d = dr * dr * 3 + dg * dg * 4 + db * db * 2; if (d < bd) { bd = d; best = i; } }
    idx.set(k, best); return best;
  };
  const W = w * scale, H = h * scale, out = [];
  const u16 = v => out.push(v & 255, (v >> 8) & 255);
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
  u16(W); u16(H); out.push(0xF7, 0, 0);
  for (const k of pal) out.push(k >> 16, (k >> 8) & 255, k & 255);
  out.push(0x21, 0xFF, 11); for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0)); out.push(3, 1, 0, 0, 0);
  const ind = new Uint8Array(W * H);
  for (const f of frames) {
    for (let y = 0; y < H; y++) { const sy = (y / scale) | 0; for (let x = 0; x < W; x++) { const i = (sy * w + ((x / scale) | 0)) * 4; ind[y * W + x] = near((f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2]); } }
    out.push(0x21, 0xF9, 4, 0, delayCs & 255, delayCs >> 8, 0, 0);
    out.push(0x2C); u16(0); u16(0); u16(W); u16(H); out.push(0);
    out.push(8);
    const data = lzw(ind, 8);
    for (let p = 0; p < data.length; p += 255) { const n = Math.min(255, data.length - p); out.push(n); for (let k = 0; k < n; k++) out.push(data[p + k]); }
    out.push(0);
  }
  out.push(0x3B);
  return new Uint8Array(out);
}
function lzw(ind, minCode) { // same scheme as omggif
  const clear = 1 << minCode, eoi = clear + 1; let next = eoi + 1, cs = minCode + 1, cur = 0, shift = 0;
  const out = []; let table = new Map();
  const emit = c => { cur |= c << shift; shift += cs; while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; } };
  emit(clear);
  let ib = ind[0];
  for (let i = 1; i < ind.length; i++) {
    const k = ind[i], key = (ib << 8) | k, code = table.get(key);
    if (code === undefined) {
      emit(ib);
      if (next === 4096) { emit(clear); next = eoi + 1; cs = minCode + 1; table = new Map(); }
      else { if (next >= (1 << cs)) cs++; table.set(key, next++); }
      ib = k;
    } else ib = code;
  }
  emit(ib); emit(eoi); if (shift > 0) out.push(cur & 255);
  return out;
}

// ------------------------------------------------------------ scene helpers
function prep() { L.ghost = false; L.paused = true; L.setAuto(false); L.keys.clear(); L.snowfall = false; L.camLock = true; L.showMap = false; }
function quiet() { L.hares.length = 0; L.ducks.length = 0; L.fishes.length = 0; L.parts.length = 0; L.noFish = true; }
function steps(n) { for (let k = 0; k < n; k++) L.step(); }
function walk(keys, n, onStep) { keys.forEach(k => L.keys.add(k)); for (let k = 0; k < n; k++) { L.step(); if (onStep) onStep(k); } L.keys.clear(); }
function place(x, y, camX) { L.ghost = false; L.player.x = x; L.player.y = y; L.setCam(camX); L.step(); }
function hidePlayer() { L.ghost = true; }
const wsx = wx => wx - L.camXi, ccx = wx => wx - L.originX;

// ------------------------------------------------------------ 1. hero GIFs
async function gif(name, setup, script, every = 2) {
  prep(); L.camLock = false; setup();
  const frames = [];
  let n = 0;
  for (const [keys, cnt] of script) walk(keys, cnt, () => { if (n++ % every === 0) frames.push(snap()); });
  const bytes = encodeGIF(frames, VW, VH, 2, 7);
  await saveBytes(bytes, name);
}
async function heroGifs() {
  await gif('snow.gif', () => { L.snowfall = true; L.warp(230); L.player.y = 40; steps(40); },
    [[['arrowright'], 45], [['arrowright', 'arrowdown'], 30], [['arrowright'], 25], [[], 12], [['arrowleft', 'arrowdown'], 26], [['arrowleft'], 20], [[], 16]]);
  await gif('grass.gif', () => { L.warp(960); L.player.y = 30; steps(40); },
    [[['arrowright'], 40], [['arrowright', 'arrowdown'], 26], [['arrowdown'], 14], [['arrowleft'], 44], [[], 40]]);
  await gif('water.gif', () => { L.warp(1470); L.player.y = 40; steps(60); },
    [[['arrowright'], 40], [['arrowright', 'arrowdown'], 26], [[], 14], [['arrowleft', 'arrowdown'], 20], [[], 30]]);
}

// ------------------------------------------------------------ 2. trail map vs game
async function figTrailMap() {
  prep(); L.camLock = false; L.warp(300); L.player.y = 50; steps(30);
  walk(['arrowright'], 40); walk(['arrowright', 'arrowup'], 24); walk(['arrowright'], 20);
  const game = snap(), tr = gray(L.trail);
  const S = 2, W = CW * S + 40, H = 90 + VH * S + 40 + CH * S + 70;
  const { c, x } = fig(W, H, 'Trail canvas follows the camera', 'Top: the game (320×180). Bottom: the 8-bit trail canvas it reads (384×104 = view + 32px margin each side).');
  const gx = 20 + MARGIN * S, gy = 80;
  panel(x, crop(game, 0, 0, VW, VH, S), gx, gy);
  const ty = gy + VH * S + 50;
  panel(x, crop(tr, 0, 0, CW, CH, S), 20, ty, 'R channel only · black = untouched · white = fresh boot dot (255)');
  x.setLineDash([6, 4]); x.strokeStyle = C.acc; x.lineWidth = 2;
  x.strokeRect(20 + MARGIN * S, ty, VW * S, CH * S); x.setLineDash([]);
  // ground band on the game
  x.strokeStyle = C.acc; x.setLineDash([6, 4]); x.strokeRect(gx, gy + GT * S, VW * S, GH * S); x.setLineDash([]);
  arrow(x, gx + VW * S / 2, gy + VH * S + 4, gx + VW * S / 2, ty - 6);
  text(x, 'ground rows 76–179 ↔ canvas rows 0–103', gx + VW * S / 2 + 10, gy + VH * S + 30, { color: C.acc });
  text(x, '32px', 20 + MARGIN * S / 2, ty + CH * S + 34, { align: 'center', color: C.acc, bold: true });
  text(x, '32px', 20 + (MARGIN + VW + MARGIN / 2) * S, ty + CH * S + 34, { align: 'center', color: C.acc, bold: true });
  await save(c, 'trail-map.png');
}

// ------------------------------------------------------------ 3. scrolling
async function figScroll() {
  prep(); L.camLock = false; L.warp(260); L.player.y = 55; steps(40);
  walk(['arrowright'], 36);
  const a = { o: L.originX, t: new Uint8Array(L.trail) };
  walk(['arrowright'], 26);
  const b = { o: L.originX, t: new Uint8Array(L.trail) };
  const S = 2, minO = Math.min(a.o, b.o), span = Math.max(a.o, b.o) - minO + CW;
  const W = span * S + 40, H = 90 + CH * S * 2 + 70 + 60;
  const { c, x } = fig(W, H, 'Scrolling the canvas keeps prints glued to the world', `scroll = origin − lastOrigin;  new[x] = old[x + scroll]  (out of range → 0).  Origin moved ${b.o - a.o}px here.`);
  const y1 = 90, y2 = 90 + CH * S + 70;
  const ax = 20 + (a.o - minO) * S, bx = 20 + (b.o - minO) * S;
  panel(x, crop(gray(a.t), 0, 0, CW, CH, S), ax, y1, `frame t   · origin.x = ${a.o}`);
  panel(x, crop(gray(b.t), 0, 0, CW, CH, S), bx, y2, `frame t+26 · origin.x = ${b.o}`);
  // dashed guides through prints that exist in both
  x.setLineDash([4, 4]); x.strokeStyle = C.acc; x.lineWidth = 1;
  const cols = new Set();
  for (let cx = 0; cx < CW; cx++) for (let cy = 0; cy < CH; cy++) if (a.t[cy * CW + cx] > 200) { const wx = a.o + cx; if (wx - b.o >= 0 && wx - b.o < CW && b.t[cy * CW + wx - b.o] > 100) cols.add(wx); }
  let last = -99;
  for (const wx of [...cols].sort((p, q) => p - q)) { if (wx - last < 6) continue; last = wx; const px = 20 + (wx - minO) * S + 1; x.beginPath(); x.moveTo(px, y1); x.lineTo(px, y2 + CH * S); x.stroke(); }
  x.setLineDash([]);
  text(x, 'same world x → same print', 20 + (a.o - minO) * S + 8, y2 - 22, { color: C.acc });
  await save(c, 'scroll.png');
}

// ------------------------------------------------------------ 4. stamps
function gauss(dx, dy, sx, sy, peak) { return Math.round(Math.min(1, peak * Math.exp(-((dx / sx) ** 2) - (dy / sy) ** 2)) * 255); }
const BANDS = [[166, '#e9f0ff', '≥166 deep snow dent'], [90, '#9fb7ef', '≥90 snow dent'], [64, '#3f95c9', '≥64 water source (if new)'], [44, '#4f9a45', '≥44 grass fully flat'], [5, '#2c4a2c', '>5 grass starts to bend'], [0, '#101428', '≤5 nothing']];
const bandCol = v => { for (const [t, c] of BANDS) if (v > t || (t === 0)) { if (t === 5 && v <= 5) continue; return c; } return '#101428'; };
async function figStamps() {
  const S = 14, gw = 25, gh = 17;
  const W = 20 + gw * S * 2 + 40 + 20, H = 90 + gh * S + 60 + 22 + 290 + 20;
  const { c, x } = fig(W, H, 'Two gaussian stamps, many thresholds', 'value = min(1, peak·exp(−(dx/sx)² − (dy/sy)²)) · 255, max-combined into the canvas. Colour = which effect reacts.');
  const stamps = [['Body dab — every frame', 4.5, 4.2, 0.30], ['Boot dot — contact frame only', 2.7, 1.8, 1.3]];
  stamps.forEach(([name, sx, sy, pk], k) => {
    const [g, gx] = mk(gw * S, gh * S);
    for (let y = 0; y < gh; y++) for (let xx = 0; xx < gw; xx++) {
      const v = gauss(xx - (gw - 1) / 2, y - (gh - 1) / 2, sx, sy, pk);
      gx.fillStyle = bandCol(v); gx.fillRect(xx * S, y * S, S - 1, S - 1);
    }
    panel(x, g, 20 + k * (gw * S + 40), 80, `${name}   sx ${sx}, sy ${sy}, peak ${pk}`);
  });
  // legend
  const ly0 = 80 + gh * S + 50;
  BANDS.forEach(([, col, lab], i) => swatch(x, col, 20 + (i % 3) * 250, ly0 + ((i / 3) | 0) * 22, lab, { size: 12 }));
  const ly = ly0 + 22;
  // cross-section chart
  const cx0 = 60, cy0 = ly + 40, cw = W - 100, chh = 200;
  x.fillStyle = C.panel; x.fillRect(cx0 - 40, cy0 - 10, cw + 60, chh + 40);
  const X = d => cx0 + (d + 12) / 24 * cw, Y = v => cy0 + chh - v / 255 * chh;
  for (const [t, col, lab] of BANDS.slice(0, 5)) {
    x.strokeStyle = col; x.setLineDash([5, 4]); x.lineWidth = 1; x.beginPath(); x.moveTo(cx0, Y(t)); x.lineTo(cx0 + cw, Y(t)); x.stroke(); x.setLineDash([]);
    text(x, String(t), cx0 - 8, Y(t) + 4, { align: 'right', size: 11, color: col, mono: true });
  }
  const cols = [C.on, C.acc];
  stamps.forEach(([name, sx, sy, pk], k) => {
    x.strokeStyle = cols[k]; x.lineWidth = 3; x.beginPath();
    for (let d = -12; d <= 12; d += 0.1) { const v = Math.min(255, Math.min(1, pk * Math.exp(-((d / sx) ** 2))) * 255); d === -12 ? x.moveTo(X(d), Y(v)) : x.lineTo(X(d), Y(v)); }
    x.stroke();
    text(x, name.split(' —')[0], cx0 + cw - 4, cy0 + 14 + k * 16, { align: 'right', color: cols[k], bold: true });
  });
  text(x, 'cross-section through the centre (x in pixels)', cx0, cy0 + chh + 22, { size: 11, color: C.dim });
  text(x, 'Body dab peaks at 76: flattens grass (≥44) but never dents snow (<90).', cx0, cy0 + chh + 44, { size: 13, color: C.text });
  await save(c, 'stamps.png');
}

// ------------------------------------------------------------ 5. walk cycle
async function figWalk() {
  prep(); quiet();
  const S = 5, fw = 22 * S, fh = 28 * S, gap = 14;
  // trail produced by walking
  L.resetTrails(); place(320, 60, 230); L.setFade(3);
  walk(['arrowright'], 42);
  const ox = Math.round(L.player.x) - 66, oy = 52;
  const trC = crop(gray(L.trail), ccx(ox), oy, 74, 14, 6);
  hidePlayer(); L.step();
  const rC = crop(snap(), wsx(ox), GT + oy, 74, 14, 6);
  L.setFade(2);
  const W = 20 + 8 * (fw + gap) + 10, H = 80 + fh + 60 + trC.height * 2 + 110;
  const { c, x } = fig(W, H, 'Walk cycle: 8 frames @ 12 fps, boot dots on contact frames', 'A boot dot is stamped only on the frame the animation ENTERS frame 2 (near boot) or frame 6 (far boot, 1px higher). The body dab is stamped every sim frame.');
  for (let f = 0; f < 8; f++) {
    const s = L.buildPlayer(f, true, 0.5), im = sprImage(s, S), px = 20 + f * (fw + gap);
    const contact = f === 2 || f === 6;
    panel(x, im, px, 80, `frame ${f}${contact ? (f === 2 ? '  near boot ↓' : '  far boot ↓') : ''}`, { border: contact ? C.acc : null, capColor: contact ? C.acc : C.dim });
    x.strokeStyle = '#3a4180'; x.beginPath(); x.moveTo(px, 80 + 26 * S + S / 2); x.lineTo(px + fw, 80 + 26 * S + S / 2); x.stroke();
    if (contact) { x.fillStyle = C.acc; x.beginPath(); x.arc(px + (11 + 3) * S + S / 2, 80 + 26 * S + S / 2, 5, 0, 7); x.fill(); }
  }
  const y2 = 80 + fh + 60;
  panel(x, trC, 20, y2, 'Trail canvas after walking right (fade 3): big dots = boots, soft band = body dab');
  panel(x, rC, 20, y2 + trC.height + 50, 'Rendered snow: only boot dots cross 90, so the body never digs a trench');
  await save(c, 'walk-cycle.png');
}

// ------------------------------------------------------------ 6. snow rules
const SNOWDBG = { base: '#3b4270', inside: '#9fc3ff', deep: '#4a7bd8', wall: '#1f2366', lip: '#ffe16b' };
function snowClass(tr, cx, cy, isSnow) {
  const at = (x, y) => (y >= 0 && isSnow(x, y)) ? tr[y * CW + x] : 0;
  const v = at(cx, cy), dent = v >= 90, dentA = at(cx, cy - 1) >= 90;
  if (dent) {
    const deep = v >= 166, dentL = at(cx - 1, cy) >= 90, deepA = at(cx, cy - 1) >= 166;
    let k = deep ? 'deep' : 'inside';
    if (!dentL) k = 'deep';
    if (deep && !deepA && dentA) k = 'wall';
    if (!dentA) k = 'wall';
    return k;
  }
  return dentA ? 'lip' : 'base';
}
async function figSnow() {
  prep(); quiet(); L.resetTrails(); L.setFade(2);
  place(300, 60, 200); hidePlayer();
  const x0 = 392, y0 = 66;
  for (const [dx, dy] of [[0, 0], [8, -1], [16, 0], [24, -1]]) L.addDot({ x: x0 + dx, y: y0 + dy, sx: 2.7, sy: 1.8, peak: 1.3 });
  L.addDot({ x: x0 + 34, y: y0 - 1, sx: 2.7, sy: 1.8, peak: 0.55 }); // a weaker one: shallow only
  L.step();
  const S = 11, cw = 46, chh = 14, ox = x0 - 6, oy = y0 - 7;
  const isSnow = (cx, cy) => L.terr[cy * K.WW + (L.originX + cx)] === K.T_SNOW;
  const tr = L.trail;
  const trImg = fieldImage(i => { const v = tr[i]; return v >= 166 ? [255, 255, 255] : v >= 90 ? [170, 170, 190] : [v * 0.55, v * 0.55, v * 0.6]; });
  const cls = fieldImage(i => { const cx = i % CW, cy = (i / CW) | 0; if (cx < 1 || cy < 1) return [0, 0, 0]; return hex(SNOWDBG[snowClass(tr, cx, cy, isSnow)]); });
  const A = crop(trImg, ccx(ox), oy, cw, chh, S), B = crop(cls, ccx(ox), oy, cw, chh, S), Cc = crop(snap(), wsx(ox), GT + oy, cw, chh, S);
  const W = Math.max(40 + A.width + 30, 720), H = 90 + (A.height + 40) * 3 + 120;
  const { c, x } = fig(W, H, 'Snow: colour from the pixel, its upper and its left neighbour', 'Light from the top left. Five boot dots (the last one weaker) → thresholds → classes → palette. Dents shrink from the edges as the canvas fades.');
  let y = 80;
  panel(x, A, 20, y, '① trail value  (white ≥ 166 · grey ≥ 90 · dark < 90)'); y += A.height + 40;
  panel(x, B, 20, y, '② classification (debug colours)'); y += B.height + 40;
  panel(x, Cc, 20, y, '③ final render with the real palette'); y += Cc.height + 46;
  const rules = [
    ['deep', 'DEEP  #92ace0', 'value ≥ 166, or a dent whose LEFT neighbour is not a dent (left wall)'],
    ['inside', 'INSIDE  #bad0f4', '90 ≤ value < 166'],
    ['wall', 'WALL  #647cba', 'dent whose UPPER neighbour is not a dent (top wall, darkest)'],
    ['lip', 'LIP  #fafdff', 'not a dent, but the pixel ABOVE is: the bright rim pushed up'],
    ['base', 'snow  #dff1ff', 'everything else (+ noise drifts and sparkles)'],
  ];
  rules.forEach(([k, name, desc], i) => { swatch(x, SNOWDBG[k], 20, y + i * 20, name, { size: 12 }); text(x, desc, 170, y + i * 20, { size: 12, color: C.dim }); });
  await save(c, 'snow-rules.png');
}
async function figSnowRecovery() {
  prep(); quiet(); L.resetTrails(); L.setFade(3);
  place(300, 60, 200); hidePlayer();
  const x0 = 380, y0 = 62;
  L.addDot({ x: x0, y: y0, sx: 2.7, sy: 1.8, peak: 1.3 });
  const marks = [0, 10, 20, 29, 40, 50, 55, 56], S = 11, cw = 13, chh = 9;
  const shots = []; let f = 0;
  for (const m of marks) { while (f <= m) { L.step(); f++; } shots.push([m, crop(gray(L.trail), ccx(x0 - 6), y0 - 5, cw, chh, S), crop(snap(), wsx(x0 - 6), GT + y0 - 5, cw, chh, S)]); }
  L.setFade(2);
  const pw = cw * S + 14, W = 20 + marks.length * pw + 10, H = 90 + chh * S * 2 + 120;
  const { c, x } = fig(W, H, 'Recovery comes for free: the canvas fades, the dent shrinks', 'One boot dot, fade 3 levels/frame at 30 fps (the article\'s numbers): deep until frame 29, a dent until frame 55, flat at 56.');
  shots.forEach(([m, a, b], i) => {
    const px = 20 + i * pw;
    panel(x, a, px, 80); panel(x, b, px, 80 + a.height + 16, `f${m} · ${(m / 30).toFixed(2)}s`);
  });
  await save(c, 'snow-recovery.png');
}

// ------------------------------------------------------------ 7. boots carry snow
async function figBoots() {
  prep(); quiet(); L.resetTrails(); L.setFade(2);
  const y = 50; place(640, y, 560); L.setFade(1);
  walk(['arrowright'], 120);
  const S = 7, ox = 676, cw = 104, chh = 24, oy = y - 18;
  const im = crop(snap(), wsx(ox), GT + oy, cw, chh, S);
  const cl = L.clumps.map(k => ({ ...k }));
  L.setFade(2);
  const W = im.width + 40, H = im.height + 150;
  const { c, x } = fig(W, H, 'Snow on the boots (timed decals, not canvas data)', 'Leaving the snow: the next 5 steps on dirt drop clumps of size 3, 3, 2, 2, 1. Each shrinks one size every 3.2/(size+1) s, so the oldest are already smaller here.');
  panel(x, im, 20, 80, 'snow dents → bare dirt with clumps → clean steps');
  x.strokeStyle = C.acc; x.lineWidth = 2;
  for (const k of cl) { const px = 20 + (k.x - ox) * S + S / 2, py = 80 + (k.y - oy) * S; if (px < 20 || px > 20 + im.width) continue; x.beginPath(); x.arc(px, py, 16, 0, 7); x.stroke(); text(x, 'size ' + k.size, px, py - 22, { align: 'center', color: C.acc, bold: true, size: 12 }); }
  await save(c, 'boot-snow.png');
}

// ------------------------------------------------------------ 8. grass
async function figGrass() {
  prep(); quiet(); L.setFade(2);
  const x0 = 1120, y = 66, ox = x0 - 14, oy = y - 22, cw = 110, chh = 30, S = 6;
  place(x0, y, x0 - 120); hidePlayer(); L.resetTrails(); steps(40);
  const before = crop(snap(), wsx(ox), GT + oy, cw, chh, S);
  L.ghost = false; L.player.facing = 1;
  walk(['arrowright'], 90); L.ghost = true; steps(2);
  const G = crop(snap(), wsx(ox), GT + oy, cw, chh, S), T = crop(gray(L.trail), ccx(ox), oy, cw, chh, S);
  const near = L.tufts.filter(t => t.wx > ox + 8 && t.wx < ox + cw - 8 && t.gy > oy + 8 && t.gy < oy + chh - 2);
  const pick = [];
  for (const w of [1, 0.95, 0.4, 0]) { let best = null, bd = 9; for (const t of near) { if (pick.includes(t)) continue; const d = Math.abs(t.press - w); if (d < bd && pick.every(p => Math.abs(p.wx - t.wx) > 16)) { bd = d; best = t; } } if (best) pick.push(best); }
  const drawBoxes = (cx, px, py) => {
    for (const t of pick) {
      const col = t.press > 0.6 ? C.red : t.press > 0.1 ? C.acc : '#7dff9a';
      cx.strokeStyle = col; cx.lineWidth = 2;
      cx.strokeRect(px + (t.wx - 5 - ox) * S, py + (t.gy - 6 - oy) * S, 11 * S, 8 * S);
      cx.fillStyle = col; cx.fillRect(px + (t.wx - ox) * S, py + (t.gy - oy) * S, S, S);
      const lx = px + (t.wx - 5 - ox) * S, ly = py + (t.gy - 6 - oy) * S - 6;
      cx.fillStyle = 'rgba(13,16,36,0.85)'; cx.fillRect(lx - 2, ly - 13, 82, 17);
      text(cx, `press ${t.press.toFixed(2)}`, lx + 2, ly, { size: 12, color: col, bold: true });
    }
  };
  const W = G.width + 40, H = 90 + (G.height + 44) * 3 + 10;
  const { c, x } = fig(W, H, 'Grass: each tuft reads an 11×8 box on the CPU', 'press = smoothstep((max − 0.02) / 0.15) over the box (6 rows above the root to 1 below). Lean = −clamp(slope·140, ±7px) from the canvas blurred 3×7, compared at x±2.');
  panel(x, before, 20, 80, '① before: untouched meadow');
  const y2 = 80 + G.height + 44, y3 = y2 + G.height + 44;
  panel(x, T, 20, y2, '② trail canvas after walking through (body dab ≈ 76 → fully flat)'); drawBoxes(x, 20, y2);
  panel(x, G, 20, y3, '③ rendered: 55% height, one shade darker, tips pushed up to 5px forward'); drawBoxes(x, 20, y3);
  await save(c, 'grass-sample.png');
}
async function figGrassSpring() {
  prep(); quiet(); L.resetTrails(); L.setFade(2);
  // an isolated reed on the sand reads best
  let t = null, bd = 1e9;
  for (const q of L.tufts) {
    if (q.kind !== 'reed' || L.terr[q.gy * K.WW + q.wx] !== K.T_SAND || q.gy < 20 || q.gy > 95 || q.h < 14) continue;
    const crowd = L.tufts.filter(o => o !== q && Math.abs(o.wx - q.wx) < 9 && Math.abs(o.gy - q.gy) < 7).length;
    if (crowd < bd) { bd = crowd; t = q; }
  }
  place(t.wx, t.gy, t.wx - 160); hidePlayer(); L.resetTrails(); steps(2);
  const rec = [], shots = [], shotAt = [0, 30, 50, 53, 56, 60, 66, 76, 100];
  const S = 6, cw = 24, chh = 24;
  for (let f = 0; f < 150; f++) {
    if (f < 24) L.addDot({ x: t.wx - 2, y: t.gy + 1, sx: 4.5, sy: 4.2, peak: 0.30 });
    L.step();
    let m = 0; const cx = ccx(t.wx);
    for (let y = Math.max(0, t.gy - 6); y <= t.gy + 1; y++) for (let xx = cx - 5; xx <= cx + 5; xx++) m = Math.max(m, L.trail[y * CW + xx]);
    rec.push([t.press, t.hold, m / 255]);
    if (shotAt.includes(f)) shots.push([f, crop(snap(), wsx(t.wx - 12), GT + t.gy - 21, cw, chh, S)]);
  }
  const W = 20 + 9 * (cw * S + 14) + 10, H = 80 + 300 + 60 + chh * S + 70;
  const { c, x } = fig(W, H, 'Grass recovery: hold, release in 0.08 s, then a 1.6 Hz spring (ζ = 0.28)', 'A body dab sits on one reed for 24 frames, then leaves. While the trail fades the reed stays down; under press 0.5 it lets go in 0.08 s and the spring overshoots (taller than normal, floor −0.18) before settling.');
  const cx0 = 70, cy0 = 90, cw2 = W - 110, chh2 = 260;
  x.fillStyle = C.panel; x.fillRect(cx0 - 50, cy0 - 14, cw2 + 80, chh2 + 50);
  const X = f => cx0 + f / 150 * cw2, Y = v => cy0 + chh2 * 0.8 - v * chh2 * 0.72;
  x.strokeStyle = '#2e356a'; x.lineWidth = 1;
  for (const v of [-0.2, 0, 0.5, 1]) { x.beginPath(); x.moveTo(cx0, Y(v)); x.lineTo(cx0 + cw2, Y(v)); x.stroke(); text(x, v.toFixed(1), cx0 - 8, Y(v) + 4, { align: 'right', size: 11, mono: true, color: C.dim }); }
  for (let s = 0; s <= 5; s++) text(x, s + 's', X(s * 30), cy0 + chh2 + 18, { align: 'center', size: 11, color: C.dim });
  x.fillStyle = 'rgba(255,211,156,0.08)'; x.fillRect(X(0), cy0 - 4, X(24) - X(0), chh2 + 8);
  text(x, 'dab on', X(2), cy0 + 10, { size: 11, color: C.acc });
  const lines = [[2, '#6a71a6', 'canvas max (0..1)', 1], [1, C.acc, 'hold (lets go over 0.08s)', 2], [0, '#7dff9a', 'press (drawn)', 3]];
  for (const [k, col, lab, w] of lines) { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); rec.forEach((r, f) => f ? x.lineTo(X(f), Y(r[k])) : x.moveTo(X(f), Y(r[k]))); x.stroke(); }
  lines.forEach(([, col, lab], i) => swatch(x, col, cx0 + cw2 - 210, cy0 + 16 + i * 18, lab, { size: 11 }));
  const y2 = cy0 + chh2 + 50;
  shots.forEach(([f, im], i) => panel(x, im, 20 + i * (im.width + 14), y2, `f${f}`));
  shots.forEach(([f], i) => { x.strokeStyle = 'rgba(255,255,255,0.25)'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(X(f), cy0); x.lineTo(X(f), cy0 + chh2); x.stroke(); x.setLineDash([]); });
  await save(c, 'grass-spring.png');
}

// ------------------------------------------------------------ 9. water
function calmLake() { prep(); quiet(); L.setFade(2); place(1560, 50, 1450); hidePlayer(); L.resetTrails(); steps(4); }
async function figWaterRings() {
  calmLake();
  const x0 = 1610, y0 = 52;
  L.addDot({ x: x0, y: y0, sx: 2.7, sy: 1.8, peak: 1.3 });
  const marks = [1, 6, 14, 26, 42], S = 3, cw = 104, chh = 44, ox = x0 - 52, oy = y0 - 22;
  const rows = []; let f = 0;
  for (const m of marks) {
    while (f < m) { L.step(); f++; }
    const hf = fieldImage(i => hfColor(L.wh[i], L.cWater[i]));
    rows.push([m, crop(hf, ccx(ox), oy, cw, chh, S), crop(snap(), wsx(ox), GT + oy, cw, chh, S)]);
  }
  const pw = cw * S, W = 20 + pw * 2 + 40 + 20, H = 80 + rows.length * (chh * S + 34) + 30;
  const { c, x } = fig(W, H, 'One boot landing → one ring', 'Left: height field h (cyan = up, orange = down). Right: only crest (light) and trough (dark) lines are drawn. Sideways waves are ~1.6× faster.');
  rows.forEach(([m, a, b], i) => {
    const y = 80 + i * (chh * S + 34);
    panel(x, a, 20, y, `frame ${m} · ${(m / 30).toFixed(2)}s`); panel(x, b, 20 + pw + 24, y);
  });
  await save(c, 'water-rings.png');
}
function miniWater(mode, n) {
  const W = 140, H = 60, tr = new Float32Array(W * H), h = new Float32Array(W * H), v = new Float32Array(W * H), t2 = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tr[y * W + x] = gauss(x - W / 2, y - H / 2, 2.7, 1.8, 1.3);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < W * H; i++) {
      const fresh = s === 0 ? tr[i] : 0;       // new paint only exists on the stamp frame
      if (s > 0) tr[i] = Math.max(0, tr[i] - 3);
      const src = mode === 'new' ? fresh : tr[i];
      if (src >= 64) h[i] -= src / 255;
    }
    for (let sub = 0; sub < 2; sub++) {
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; v[i] = (v[i] + 0.30 * (h[i - 1] + h[i + 1] - 2 * h[i]) + 0.12 * (h[i - W] + h[i + W] - 2 * h[i])) * 0.982; }
      for (let i = 0; i < W * H; i++) h[i] += 0.5 * v[i];
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; let sm = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) sm += h[i + a * W + b]; t2[i] = h[i] * 0.95 + sm / 9 * 0.05; }
    h.set(t2);
  }
  return { W, H, h };
}
function miniRender({ W, H, h }) {
  const base = hex('#2f75a3'), crest = hex('#d6f5fa'), trough = hex('#1c4574');
  return fieldImage(i => {
    const x = i % W, y = (i / W) | 0; if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return base;
    const v = h[i];
    if (v > 0.035 && ((v >= h[i - 1] && v >= h[i + 1]) || (v >= h[i - W] && v >= h[i + W]))) return crest;
    if (v < -0.035 && ((v <= h[i - 1] && v <= h[i + 1]) || (v <= h[i - W] && v <= h[i + W]))) return trough;
    return base;
  }, W, H);
}
async function figWaterSource() {
  const S = 3, n = 30;
  const a = miniWater('new', n), b = miniWater('faded', n);
  const ah = crop(fieldImage(i => hfColor(a.h[i]), a.W, a.H), 0, 0, a.W, a.H, S), ar = crop(miniRender(a), 0, 0, a.W, a.H, S);
  const bh = crop(fieldImage(i => hfColor(b.h[i]), b.W, b.H), 0, 0, b.W, b.H, S), br = crop(miniRender(b), 0, 0, b.W, b.H, S);
  const pw = a.W * S, W = 20 + pw * 2 + 30 + 20, H = 90 + (a.H * S + 40) * 2 + 20;
  const { c, x } = fig(W, H, 'Why water uses NEW paint only (frame 30 after one footprint)', 'Top: source = this frame\'s new paint ≥ 64 → one clean outward ring.  Bottom: source = the fading value → the print keeps pumping, rings pile up inside.');
  panel(x, ah, 20, 80, '✓ new paint: height field', { border: '#7dff9a', capColor: '#7dff9a' }); panel(x, ar, 20 + pw + 30, 80, '✓ crest / trough lines', { border: '#7dff9a', capColor: '#7dff9a' });
  const y2 = 80 + a.H * S + 40;
  panel(x, bh, 20, y2, '✗ faded value: height field', { border: C.red, capColor: C.red }); panel(x, br, 20 + pw + 30, y2, '✗ crest / trough lines', { border: C.red, capColor: C.red });
  await save(c, 'water-source.png');
}
async function figWaterLines() {
  calmLake();
  const x0 = 1580, y0 = 50; let fr = 0;
  const seq = [[0, 0], [8, -1], [16, 0], [24, -1]];
  for (let k = 0; k < seq.length; k++) { L.addDot({ x: x0 + seq[k][0], y: y0 + seq[k][1], sx: 2.7, sy: 1.8, peak: 1.3 }); steps(10); fr += 10; }
  steps(6);
  const S = 3, cw = 104, chh = 46, ox = x0 - 30, oy = y0 - 23;
  const wh = L.wh, cw2 = L.cWater;
  const raw = fieldImage(i => {
    const x = i % CW, y = (i / CW) | 0; if (!cw2[i] || x < 1 || y < 1 || x >= CW - 1 || y >= CH - 1) return [22, 24, 46];
    const v = wh[i];
    if (v > 0.035 && ((v >= wh[i - 1] && v >= wh[i + 1]) || (v >= wh[i - CW] && v >= wh[i + CW]))) return [230, 250, 255];
    if (v < -0.035 && ((v <= wh[i - 1] && v <= wh[i + 1]) || (v <= wh[i - CW] && v <= wh[i + CW]))) return [255, 140, 70];
    return [40, 60, 100];
  });
  const filt = fieldImage(i => !cw2[i] ? [22, 24, 46] : L.wmark[i] === 1 ? [230, 250, 255] : L.wmark[i] === 2 ? [255, 140, 70] : [40, 60, 100]);
  const P = [
    [crop(fieldImage(i => hfColor(wh[i], cw2[i])), ccx(ox), oy, cw, chh, S), '① height field h'],
    [crop(raw, ccx(ox), oy, cw, chh, S), '② |h| > 0.035 and a local max/min along x or y'],
    [crop(filt, ccx(ox), oy, cw, chh, S), '③ drop connected pieces under 3px'],
    [crop(snap(), wsx(ox), GT + oy, cw, chh, S), '④ draw: crest = light 1px, trough = one shade darker'],
  ];
  const pw = cw * S, W = 20 + pw * 2 + 30 + 20, H = 90 + (chh * S + 44) * 2;
  const { c, x } = fig(W, H, 'From a height field to pixel-art ripple lines', 'Four boot landings while wading (10 frames apart). The field is never painted directly — only its ridges.');
  P.forEach(([im, cap], i) => panel(x, im, 20 + (i % 2) * (pw + 30), 80 + ((i / 2) | 0) * (chh * S + 44), cap));
  await save(c, 'water-lines.png');
}
async function figWading() {
  prep(); quiet(); L.resetTrails(); L.setFade(2);
  const spots = [[null, 'on sand: no sink'], [null, 'shallow'], [null, 'deep: sink 4px']];
  // find shore at row 50
  const y = 50; let shore = 0;
  for (let wx = 1330; wx < 1500; wx++) if (L.terr[y * K.WW + wx] === K.T_WATER) { shore = wx; break; }
  const xs = [shore - 6, shore + 4, shore + 24];
  const S = 6, cw = 34, chh = 32, shots = [];
  for (const wx of xs) {
    place(wx, y, wx - 160); L.player.facing = 1;
    for (let k = 0; k < 30; k++) { L.player.x = wx; L.player.y = y; L.step(); }
    shots.push(crop(snap(), wsx(wx) - 17, GT + y - 26, cw, chh, S));
  }
  const W = 20 + 3 * (cw * S + 24), H = 90 + chh * S + 50;
  const { c, x } = fig(W, H, 'Wading: sink by shore distance, tint what is under the surface', 'Sink = min(4, (shoreDist − 1)·0.6) px. Pixels below the waterline become the water behind them, one shade darker; 2 foam pixels on each side.');
  shots.forEach((im, i) => panel(x, im, 20 + i * (cw * S + 24), 80, spots[i][1]));
  await save(c, 'wading.png');
}

// ------------------------------------------------------------ 10. sprites
async function figSprites() {
  const S = 4, items = [];
  for (let f = 0; f < 8; f += 2) items.push([L.buildPlayer(f, true, 0.3), `player f${f}`]);
  items.push([L.HARE[0], 'hare sit'], [L.HARE[1], 'hare hop'], [L.DUCK[0], 'duck'], [L.DUCK[1], 'duck dive']);
  const snowP = L.props.filter(p => p.wx < 700 && p.spr.h > 20).slice(0, 3);
  const rocks = L.props.filter(p => p.wx < 700 && p.spr.h <= 12).slice(0, 2);
  const green = L.props.filter(p => p.wx > 770 && p.wx < 1330 && p.spr.h > 18).slice(0, 2);
  const small = L.props.filter(p => p.wx > 770 && p.wx < 1330 && p.spr.h <= 12).slice(0, 3);
  const sign = L.props.filter(p => p.spr.w === 14 && p.spr.h === 16).slice(0, 1);
  for (const p of [...snowP, ...rocks, ...green, ...small, ...sign]) items.push([p.spr, '']);
  const ims = items.map(([s, l]) => [sprImage(s, S), l]);
  const maxH = Math.max(...ims.map(i => i[0].height));
  let W = 20; for (const [im] of ims) W += im.width + 18; W = Math.min(W, 1100);
  // wrap rows
  const rowsArr = []; let row = [], rw = 20;
  for (const it of ims) { if (rw + it[0].width + 18 > 1080 && row.length) { rowsArr.push(row); row = []; rw = 20; } row.push(it); rw += it[0].width + 18; }
  rowsArr.push(row);
  const rowH = rowsArr.map(r => Math.max(...r.map(i => i[0].height)) + 40);
  const H = 80 + rowH.reduce((a, b) => a + b, 0) + 10;
  const { c, x } = fig(1100, H, 'Every sprite is drawn in code', 'Pixels are set one by one into a small buffer, then an automatic 1px outline pass runs. No image assets in the repo.');
  let y = 80;
  rowsArr.forEach((r, ri) => { let px = 20; const h = rowH[ri] - 40; for (const [im, l] of r) { panel(x, im, px, y + h - im.height, l || null); px += im.width + 18; } y += rowH[ri]; });
  await save(c, 'sprites.png');
}

async function all() {
  const t0 = performance.now();
  await heroGifs();
  await figTrailMap();
  await figScroll();
  quiet();
  await figStamps();
  await figWalk();
  await figSnow();
  await figSnowRecovery();
  await figBoots();
  await figGrass();
  await figGrassSpring();
  await figWaterRings();
  await figWaterSource();
  await figWaterLines();
  await figWading();
  await figSprites();
  log('done in', ((performance.now() - t0) / 1000).toFixed(1), 's');
}
window.FIG = { all, heroGifs, figTrailMap, figScroll, figStamps, figWalk, figSnow, figSnowRecovery, figBoots, figGrass, figGrassSpring, figWaterRings, figWaterSource, figWaterLines, figWading, figSprites, encodeGIF };
})();
