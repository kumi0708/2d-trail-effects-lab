/* 2D Trail Effects Lab
 * One 8-bit "trail canvas" that follows the camera drives three ground effects:
 *   snow  -> pixel dents with lit walls and lips
 *   grass -> per-tuft pressure / lean with a springy recovery
 *   water -> a height-field wave sim fed only by *new* paint
 * Everything (terrain, sky, sprites) is generated procedurally and drawn
 * into a single 320x180 pixel buffer.
 */
(() => {
'use strict';

// ---------------------------------------------------------------- constants
const VW = 320, VH = 180;          // view in pixels
const GT = 76, GH = 104;           // ground top (screen y) and ground height
const MARGIN = 32;                 // trail canvas margin on each side of the view
const CW = VW + MARGIN * 2, CH = GH; // trail canvas size (384 x 104)
const WW = 1920;                   // world width
const DT = 1 / 30;                 // fixed sim step (article values are per 30fps frame)

let FADE = 2;                      // levels per frame (article uses 3; slider changes it)
const SNOW_DENT = 90, SNOW_DEEP = 166;
const WATER_SRC = 64;

const T_DIRT = 0, T_SNOW = 1, T_GRASS = 2, T_WATER = 3, T_SAND = 4;

// ---------------------------------------------------------------- pixel utils
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(VW, VH);
const buf = new Uint32Array(img.data.buffer);

const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
const C = h => { const n = parseInt(h.slice(1), 16); return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255); };
const R_ = c => c & 255, G_ = c => (c >>> 8) & 255, B_ = c => (c >>> 16) & 255;
const mul = (c, f) => rgb(Math.min(255, R_(c) * f) | 0, Math.min(255, G_(c) * f) | 0, Math.min(255, B_(c) * f) | 0);
const mix = (a, b, t) => rgb((R_(a) + (R_(b) - R_(a)) * t) | 0, (G_(a) + (G_(b) - G_(a)) * t) | 0, (B_(a) + (B_(b) - B_(a)) * t) | 0);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = t => t * t * (3 - 2 * t);

function hash(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise1(x, s = 0) { const i = Math.floor(x), f = x - i; const a = hash(i, 0, s), b = hash(i + 1, 0, s); return (a + (b - a) * smooth(f)) * 2 - 1; }
function noise2(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  const u = smooth(fx), v = smooth(fy); const top = a + (b - a) * u, bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}
const fbm2 = (x, y, s = 0) => noise2(x, y, s) * 0.6 + noise2(x * 2.1, y * 2.1, s + 1) * 0.3 + noise2(x * 4.3, y * 4.3, s + 2) * 0.1;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261125);

// ---------------------------------------------------------------- palette
const PAL = {
  snow: C('#dff1ff'), snowSh: C('#d2e5f8'), snowHi: C('#ecf7ff'),
  inside: C('#bad0f4'), deep: C('#92ace0'), wall: C('#647cba'), lip: C('#fafdff'),
  dirt: ['#5b4137', '#6a4e42', '#78594a', '#876856'].map(C), pebble: C('#9b8878'), pebbleD: C('#4a342c'), dirtSnow: C('#c6d8ec'),
  grass: ['#2c5230', '#376136', '#43703c', '#517f44'].map(C),
  sand: ['#cfb27f', '#dcc391', '#e7d3a3'].map(C), wet: ['#a99068', '#b59c72'].map(C),
  sandPrint: C('#bea170'), sandDeep: C('#a88d60'), wetPrint: C('#8c7652'), wetDeep: C('#776243'),
  water: ['#d6f5fa', '#93d6e4', '#5fb6cc', '#4195b9', '#2f75a3', '#255b8c', '#1c4574', '#163760'].map(C),
  foam: C('#effcff'), sunRef: C('#ffdcae'), sunRef2: C('#f2b48f'),
  map: C('#ff3b5c'),
};

// ---------------------------------------------------------------- terrain
const terr = new Uint8Array(WW * GH);
const groundBase = new Uint32Array(WW * GH);
const sparkle = new Uint8Array(WW * GH);
let shoreDist, landDist;

function bfs(isSrc, isTgt, cap) {
  const d = new Uint8Array(WW * GH).fill(255), q = new Int32Array(WW * GH); let h = 0, t = 0;
  for (let i = 0; i < WW * GH; i++) if (isSrc(i)) { d[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], x = i % WW, y = (i / WW) | 0, nd = d[i] + 1; if (nd > cap) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= WW || ny >= GH) continue;
      const j = ny * WW + nx; if (isTgt(j) && d[j] > nd) { d[j] = nd; q[t++] = j; }
    }
  }
  return d;
}

const ZONE = { snowEnd: 700, grassStart: 760, grassEnd: 1335, waterStart: 1365, waterEnd: 1855 };

function genTerrain() {
  for (let gy = 0; gy < GH; gy++) {
    const snowEnd = 690 + 22 * noise1(gy * 0.07, 1) + 8 * noise1(gy * 0.3, 4);
    const dirtEnd = 752 + 18 * noise1(gy * 0.06, 11) + 6 * noise1(gy * 0.25, 2);
    const grassEnd = 1330 + 14 * noise1(gy * 0.05, 21) + 5 * noise1(gy * 0.3, 8);
    const waterStart = grassEnd + 26 + 8 * noise1(gy * 0.09, 31);
    const waterEnd = 1852 + 14 * noise1(gy * 0.06, 41) + 4 * noise1(gy * 0.3, 5);
    for (let wx = 0; wx < WW; wx++) {
      let t;
      if (wx < snowEnd) t = T_SNOW;
      else if (wx < dirtEnd) t = fbm2(wx * 0.05, gy * 0.08, 50) > 0.38 ? T_SNOW : T_DIRT;
      else if (wx < grassEnd) t = fbm2(wx * 0.025, gy * 0.07, 60) > 0.52 ? T_DIRT : T_GRASS;
      else if (wx < waterStart) t = T_SAND;
      else if (wx < waterEnd) t = T_WATER;
      else t = T_SAND;
      // a few bare patches in the snow
      if (t === T_SNOW && wx > 80 && fbm2(wx * 0.03, gy * 0.06, 70) > 0.58) t = T_DIRT;
      terr[gy * WW + wx] = t;
    }
  }
  shoreDist = bfs(i => terr[i] !== T_WATER, i => terr[i] === T_WATER, 60);
  landDist = bfs(i => terr[i] === T_WATER, i => terr[i] === T_SAND, 8);

  for (let gy = 0; gy < GH; gy++) for (let wx = 0; wx < WW; wx++) {
    const i = gy * WW + wx, t = terr[i], b = bayer(wx, gy);
    const back = gy < 14 ? 0.86 + 0.14 * gy / 14 : 1; // darker towards the back edge
    let c;
    if (t === T_SNOW) {
      const n = fbm2(wx * 0.035, gy * 0.11, 3);
      c = n < -0.18 - b * 0.14 ? PAL.snowSh : n > 0.3 + b * 0.14 ? PAL.snowHi : PAL.snow;
      if (hash(wx, gy, 5) < 0.007) sparkle[i] = 1 + ((hash(wx, gy, 6) * 254) | 0);
    } else if (t === T_DIRT) {
      const n = fbm2(wx * 0.08, gy * 0.15, 7) + (hash(wx, gy, 8) - 0.5) * 0.5;
      c = PAL.dirt[clamp(((n + 1) * 2) | 0, 0, 3)];
      if (hash(wx, gy, 9) < 0.02) c = PAL.pebble;
      else if (gy > 0 && hash(wx, gy - 1, 9) < 0.02) c = PAL.pebbleD;
      let near = false;
      for (let o = -2; o <= 2 && !near; o++) { const x2 = wx + o; if (x2 >= 0 && x2 < WW && terr[gy * WW + x2] === T_SNOW) near = true; if (gy + o >= 0 && gy + o < GH && terr[(gy + o) * WW + wx] === T_SNOW) near = true; }
      if (near && hash(wx, gy, 10) < 0.55) c = PAL.dirtSnow;
      c = mul(c, back);
    } else if (t === T_GRASS) {
      const n = fbm2(wx * 0.06, gy * 0.12, 12) + (hash(wx, gy, 13) - 0.5) * 0.6;
      c = mul(PAL.grass[clamp(((n + 1) * 2) | 0, 0, 3)], back);
    } else if (t === T_SAND) {
      const n = fbm2(wx * 0.07, gy * 0.2, 14) + (hash(wx, gy, 15) - 0.5) * 0.4;
      const ld = landDist[i];
      if (ld <= 2 || (ld === 3 && b < 0.5)) c = PAL.wet[n > 0 ? 1 : 0];
      else c = PAL.sand[clamp(((n + 1) * 1.5) | 0, 0, 2)];
      c = mul(c, back);
    } else c = PAL.water[3];
    groundBase[i] = c;
  }
}
const terrAt = (wx, gy) => { wx = Math.floor(wx); gy = Math.floor(gy); if (wx < 0 || wx >= WW || gy < 0 || gy >= GH) return T_DIRT; return terr[gy * WW + wx]; };
const shoreAt = (wx, gy) => { wx = Math.floor(wx); gy = Math.floor(gy); if (wx < 0 || wx >= WW || gy < 0 || gy >= GH) return 0; return terr[gy * WW + wx] === T_WATER ? shoreDist[gy * WW + wx] : 0; };

// ---------------------------------------------------------------- trail canvas (ping-pong)
let trailA = new Uint8Array(CW * CH), trailB = new Uint8Array(CW * CH);
const faded = new Uint8Array(CW * CH);
const newPaint = new Uint8Array(CW * CH);
let originX = 0, lastOriginX = 0;

function trailStep(dots, scroll) {
  const prev = trailA, out = trailB;
  // 1) scroll + fade
  for (let cy = 0; cy < CH; cy++) {
    const row = cy * CW;
    for (let cx = 0; cx < CW; cx++) {
      const sx = cx + scroll;
      let v = (sx >= 0 && sx < CW) ? prev[row + sx] : 0;
      v = v > FADE ? v - FADE : 0;
      out[row + cx] = v; faded[row + cx] = v;
    }
  }
  // 2) stamp gaussian dots, max-combined
  for (const d of dots) {
    const dcx = d.x - originX, dcy = d.y;
    const rx = Math.ceil(d.sx * 2.2), ry = Math.ceil(d.sy * 2.2);
    const x0 = Math.max(0, Math.floor(dcx - rx)), x1 = Math.min(CW - 1, Math.ceil(dcx + rx));
    const y0 = Math.max(0, Math.floor(dcy - ry)), y1 = Math.min(CH - 1, Math.ceil(dcy + ry));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + 0.5 - dcx) / d.sx, dy = (cy + 0.5 - dcy) / d.sy;
      const lv = Math.round(Math.min(1, d.peak * Math.exp(-dx * dx - dy * dy)) * 255);
      const i = cy * CW + cx; if (lv > out[i]) out[i] = lv;
    }
  }
  // 3) new paint = write - faded  (only water uses it)
  for (let i = 0; i < CW * CH; i++) newPaint[i] = out[i] - faded[i];
  trailA = out; trailB = prev;
}

// ---------------------------------------------------------------- water sim (canvas space)
let wh = new Float32Array(CW * CH), wv = new Float32Array(CW * CH);
let whT = new Float32Array(CW * CH), wvT = new Float32Array(CW * CH);
const cWater = new Uint8Array(CW * CH), cSoak = new Float32Array(CW * CH);
const wmark = new Uint8Array(CW * CH), seen = new Uint8Array(CW * CH), stack = new Int32Array(CW * CH), comp = new Int32Array(CW * CH);

function shiftField(a, t, scroll) {
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) { const sx = cx + scroll; t[cy * CW + cx] = (sx >= 0 && sx < CW) ? a[cy * CW + sx] : 0; }
}
function waterStep(scroll) {
  if (scroll) { shiftField(wh, whT, scroll); shiftField(wv, wvT, scroll); [wh, whT] = [whT, wh]; [wv, wvT] = [wvT, wv]; }
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const i = cy * CW + cx, wx = originX + cx;
    const isW = wx >= 0 && wx < WW && terr[cy * WW + wx] === T_WATER;
    cWater[i] = isW ? 1 : 0;
    if (isW) { const d = shoreDist[cy * WW + wx]; cSoak[i] = 0.92 + 0.08 * Math.min(1, (d - 1) / 4); }
    else { wh[i] = 0; wv[i] = 0; }
  }
  // source: this frame's new paint only (a boot landing), never the faded value
  for (let i = 0; i < CW * CH; i++) if (cWater[i] && newPaint[i] >= WATER_SRC) wh[i] -= newPaint[i] / 255;
  for (let sub = 0; sub < 2; sub++) {
    for (let cy = 1; cy < CH - 1; cy++) for (let cx = 1; cx < CW - 1; cx++) {
      const i = cy * CW + cx; if (!cWater[i]) continue;
      const h = wh[i];
      const lx = wh[i - 1] + wh[i + 1] - 2 * h, ly = wh[i - CW] + wh[i + CW] - 2 * h;
      wv[i] = (wv[i] + 0.30 * lx + 0.12 * ly) * 0.982 * cSoak[i];
    }
    for (let i = 0; i < CW * CH; i++) if (cWater[i]) wh[i] = (wh[i] + 0.5 * wv[i]) * cSoak[i];
  }
  // blend 5% of a 3x3 box blur
  for (let cy = 1; cy < CH - 1; cy++) for (let cx = 1; cx < CW - 1; cx++) {
    const i = cy * CW + cx; if (!cWater[i]) { whT[i] = 0; continue; }
    const s = wh[i - CW - 1] + wh[i - CW] + wh[i - CW + 1] + wh[i - 1] + wh[i] + wh[i + 1] + wh[i + CW - 1] + wh[i + CW] + wh[i + CW + 1];
    whT[i] = wh[i] * 0.95 + (s / 9) * 0.05;
  }
  for (let cy = 1; cy < CH - 1; cy++) for (let cx = 1; cx < CW - 1; cx++) { const i = cy * CW + cx; if (cWater[i]) wh[i] = whT[i]; }

  // crest / trough lines
  wmark.fill(0);
  for (let cy = 1; cy < CH - 1; cy++) for (let cx = 1; cx < CW - 1; cx++) {
    const i = cy * CW + cx; if (!cWater[i]) continue; const h = wh[i];
    if (h > 0.035 && ((h >= wh[i - 1] && h >= wh[i + 1]) || (h >= wh[i - CW] && h >= wh[i + CW]))) wmark[i] = 1;
    else if (h < -0.035 && ((h <= wh[i - 1] && h <= wh[i + 1]) || (h <= wh[i - CW] && h <= wh[i + CW]))) wmark[i] = 2;
  }
  // drop pieces under 3 px
  seen.fill(0);
  for (let i = 0; i < CW * CH; i++) {
    if (!wmark[i] || seen[i]) continue;
    const m = wmark[i]; let sp = 0, n = 0; stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const j = stack[--sp]; comp[n++] = j; const x = j % CW, y = (j / CW) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
        const k = ny * CW + nx; if (!seen[k] && wmark[k] === m) { seen[k] = 1; stack[sp++] = k; }
      }
    }
    if (n < 3) for (let k = 0; k < n; k++) wmark[comp[k]] = 0;
  }
}

// ---------------------------------------------------------------- sprites
class Spr {
  constructor(w, h) { this.w = w; this.h = h; this.p = new Uint32Array(w * h); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.p[y * this.w + x] = c; }
  get(x, y) { return (x >= 0 && y >= 0 && x < this.w && y < this.h) ? this.p[y * this.w + x] : 0; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) this.set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); }
  outline(c) {
    const q = this.p.slice(), w = this.w;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (q[i]) continue;
      if ((x > 0 && q[i - 1]) || (x < w - 1 && q[i + 1]) || (y > 0 && q[i - w]) || (y < this.h - 1 && q[i + w])) this.p[i] = c;
    }
    return this;
  }
}
// draw sprite with its anchor (ax, ay) at screen (ox, oy). Optional waterline: rows below get darkened, foam at edges.
function blit(s, ox, oy, ax, ay, flip, waterY = -1, t = 0) {
  let fl = 1e9, fr = -1e9;
  for (let y = 0; y < s.h; y++) {
    const sy = oy - ay + y; if (sy < 0 || sy >= VH) continue;
    for (let x = 0; x < s.w; x++) {
      const c = s.p[y * s.w + x]; if (!c) continue;
      const sx = flip ? ox + (ax - x) : ox + (x - ax); if (sx < 0 || sx >= VW) continue;
      const k = sy * VW + sx;
      if (waterY >= 0 && sy > waterY) buf[k] = mul(buf[k], 0.8);
      else buf[k] = c;
      if (sy === waterY) { if (sx < fl) fl = sx; if (sx > fr) fr = sx; }
    }
  }
  if (waterY >= 0 && fr >= fl) {
    const row = waterY * VW, fo = PAL.foam, f2 = PAL.water[1];
    const w = Math.sin(t * 9) > 0 ? 1 : 0;
    for (const sx of [fl - 1, fl - 2 - w, fr + 1, fr + 2 + w]) if (sx >= 0 && sx < VW) buf[row + sx] = (sx === fl - 1 || sx === fr + 1) ? fo : f2;
  }
}

// ---- player
const P = {
  out: C('#22182a'), coat: C('#c9473e'), coatL: C('#e86a55'), coatD: C('#8e2c3a'), belt: C('#5a2430'),
  scarf: C('#f3c24f'), scarfD: C('#c58b2c'), skin: C('#f3c9a3'), skinD: C('#d79a7c'), cheek: C('#ec8f86'),
  hat: C('#3b6fb0'), hatL: C('#5c93d2'), hatD: C('#294f86'), brim: C('#e9edf7'), pom: C('#ffffff'),
  pants: C('#3a3a5c'), pantsD: C('#2a2944'), boot: C('#6a4030'), bootD: C('#4a2b20'), bootL: C('#8d5a40'), eye: C('#22182a'),
};
const NEAR = [1, 2, 3, 1, -1, -3, -2, 0];  // near-foot x offset per walk frame (facing right)
const LIFT = [1, 1, 0, 0, 0, 0, 1, 2];
const CONTACT_NEAR = 2, CONTACT_FAR = 6;

function buildPlayer(f, moving, t) {
  const s = new Spr(22, 28), ax = 11, ay = 26;
  let nx = 1, fx = -1, nl = 0, fl = 0;
  if (moving) { nx = NEAR[f]; nl = LIFT[f]; fx = NEAR[(f + 4) % 8]; fl = LIFT[(f + 4) % 8]; }
  const bob = moving && (f === 0 || f === 4) ? -1 : 0;
  const by = ay + bob;
  const sw = moving ? Math.round(-NEAR[f] * 0.7) : 0;
  // far arm
  s.line(ax - 1, by - 12, ax - 1 - sw, by - 8, P.coatD); s.set(ax - 1 - sw, by - 7, P.scarfD);
  // far leg + boot
  s.line(ax - 1, by - 6, ax + fx - 1, ay - 2 - fl, P.pantsD);
  s.rect(ax + fx - 2, ay - 1 - fl, ax + fx, ay - fl, P.bootD); s.set(ax + fx + 1, ay - fl, P.bootD);
  // near leg + boot
  s.line(ax, by - 6, ax + nx, ay - 2 - nl, P.pants);
  s.rect(ax + nx - 1, ay - 1 - nl, ax + nx + 1, ay - nl, P.boot); s.set(ax + nx + 2, ay - nl, P.boot);
  s.set(ax + nx - 1, ay - 1 - nl, P.bootL);
  // coat
  for (let y = by - 13; y <= by - 6; y++) {
    const x0 = y <= by - 8 ? ax - 3 : ax - 4, x1 = y <= by - 8 ? ax + 2 : ax + 3;
    for (let x = x0; x <= x1; x++) {
      let c = P.coat;
      if (x === x0) c = P.coatL; if (x === x1 || y === by - 6) c = P.coatD;
      if (y === by - 9) c = P.belt;
      s.set(x, y, c);
    }
  }
  s.set(ax + 1, by - 11, P.coatD); // button
  // near arm
  s.line(ax, by - 12, ax + sw, by - 8, P.coatD); s.set(ax + sw, by - 7, P.scarf);
  // scarf + tail
  s.rect(ax - 3, by - 14, ax + 2, by - 14, P.scarf); s.set(ax + 2, by - 14, P.scarfD);
  const wv = Math.sin(t * (moving ? 12 : 4));
  s.set(ax - 4, by - 14, P.scarfD); s.set(ax - 5, by - 14 + (wv > 0.3 ? 1 : 0), P.scarf); s.set(ax - 6, by - 13 + (wv > -0.3 ? 0 : 1), P.scarfD);
  if (moving) s.set(ax - 7, by - 13 + (wv > 0 ? 1 : 0), P.scarf);
  // head
  s.rect(ax - 2, by - 18, ax + 2, by - 15, P.skin);
  s.set(ax - 2, by - 15, P.skinD); s.set(ax - 1, by - 15, P.skinD);
  s.set(ax + 3, by - 16, P.skin);
  const blink = (t % 3.3) < 0.12;
  s.set(ax + 1, by - 17, blink ? P.skinD : P.eye); s.set(ax + 2, by - 15, P.cheek);
  // hat
  s.rect(ax - 3, by - 18, ax + 2, by - 18, P.brim);
  s.rect(ax - 3, by - 19, ax + 2, by - 19, P.hat); s.rect(ax - 2, by - 20, ax + 1, by - 20, P.hat); s.rect(ax - 1, by - 21, ax + 0, by - 21, P.hat);
  s.set(ax - 3, by - 19, P.hatL); s.set(ax - 2, by - 20, P.hatL); s.set(ax + 2, by - 19, P.hatD); s.set(ax + 1, by - 20, P.hatD);
  const pb = moving && (f === 1 || f === 5) ? 1 : 0;
  s.set(ax - 2, by - 22 + pb, P.pom); s.set(ax - 1, by - 22 + pb, P.pom); s.set(ax - 2, by - 23 + pb, P.pom);
  return s.outline(P.out);
}

// ---- hare
const H = { fur: C('#f6f9ff'), sh: C('#c3cfe6'), ear: C('#e7a9b5'), eye: C('#2a2440'), out: C('#4e5a7e') };
function buildHare(pose) {
  const s = new Spr(14, 12), ax = 6, ay = 10;
  if (pose === 0) { // sitting
    s.rect(ax - 4, ay - 3, ax + 1, ay - 1, H.fur); s.rect(ax - 3, ay - 4, ax, ay - 4, H.fur);
    s.rect(ax - 4, ay, ax + 1, ay, H.sh); s.set(ax - 5, ay - 2, H.fur);
    s.rect(ax + 1, ay - 5, ax + 3, ay - 3, H.fur); s.set(ax + 3, ay - 4, H.eye); s.set(ax + 4, ay - 3, H.ear);
    s.line(ax + 1, ay - 6, ax + 1, ay - 8, H.fur); s.line(ax + 2, ay - 6, ax + 2, ay - 9, H.ear);
    s.set(ax + 2, ay + 0, H.sh);
  } else { // stretched mid-hop
    s.rect(ax - 5, ay - 3, ax + 2, ay - 2, H.fur); s.rect(ax - 4, ay - 1, ax + 1, ay - 1, H.sh);
    s.rect(ax + 2, ay - 4, ax + 4, ay - 2, H.fur); s.set(ax + 4, ay - 3, H.eye); s.set(ax + 5, ay - 2, H.ear);
    s.line(ax + 1, ay - 5, ax - 1, ay - 7, H.fur); s.line(ax + 2, ay - 5, ax, ay - 8, H.ear);
    s.set(ax - 6, ay - 1, H.sh); s.set(ax + 3, ay, H.sh);
  }
  return s.outline(H.out);
}
const HARE = [buildHare(0), buildHare(1)];

// ---- duck
const D = { body: C('#8b6b4b'), bodyL: C('#a8875f'), wing: C('#5e4632'), head: C('#2e7d55'), headL: C('#4aa577'), collar: C('#f4f1e8'), beak: C('#f0a83c'), eye: C('#1a1420'), out: C('#2a2230') };
function buildDuck(dip) {
  const s = new Spr(16, 12), ax = 7, ay = 9;
  s.rect(ax - 5, ay - 2, ax + 3, ay, D.body); s.rect(ax - 4, ay - 3, ax + 2, ay - 3, D.bodyL);
  s.rect(ax - 3, ay - 2, ax + 0, ay - 1, D.wing); s.set(ax - 6, ay - 3 - (dip ? 2 : 0), D.wing); s.set(ax - 6, ay - 2, D.body);
  if (!dip) {
    s.rect(ax + 2, ay - 6, ax + 4, ay - 4, D.head); s.set(ax + 2, ay - 6, D.headL); s.set(ax + 3, ay - 3, D.collar); s.set(ax + 2, ay - 3, D.collar);
    s.set(ax + 3, ay - 5, D.eye); s.set(ax + 5, ay - 5, D.beak); s.set(ax + 5, ay - 4, D.beak);
  } else {
    s.rect(ax + 3, ay - 1, ax + 5, ay, D.head); s.set(ax + 6, ay, D.beak);
    s.rect(ax - 6, ay - 4, ax - 5, ay - 3, D.body);
  }
  return s.outline(D.out);
}
const DUCK = [buildDuck(false), buildDuck(true)];

// ---- fish
const FISH = (() => { const s = new Spr(8, 5); const a = C('#d9e6f2'), b = C('#8ea6c0'), e = C('#e8865a');
  s.rect(1, 1, 5, 2, a); s.rect(2, 3, 4, 3, b); s.set(6, 2, a); s.set(0, 0, e); s.set(0, 3, e); s.set(5, 1, C('#1a1420')); return s.outline(C('#2b3550')); })();

// ---- pine
function buildPine(Hh, snowy, seed) {
  const r = rng(seed);
  const W = (Math.round(Hh * 0.72) | 1), s = new Spr(W + 4, Hh + 3), cx = (W + 3) >> 1;
  const trunk = C('#5a3b2e'), trunkD = C('#3e281f');
  const lit = snowy ? C('#2f6457') : C('#3d7a4e'), mid = snowy ? C('#23504a') : C('#2d6140'), dark = snowy ? C('#183a3a') : C('#1f4732');
  const sn = C('#eaf5ff'), snS = C('#b8cbe8'), snM = C('#d3e3f6');
  s.rect(cx - 1, Hh - 2, cx, Hh, trunk); s.set(cx, Hh - 1, trunkD); s.set(cx, Hh, trunkD);
  const top = 1, bot = Hh - 3, tiers = Hh < 20 ? 3 : 4, tl = (bot - top + 1) / tiers;
  for (let y = top; y <= bot; y++) {
    const g = (y - top) / (bot - top), local = ((y - top) % tl) / tl;
    const hw = Math.max(0, Math.round((0.2 + 0.8 * g) * (W / 2) * (0.4 + 0.6 * local)));
    for (let x = cx - hw; x <= cx + hw; x++) {
      const rel = (x - cx) / (hw + 0.5);
      let c = rel < -0.15 ? lit : rel < 0.45 ? mid : dark;
      if (Math.abs(x - cx) === hw && local > 0.6) c = dark;
      if (snowy && (local < 0.34 || (local < 0.55 && r() < 0.25))) c = rel < 0.3 ? sn : rel < 0.6 ? snM : snS;
      else if (!snowy && local < 0.2 && rel < 0.2) c = mix(lit, C('#7aa860'), 0.4);
      s.set(x, y, c);
    }
  }
  s.set(cx, 0, snowy ? sn : lit);
  return { spr: s.outline(C('#10222a')), ax: cx, ay: Hh };
}
// ---- rock / bush / signpost
function buildRock(w, h, kind, seed) {
  const r = rng(seed), s = new Spr(w + 2, h + 2), cx = (w + 1) / 2;
  const st = C('#7d7f97'), stL = C('#a0a2ba'), stD = C('#585a74');
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
    const dx = (x - cx) / (w / 2), dy = (y - h) / h;
    if (dx * dx + dy * dy * 1.1 > 1) continue;
    let c = dx < -0.2 && dy < -0.3 ? stL : dx > 0.4 || y === h ? stD : st;
    const capY = h * (kind === 'snow' ? 0.45 : 0.3) + r() * 1.2;
    if (y < capY + (1 - dy * dy) * 0.5) c = kind === 'snow' ? (dx > 0.4 ? C('#bcd0ec') : C('#eef7ff')) : (dx > 0.3 ? C('#3f6b3a') : C('#6a9a4e'));
    s.set(x, y, c);
  }
  return { spr: s.outline(C('#272840')), ax: Math.round(cx), ay: h };
}
function buildBush(w, h, seed) {
  const r = rng(seed), s = new Spr(w + 2, h + 2), cx = (w + 1) / 2;
  const g = [C('#7fb556'), C('#559343'), C('#3b7236'), C('#2a5528')];
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
    const dx = (x - cx) / (w / 2), dy = (y - h * 0.62) / (h * 0.62);
    const edge = 1 + 0.18 * Math.sin(x * 1.7 + seed) ; if (dx * dx + dy * dy > edge) continue;
    const l = -dx * 0.5 - dy * 0.7 + (r() - 0.5) * 0.5;
    s.set(x, y, g[clamp(Math.round(1.5 - l * 1.6), 0, 3)]);
  }
  for (let k = 0; k < w / 3; k++) { const x = 2 + (r() * (w - 2)) | 0, y = 2 + (r() * (h - 3)) | 0; if (s.get(x, y)) s.set(x, y, r() < 0.5 ? C('#e2484e') : C('#f6e08a')); }
  return { spr: s.outline(C('#16301b')), ax: Math.round(cx), ay: h };
}
function buildSign() {
  const s = new Spr(14, 16); const w = C('#8b5e3c'), wl = C('#b07a4e'), wd = C('#5e3d27');
  s.rect(6, 6, 7, 15, wd); s.set(6, 6, w); s.rect(1, 2, 12, 7, w); s.rect(1, 2, 12, 2, wl); s.rect(1, 7, 12, 7, wd);
  s.rect(3, 4, 4, 5, C('#3b2617')); s.rect(6, 4, 7, 5, C('#3b2617')); s.rect(9, 4, 10, 5, C('#3b2617'));
  s.rect(1, 1, 12, 1, C('#eaf5ff'));
  return { spr: s.outline(C('#26170f')), ax: 7, ay: 15 };
}

// ---------------------------------------------------------------- world objects
const props = [];
const tufts = [];
const lilies = [];

function placeProps() {
  // snowfield pines (back row + scattered)
  for (let wx = 8; wx < 680; wx += 12 + R() * 18) {
    const gy = 1 + ((R() * 6) | 0); props.push({ wx: Math.round(wx), gy, ...buildPine(18 + ((R() * 16) | 0), true, (R() * 1e9) | 0) });
  }
  for (let k = 0; k < 9; k++) {
    const wx = 60 + ((R() * 600) | 0), gy = 22 + ((R() * 76) | 0);
    if (terrAt(wx, gy) === T_SNOW) props.push({ wx, gy, ...buildPine(20 + ((R() * 14) | 0), true, (R() * 1e9) | 0) });
  }
  for (let k = 0; k < 8; k++) { const wx = 40 + ((R() * 640) | 0), gy = 18 + ((R() * 84) | 0); props.push({ wx, gy, ...buildRock(7 + ((R() * 8) | 0), 4 + ((R() * 4) | 0), 'snow', (R() * 1e9) | 0) }); }
  // meadow
  for (let wx = 770; wx < 1320; wx += 26 + R() * 40) props.push({ wx: Math.round(wx), gy: 1 + ((R() * 5) | 0), ...buildPine(20 + ((R() * 14) | 0), false, (R() * 1e9) | 0) });
  for (let k = 0; k < 10; k++) { const wx = 790 + ((R() * 520) | 0), gy = 14 + ((R() * 88) | 0); props.push({ wx, gy, ...buildBush(9 + ((R() * 8) | 0), 6 + ((R() * 4) | 0), (R() * 1e9) | 0) }); }
  for (let k = 0; k < 5; k++) { const wx = 780 + ((R() * 540) | 0), gy = 16 + ((R() * 84) | 0); props.push({ wx, gy, ...buildRock(8 + ((R() * 6) | 0), 4 + ((R() * 3) | 0), 'moss', (R() * 1e9) | 0) }); }
  props.push({ wx: 728, gy: 34, ...buildSign() });
  props.push({ wx: 1350, gy: 40, ...buildSign() });

  // grass tufts on a jittered grid
  const GRASS_RAMP = [C('#b9df78'), C('#86bc4f'), C('#5a9440'), C('#3d6e33'), C('#2a5028'), C('#1e3c1f')];
  const GRASS_RAMP2 = [C('#d8e48a'), C('#a9c25a'), C('#7a9c44'), C('#566f34'), C('#3d5228'), C('#2b3b1e')];
  const STRAW = [C('#f1dfa8'), C('#d9bf7c'), C('#b39558'), C('#8a6f40'), C('#64502e'), C('#463820')];
  const REED = [C('#d8d48a'), C('#b0aa5c'), C('#868245'), C('#5f5e34'), C('#434325'), C('#2f301b')];
  const FLOWERS = [C('#f4d35e'), C('#ef7a9a'), C('#ffffff'), C('#b69cf2')];
  const mkTuft = (wx, gy, hgt, ramp, n, kind) => {
    const blades = [];
    for (let b = 0; b < n; b++) blades.push({ dx: Math.round((R() - 0.5) * 5), hm: 0.6 + R() * 0.45, curl: (R() - 0.5) * 3, back: R() < 0.4 });
    blades.sort((a, b) => (b.back - a.back));
    tufts.push({ wx, gy, h: hgt, ramp, blades, kind, press: 0, pv: 0, hold: 0, rel: false, prevT: 0, lean: 0, lv: 0, dir: 1,
      flower: kind === 'grass' && R() < 0.09 ? FLOWERS[(R() * FLOWERS.length) | 0] : 0, ph: R() * 6.28 });
  };
  for (let gy = 2; gy < GH; gy += 4) for (let wx = 770; wx < 1340; wx += 6) {
    const x = wx + Math.round((R() - 0.5) * 4), y = gy + Math.round((R() - 0.5) * 3);
    if (terrAt(x, y) !== T_GRASS) continue;
    const n = fbm2(x * 0.02, y * 0.05, 90);
    if (n < -0.3 && R() < 0.8) continue;
    const tall = 5 + Math.max(0, n + 0.4) * 5 + R() * 2.5;
    mkTuft(x, y, tall, n > 0.25 ? GRASS_RAMP2 : GRASS_RAMP, 3 + ((R() * 3) | 0), 'grass');
  }
  // dry stalks poking through the snow
  for (let k = 0; k < 90; k++) {
    const x = 30 + ((R() * 660) | 0), y = 4 + ((R() * 98) | 0);
    if (terrAt(x, y) === T_SNOW && fbm2(x * 0.03, y * 0.08, 91) > 0.05) mkTuft(x, y, 5 + R() * 5, STRAW, 2 + ((R() * 2) | 0), 'straw');
  }
  // reeds along both shores
  for (let gy = 2; gy < GH; gy += 3) for (let wx = 1330; wx < WW; wx += 3) {
    const x = wx + Math.round((R() - 0.5) * 2), y = gy + Math.round((R() - 0.5) * 2);
    const t = terrAt(x, y), i = clamp(y, 0, GH - 1) * WW + clamp(x, 0, WW - 1);
    const ok = (t === T_SAND && landDist[i] <= 5) || (t === T_WATER && shoreDist[i] <= 2);
    if (!ok || fbm2(x * 0.04, y * 0.06, 92) < 0.1) continue;
    mkTuft(x, y, 11 + R() * 7, REED, 2 + ((R() * 3) | 0), 'reed');
  }
  // lily pads
  for (let k = 0; k < 400 && lilies.length < 22; k++) {
    const x = ZONE.waterStart + 20 + ((R() * 440) | 0), y = 6 + ((R() * 94) | 0);
    if (shoreAt(x, y) > 6) lilies.push({ x, y, flower: R() < 0.35 ? (R() < 0.5 ? C('#f6a9c4') : C('#ffffff')) : 0, s: 2 + ((R() * 2) | 0) });
  }
}

// ---------------------------------------------------------------- actors
const player = { x: 150, y: 62, facing: 1, frame: 0, animT: 0, moving: false, bootSnow: 0, sink: 0 };
const hares = [], ducks = [], fishes = [], parts = [], clumps = [];
function spawnCritters() {
  for (let k = 0; k < 4; k++) hares.push({ x: 220 + k * 120 + R() * 60, y: 20 + R() * 70, facing: R() < 0.5 ? -1 : 1, hop: -1, wait: R() * 2, tx: 0, ty: 0, z: 0 });
  for (let k = 0; k < 3; k++) {
    let x, y; do { x = ZONE.waterStart + 60 + R() * 380; y = 15 + R() * 80; } while (shoreAt(x, y) < 8);
    ducks.push({ x, y, facing: R() < 0.5 ? -1 : 1, ang: R() * 6.28, paddle: R(), dip: 0, dipWait: 2 + R() * 5 });
  }
}
let fishTimer = 2.5;

// ---------------------------------------------------------------- input
const keys = new Set();
let autopilot = true, showMap = false, snowfall = true;
const ap = { tx: 260, ty: 50, wait: 0, dir: 1 };
const pointer = { down: false, x: 0, y: 0 };

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) {
    keys.add(k); if (autopilot) setAuto(false); e.preventDefault();
  }
  if (k === 'p') setAuto(!autopilot);
  if (k === 'm') setMap(!showMap);
  if (k === 'f') setSnow(!snowfall);
  if (k === 'r') resetTrails();
  if (k === '1') warp(150); if (k === '2') warp(1000); if (k === '3') warp(1560);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function toViewPos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * VW, y: (e.clientY - r.top) / r.height * VH }; }
canvas.addEventListener('pointerdown', e => { pointer.down = true; Object.assign(pointer, toViewPos(e)); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (pointer.down) Object.assign(pointer, toViewPos(e)); });
addEventListener('pointerup', () => pointer.down = false);

const $ = id => document.getElementById(id);
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.opacity = 0, 1400); }
function setAuto(v) { autopilot = v; $('bAuto').classList.toggle('on', v); toast(v ? '自動歩行 ON' : '自動歩行 OFF'); if (v) apNext(); }
function setMap(v) { showMap = v; $('bMap').classList.toggle('on', v); toast(v ? 'トレイル重ね表示 ON' : 'トレイル重ね表示 OFF'); }
function setSnow(v) { snowfall = v; $('bSnow').classList.toggle('on', v); toast(v ? '降雪 ON' : '降雪 OFF'); }
function resetTrails() { trailA.fill(0); trailB.fill(0); wh.fill(0); wv.fill(0); clumps.length = 0; for (const t of tufts) { t.press = t.pv = t.hold = t.lean = t.lv = 0; } toast('リセット'); }
function warp(x) { player.x = x; player.y = 60; cam = clamp(x - VW / 2, 0, WW - VW); apNext(); toast('ワープ'); }
$('bAuto').onclick = () => setAuto(!autopilot);
$('bMap').onclick = () => setMap(!showMap);
$('bSnow').onclick = () => setSnow(!snowfall);
$('bReset').onclick = resetTrails;
$('fade').oninput = e => { FADE = +e.target.value; $('fadeVal').textContent = FADE + (FADE === 3 ? '（記事の値）' : ''); };
let warpIdx = 0; $('bJump').onclick = () => { warpIdx = (warpIdx + 1) % 3; warp([150, 1000, 1560][warpIdx]); };

function apNext() {
  let nx = player.x + ap.dir * (50 + R() * 120);
  if (nx > WW - 30) { nx = WW - 30; ap.dir = -1; }
  if (nx < 30) { nx = 30; ap.dir = 1; }
  ap.tx = nx; ap.ty = 10 + R() * 88;
}

// ---------------------------------------------------------------- particles
function puff(x, y, n, cols, spread, vz, g, life, face = 0) {
  for (let k = 0; k < n; k++) parts.push({ x, y, z: 0.5, vx: (R() - 0.5) * spread + face * 6, vy: (R() - 0.5) * spread * 0.4, vz: vz * (0.6 + R() * 0.6), g, life: life * (0.6 + R() * 0.6), c: cols[(R() * cols.length) | 0] });
}
const SPLASH = [PAL.water[0], PAL.water[1], PAL.foam];
const SNOWP = [PAL.snowHi, PAL.lip, PAL.snowSh];
const DUST = [C('#8a6d5a'), C('#9d8270'), C('#b8a48f')];
const LEAF = [C('#86bc4f'), C('#b9df78')];

// ---------------------------------------------------------------- simulation
let time = 0, cam = 0, camXi = 0, stepCount = 0;
let dots = [];
const extraDots = [];

function contact(a, fxw, fyg, face) {
  const t = terrAt(fxw, fyg);
  dots.push({ x: fxw, y: fyg, sx: 2.7, sy: 1.8, peak: 1.3 });
  if (t === T_SNOW) { a.bootSnow = 5; puff(fxw, fyg, 3 + ((R() * 3) | 0), SNOWP, 16, 22, 110, 0.55, face); }
  else if (t === T_WATER) { a.bootSnow = 0; puff(fxw, fyg, 4 + ((R() * 3) | 0), SPLASH, 20, 34, 150, 0.6, face); }
  else if (t === T_GRASS) { if (R() < 0.35) puff(fxw, fyg, 1, LEAF, 10, 14, 40, 0.8, face); }
  else {
    if (a.bootSnow > 0) { clumps.push({ x: Math.round(fxw), y: Math.round(fyg), size: [3, 3, 2, 2, 1][5 - a.bootSnow], t: 0 }); a.bootSnow--; }
    if (R() < 0.6) puff(fxw, fyg, 2, DUST, 8, 6, 25, 0.5, face);
  }
}

function stepPlayer() {
  if (window.__lab && window.__lab.ghost) return; // figure generator: player removed from the scene
  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx--;
  if (keys.has('arrowright') || keys.has('d')) dx++;
  if (keys.has('arrowup') || keys.has('w')) dy--;
  if (keys.has('arrowdown') || keys.has('s')) dy++;
  if (autopilot) {
    if (ap.wait > 0) ap.wait -= DT;
    else {
      const ex = ap.tx - player.x, ey = ap.ty - player.y;
      if (Math.hypot(ex, ey) < 2) { ap.wait = R() < 0.35 ? 0.6 + R() * 1.4 : 0; apNext(); }
      else { dx = ex; dy = ey / 0.75; }
    }
  }
  const len = Math.hypot(dx, dy);
  const inWater = terrAt(player.x, player.y) === T_WATER;
  player.moving = len > 0.01;
  if (player.moving) {
    dx /= len; dy /= len;
    const sp = 27 * (inWater ? 0.68 : 1);
    player.x = clamp(player.x + dx * sp * DT, 10, WW - 10);
    player.y = clamp(player.y + dy * sp * 0.75 * DT, 4, GH - 2);
    if (Math.abs(dx) > 0.2) player.facing = dx > 0 ? 1 : -1;
    player.animT += DT * 12 * (inWater ? 0.75 : 1);
    const f = Math.floor(player.animT) % 8;
    if (f !== player.frame) {
      player.frame = f;
      if (f === CONTACT_NEAR) contact(player, player.x + 3 * player.facing, player.y, player.facing);
      if (f === CONTACT_FAR) contact(player, player.x + 3 * player.facing, player.y - 1, player.facing);
    }
  } else { player.animT = 1.2; player.frame = 0; }
  // body dab every frame (below the snow threshold, but enough to flatten grass)
  dots.push({ x: player.x + player.facing, y: player.y + 1, sx: 4.5, sy: 4.2, peak: 0.30 });
  // wading depth
  const d = shoreAt(player.x, player.y), target = inWater ? Math.min(4, (d - 1) * 0.6) : 0;
  player.sink += clamp(target - player.sink, -DT * 10, DT * 10);
  if (terrAt(player.x, player.y) === T_WATER) player.bootSnow = 0;
}

function stepHares() {
  for (const h of hares) {
    const pd = Math.hypot(player.x - h.x, (player.y - h.y) * 1.5);
    if (h.hop < 0) {
      h.wait -= DT;
      if (pd < 34 && h.wait > 0.05) h.wait = 0.05;
      if (h.wait <= 0) {
        let dir;
        if (pd < 40) dir = h.x > player.x ? 1 : -1; else dir = R() < 0.5 ? -1 : 1;
        const tx = h.x + dir * (6 + R() * 3), ty = h.y + (R() - 0.5) * 5 + (pd < 40 ? Math.sign(h.y - player.y) * 2 : 0);
        if (terrAt(tx, ty) === T_SNOW && tx > 20 && tx < ZONE.snowEnd - 20 && ty > 6 && ty < GH - 4) {
          h.hop = 0; h.sx0 = h.x; h.sy0 = h.y; h.tx = tx; h.ty = ty; h.facing = dir;
        } else h.wait = 0.2;
      }
    } else {
      h.hop += DT / 0.33;
      const k = Math.min(1, h.hop);
      h.x = h.sx0 + (h.tx - h.sx0) * k; h.y = h.sy0 + (h.ty - h.sy0) * k; h.z = Math.sin(k * Math.PI) * 4;
      if (k >= 1) {
        h.hop = -1; h.z = 0; h.wait = pd < 40 ? 0.02 : 0.4 + R() * (R() < 0.3 ? 3 : 0.8);
        const f = h.facing;
        dots.push({ x: h.x + f * 1.5, y: h.y - 0.8, sx: 1.6, sy: 0.9, peak: 1.15 });
        dots.push({ x: h.x + f * 1.5, y: h.y + 0.9, sx: 1.6, sy: 0.9, peak: 1.15 });
        dots.push({ x: h.x - f * 2.5, y: h.y, sx: 1.0, sy: 0.8, peak: 1.0 });
        puff(h.x, h.y, 2, SNOWP, 10, 14, 100, 0.4);
      }
    }
    if (h.hop < 0) dots.push({ x: h.x, y: h.y, sx: 2.2, sy: 1.6, peak: 0.2 });
  }
}

function stepDucks() {
  for (const d of ducks) {
    d.ang += (R() - 0.5) * 0.25;
    const pd = Math.hypot(player.x - d.x, player.y - d.y);
    if (pd < 40) d.ang = Math.atan2(d.y - player.y, d.x - player.x);
    const sp = pd < 40 ? 14 : 5;
    const nx = d.x + Math.cos(d.ang) * sp * DT, ny = d.y + Math.sin(d.ang) * sp * 0.6 * DT;
    if (shoreAt(nx, ny) >= 7) { d.x = nx; d.y = ny; } else d.ang += Math.PI * (0.5 + R());
    if (Math.abs(Math.cos(d.ang)) > 0.2) d.facing = Math.cos(d.ang) > 0 ? 1 : -1;
    d.paddle -= DT;
    if (d.paddle <= 0) { d.paddle = pd < 40 ? 0.45 : 0.9 + R() * 0.4; dots.push({ x: d.x - d.facing * 3, y: d.y, sx: 1.6, sy: 1.1, peak: 0.42 }); }
    if (d.dip > 0) { d.dip -= DT; }
    else { d.dipWait -= DT; if (d.dipWait <= 0) { d.dip = 0.8; d.dipWait = 4 + R() * 6; dots.push({ x: d.x + d.facing * 4, y: d.y, sx: 2, sy: 1.4, peak: 0.95 }); puff(d.x + d.facing * 4, d.y, 3, SPLASH, 12, 20, 140, 0.4); } }
  }
}

function stepFish() {
  if (window.__lab && window.__lab.noFish) return;
  fishTimer -= DT;
  if (fishTimer <= 0) {
    fishTimer = 2.5 + R() * 4;
    for (let tries = 0; tries < 20; tries++) {
      const x = camXi + 10 + R() * (VW - 20), y = 8 + R() * 90;
      if (shoreAt(x, y) > 9) {
        const dir = R() < 0.5 ? -1 : 1;
        fishes.push({ x, y, x0: x, dir, t: 0 });
        dots.push({ x, y, sx: 2.3, sy: 1.6, peak: 1.0 }); puff(x, y, 5, SPLASH, 18, 36, 150, 0.6);
        break;
      }
    }
  }
  for (let k = fishes.length - 1; k >= 0; k--) {
    const f = fishes[k]; f.t += DT / 0.7; f.x = f.x0 + f.dir * f.t * 12;
    if (f.t >= 1) { dots.push({ x: f.x, y: f.y, sx: 2.0, sy: 1.4, peak: 0.9 }); puff(f.x, f.y, 4, SPLASH, 14, 26, 150, 0.5); fishes.splice(k, 1); }
  }
}

function sampleMax(cx, cy) {
  let m = 0;
  for (let y = Math.max(0, cy - 6); y <= Math.min(CH - 1, cy + 1); y++) for (let x = cx - 5; x <= cx + 5; x++) { const v = trailA[y * CW + x]; if (v > m) m = v; }
  return m;
}
function sampleBlur(cx, cy) {
  let s = 0, n = 0;
  for (let y = Math.max(0, cy - 1); y <= Math.min(CH - 1, cy + 1); y++) for (let x = cx - 3; x <= cx + 3; x++) { s += trailA[y * CW + x]; n++; }
  return s / n / 255;
}
function stepTufts() {
  const W1 = 2 * Math.PI * 1.6, Z1 = 0.28, W2 = 2 * Math.PI * 2.2, Z2 = 0.35;
  for (const t of tufts) {
    const cx = t.wx - originX, cy = t.gy;
    let target = 0, lt = 0;
    if (cx >= 8 && cx < CW - 8) {
      const v = sampleMax(cx, cy) / 255;
      target = smooth(clamp((v - 0.02) / 0.15, 0, 1));
      if (target > 0) {
        const slope = (sampleBlur(cx + 2, cy) - sampleBlur(cx - 2, cy)) / 4;
        lt = -clamp(slope * 140, -7, 7);
      }
    } else if (t.press === 0 && t.hold === 0 && t.lean === 0 && t.prevT === 0) continue;
    // hold: pressed instantly; once the trail has mostly faded (< 0.5) it lets go
    // completely over 0.08 s, and the spring below does the springy return
    if (target > t.prevT + 0.02 || (!t.rel && target >= t.hold)) { t.rel = false; t.hold = Math.max(t.hold, target); }
    if (!t.rel && target < 0.5 && target < t.hold) t.rel = true;
    if (t.rel) t.hold = Math.max(0, t.hold - DT / 0.08);
    t.prevT = target;
    if (!t.rel && t.hold >= t.press) { t.press = t.hold; t.pv = 0; }
    else {
      t.pv += (-W1 * W1 * (t.press - t.hold) - 2 * Z1 * W1 * t.pv) * DT; t.press += t.pv * DT;
      if (t.press < -0.18) { t.press = -0.18; t.pv = Math.max(0, t.pv); }
      if (Math.abs(t.press) < 0.002 && Math.abs(t.pv) < 0.01) { t.press = 0; t.pv = 0; }
    }
    t.lv += (-W2 * W2 * (t.lean - lt) - 2 * Z2 * W2 * t.lv) * DT; t.lean += t.lv * DT;
    if (Math.abs(t.lean) < 0.01 && Math.abs(t.lv) < 0.01 && lt === 0) { t.lean = 0; t.lv = 0; }
    if (target > 0.2 && Math.abs(lt) > 0.4) t.dir = lt > 0 ? 1 : -1;
  }
}

function step() {
  time += DT; stepCount++;
  dots = [];
  stepPlayer(); stepHares(); stepDucks(); stepFish();
  for (const d of extraDots) dots.push(d); extraDots.length = 0;
  if (pointer.down && pointer.y >= GT) dots.push({ x: camXi + pointer.x, y: pointer.y - GT, sx: 3.0, sy: 2.4, peak: 1.3 });

  // camera + trail origin (whole pixels, so the trail stays glued to the ground)
  const target = clamp(player.x - VW / 2 + player.facing * 22, 0, WW - VW);
  if (!(window.__lab && window.__lab.camLock)) cam += (target - cam) * Math.min(1, DT * 2.2);
  camXi = Math.round(cam);
  originX = camXi - MARGIN;
  const scroll = originX - lastOriginX; lastOriginX = originX;

  trailStep(dots, scroll);
  waterStep(scroll);
  stepTufts();

  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k]; p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT; p.vz -= p.g * DT; p.life -= DT;
    if (p.z < 0 || p.life <= 0) parts.splice(k, 1);
  }
  for (let k = clumps.length - 1; k >= 0; k--) {
    const c = clumps[k]; c.t += DT;
    if (c.t >= 3.2 / (c.size + 1)) { c.size--; c.t = 0; if (c.size <= 0) clumps.splice(k, 1); }
  }
}

// ---------------------------------------------------------------- background
const SKY = new Uint32Array(VW * GT);
const CLOUD_W = 2048, CLOUD_H = 50, CLOUD = new Uint8Array(CLOUD_W * CLOUD_H);
const stars = [];
const SKYC = { cloudL: C('#fbc6a2'), cloud: C('#d99fb2'), cloudD: C('#9f7fb3') };
const SUN = { x: 70, y: 47 };
function genSky() {
  const stops = [[0, '#121838'], [16, '#1f2a62'], [32, '#45468a'], [46, '#87609e'], [58, '#d27a91'], [67, '#f3a37f'], [75, '#ffd29a']].map(([y, c]) => [y, C(c)]);
  const at = y => { for (let k = 0; k < stops.length - 1; k++) { const [y0, c0] = stops[k], [y1, c1] = stops[k + 1]; if (y <= y1) return mix(c0, c1, (y - y0) / (y1 - y0)); } return stops[stops.length - 1][1]; };
  const K = 18, bands = []; for (let k = 0; k < K; k++) bands.push(at(k / (K - 1) * (GT - 1)));
  for (let y = 0; y < GT; y++) for (let x = 0; x < VW; x++) {
    const p = y / (GT - 1) * (K - 1), i = Math.floor(p), fr = p - i;
    let c = bands[Math.min(K - 1, fr > bayer(x, y) ? i + 1 : i)];
    // sun glow
    const d = Math.hypot(x - SUN.x, (y - SUN.y) * 1.05);
    if (d < 6.5) c = C('#fff4d6');
    else if (d < 8) c = C('#ffe3a8');
    else if (d < 30) { const g = Math.pow(1 - (d - 8) / 22, 2) * 0.55; c = mix(c, C('#ffd08f'), Math.round((g + bayer(x, y) * 0.12) * 6) / 6); }
    SKY[y * VW + x] = c;
  }
  for (let k = 0; k < 70; k++) stars.push({ x: (R() * VW) | 0, y: (R() * 30) | 0, p: R() * 6.28, b: R() });
  for (let y = 0; y < CLOUD_H; y++) for (let x = 0; x < CLOUD_W; x++) {
    const n = fbm2(x * 0.011, y * 0.11, 77);
    const band = Math.abs(y - 26) / 30, thr = 0.2 + band;
    if (n > thr) {
      const below = fbm2(x * 0.011, (y + 2) * 0.11, 77) > thr, above = fbm2(x * 0.011, (y - 2) * 0.11, 77) > thr;
      CLOUD[y * CLOUD_W + x] = !below ? 1 : !above ? 3 : 2;
    }
  }
}
const ridge = (w, s) => 1 - Math.abs(noise1(w, s));
const farTop = w => { const r = ridge(w * 0.011, 3), r2 = ridge(w * 0.03, 4); return 47 - r * r * 22 - r2 * 6; };
const nearTop = w => { const r = ridge(w * 0.016, 13), r2 = ridge(w * 0.05, 14); return 62 - r * r * 20 - r2 * 5; };
const snowiness = wx => clamp((ZONE.snowEnd + 60 - wx) / 140, 0, 1);
function forestTop(w) {
  let top = 71 + noise1(w * 0.1, 22) * 1.5;
  const i0 = Math.floor(w / 6);
  for (let i = i0 - 3; i <= i0 + 3; i++) {
    const cx = i * 6 + hash(i, 1, 30) * 4, Ht = 7 + hash(i, 2, 30) * 11;
    const y = 76 - Ht + Math.abs(w - cx) * 2.1;
    if (y < top) top = y;
  }
  return top;
}
function hedgeTop(w) {
  let top = 75;
  const i0 = Math.floor(w / 5);
  for (let i = i0 - 2; i <= i0 + 2; i++) {
    const cx = i * 5 + hash(i, 1, 40) * 3, Ht = 3 + hash(i, 2, 40) * 6, rr = 2.5 + hash(i, 3, 40) * 1.5;
    const dx = Math.abs(w - cx); if (dx > rr) continue;
    const y = 76 - Ht + (dx * dx) / (rr * rr) * Ht * 0.8; if (y < top) top = y;
  }
  return top;
}
const BG = {
  far: C('#7a76ad'), farL: C('#928dc2'), farCap: C('#dcd6f3'), farCapS: C('#b6afdd'),
  near: C('#4f5692'), nearL: C('#666fab'), nearCap: C('#c9d0f2'), nearCapS: C('#9aa6da'), haze: C('#6e6aa0'),
  forest: C('#28305f'), forestL: C('#36417a'), forestSnow: C('#9fade0'),
  hedge: C('#1c234a'), hedgeL: C('#29335f'), hedgeSnow: C('#8693c9'),
};
function renderBackground() {
  const co = Math.floor(cam * 0.05 + time * 1.2);
  for (let sx = 0; sx < VW; sx++) {
    const wF = sx + cam * 0.1, wN = sx + cam * 0.22, wT = sx + Math.floor(cam * 0.45), wH = sx + Math.floor(cam * 0.7);
    const fT = farTop(wF), fLit = farTop(wF + 1) < fT, fCap = 31 + noise1(wF * 0.12, 5) * 2;
    const nT = nearTop(wN), nLit = nearTop(wN + 1) < nT, nCap = 46 + noise1(wN * 0.1, 6) * 2;
    const tT = forestTop(wT), tL = forestTop(wT - 1);
    const hT = hedgeTop(wH);
    const sn = snowiness(camXi + sx);
    const cx = (sx + co) % CLOUD_W;
    for (let y = 0; y < GT; y++) {
      let c = SKY[y * VW + sx];
      if (y < CLOUD_H) { const cl = CLOUD[y * CLOUD_W + cx]; if (cl) c = cl === 1 ? SKYC.cloudL : cl === 2 ? SKYC.cloud : SKYC.cloudD; }
      if (y >= fT) c = y < fCap ? (fLit ? BG.farCap : BG.farCapS) : (fLit ? BG.farL : BG.far);
      if (y >= nT) {
        c = y < nCap ? (nLit ? BG.nearCap : BG.nearCapS) : (nLit ? BG.nearL : BG.near);
        if (y > 63 && (y - 63) / 9 > bayer(sx, y)) c = BG.haze;
      }
      if (y >= tT) c = (y < tT + 1.5 && sn > hash(sx + Math.floor(cam * 0.45), 0, 31)) ? BG.forestSnow : (tL > tT ? BG.forestL : BG.forest);
      if (y >= hT) c = (y < hT + 1 && sn > 0.3) ? BG.hedgeSnow : (y < hT + 1.5 ? BG.hedgeL : BG.hedge);
      buf[y * VW + sx] = c;
    }
  }
  for (const s of stars) {
    const k = s.y * VW + s.x; if (buf[k] !== SKY[k]) continue;
    const tw = Math.sin(time * 1.7 + s.p) * 0.5 + 0.5;
    if (tw * s.b > 0.25) buf[k] = mix(buf[k], C('#f2eeff'), 0.35 + 0.5 * tw * s.b);
  }
}

// ---------------------------------------------------------------- ground
function renderGround() {
  const tr = trailA;
  const sunL = SUN.x - 7, sunR = SUN.x + 7;
  for (let gy = 0; gy < GH; gy++) {
    const row = (GT + gy) * VW;
    for (let sx = 0; sx < VW; sx++) {
      const wx = camXi + sx, wi = gy * WW + wx, ci = gy * CW + sx + MARGIN;
      const t = terr[wi], v = tr[ci];
      let c;
      if (t === T_SNOW) {
        const dent = v >= SNOW_DENT;
        const dentA = gy > 0 && terr[wi - WW] === T_SNOW && tr[ci - CW] >= SNOW_DENT;
        if (dent) {
          const deep = v >= SNOW_DEEP;
          const dentL = wx > 0 && terr[wi - 1] === T_SNOW && tr[ci - 1] >= SNOW_DENT;
          const deepA = gy > 0 && terr[wi - WW] === T_SNOW && tr[ci - CW] >= SNOW_DEEP;
          c = deep ? PAL.deep : PAL.inside;
          if (!dentL) c = PAL.deep;
          if (deep && !deepA && dentA) c = PAL.wall;
          if (!dentA) c = PAL.wall;
        } else if (dentA) c = PAL.lip;
        else {
          c = groundBase[wi];
          const sp = sparkle[wi];
          if (sp && Math.sin(time * 2.3 + sp * 0.1) > 0.86) c = PAL.lip;
        }
      } else if (t === T_WATER) {
        const d = shoreDist[wi];
        let k = d <= 3 ? 2 : d <= 10 ? 3 : d <= 24 ? 4 : 5;
        if (gy < 10) k = Math.max(3, k);
        if (hash(gy, Math.floor((wx + time * ((gy & 1) ? 5 : -4)) / 7), 9) < 0.06) k--;
        const m = wmark[ci];
        if (m === 1) c = PAL.water[0];
        else {
          if (m === 2) k++;
          c = PAL.water[k];
          // sun reflection column
          const spread = 2 + gy * 0.12;
          if (sx > sunL - spread && sx < sunR + spread && hash(gy, Math.floor((wx * 0.5 + time * 3) / 3), 19) < 0.2 - Math.abs(sx - SUN.x) / 50) c = m === 2 ? PAL.sunRef2 : PAL.sunRef;
          if (d === 1 && Math.sin(time * 2.2 + wx * 0.35 + gy * 0.7) > 0.5) c = PAL.foam;
        }
      } else if (t === T_SAND) {
        c = groundBase[wi];
        if (v >= SNOW_DENT) { const wet = landDist[wi] <= 3; c = v >= SNOW_DEEP ? (wet ? PAL.wetDeep : PAL.sandDeep) : (wet ? PAL.wetPrint : PAL.sandPrint); }
      } else if (t === T_GRASS) {
        c = groundBase[wi]; if (v >= 50) c = mul(c, v >= 120 ? 0.74 : 0.84);
      } else {
        c = groundBase[wi]; if (v >= 120) c = mul(c, 0.8);
      }
      if (showMap && v > 0) c = mix(c, PAL.map, v / 255 * 0.75);
      buf[row + sx] = c;
    }
  }
  // lily pads ride the waves
  for (const l of lilies) {
    const sx = l.x - camXi; if (sx < -6 || sx > VW + 6) continue;
    const ci = l.y * CW + clamp(sx + MARGIN, 0, CW - 1), h = wh[ci];
    const oy = h > 0.04 ? -1 : h < -0.04 ? 1 : 0;
    const sy = GT + l.y + oy, g = C('#4f8f3e'), gl = C('#74b24f'), gd = C('#2f6430');
    for (let x = -l.s; x <= l.s; x++) { pset(sx + x, sy, x === 1 ? gd : g); if (Math.abs(x) < l.s) pset(sx + x, sy - 1, x < 0 ? gl : g); }
    pset(sx + 1, sy - 1, PAL.water[3]);
    if (l.flower) { pset(sx - 1, sy - 2, l.flower); pset(sx, sy - 2, l.flower); pset(sx, sy - 3, l.flower); pset(sx - 1, sy - 1, C('#f4d35e')); }
  }
  // snow clumps knocked off the boots
  for (const c of clumps) {
    const sx = c.x - camXi, sy = GT + c.y;
    if (c.size >= 3) { pset(sx - 1, sy - 1, PAL.lip); pset(sx, sy - 1, PAL.snowHi); pset(sx + 1, sy - 1, PAL.snow); pset(sx - 1, sy, PAL.snow); pset(sx, sy, PAL.inside); pset(sx + 1, sy, PAL.deep); }
    else if (c.size === 2) { pset(sx, sy - 1, PAL.lip); pset(sx + 1, sy - 1, PAL.snow); pset(sx, sy, PAL.inside); pset(sx + 1, sy, PAL.deep); }
    else pset(sx, sy, PAL.snow);
  }
}
function pset(x, y, c) { if (x >= 0 && y >= 0 && x < VW && y < VH) buf[y * VW + x] = c; }
function shadow(x, y, rx, ry, f = 0.78) {
  for (let oy = -Math.ceil(ry); oy <= Math.ceil(ry); oy++) for (let ox = -Math.ceil(rx); ox <= Math.ceil(rx); ox++) {
    if ((ox * ox) / (rx * rx) + (oy * oy) / (ry * ry) > 1) continue;
    const sx = x + ox, sy = y + oy; if (sx < 0 || sx >= VW || sy < GT || sy >= VH) continue;
    buf[sy * VW + sx] = mul(buf[sy * VW + sx], f);
  }
}

// ---------------------------------------------------------------- objects
function drawTuft(t) {
  const sx0 = t.wx - camXi, sy0 = GT + t.gy;
  const press = t.press, Hh = t.h * (1 - 0.45 * press);
  const wind = (t.kind === 'reed' ? 1.2 : 0.7) * Math.sin(time * 1.8 + t.wx * 0.07 + t.ph * 0.3) + 0.3 * Math.sin(time * 3.3 + t.ph);
  const fwd = Math.max(0, press) * 5 * t.dir;
  const dark = press > 0.5 ? 1 : 0;
  const ramp = t.ramp;
  for (const b of t.blades) {
    const bh = Math.max(1, Math.round(Hh * b.hm));
    const sh = (b.back ? 1 : 0) + dark;
    for (let k = 0; k < bh; k++) {
      const u = (k + 1) / bh, u2 = u * u;
      const x = Math.round(sx0 + b.dx + (t.lean + b.curl + wind) * u2 + fwd * u);
      const y = sy0 - k;
      let ci = u < 0.35 ? 3 : u < 0.72 ? 2 : 1;
      if (k === bh - 1) ci = 0;
      pset(x, y, ramp[Math.min(5, ci + sh)]);
    }
    if (t.kind === 'reed' && !b.back && bh > 8) { // cattail head
      const x = Math.round(sx0 + b.dx + (t.lean + fwd + b.curl + wind)), y = sy0 - bh;
      pset(x, y, C('#6b3f26')); pset(x, y + 1, C('#6b3f26')); pset(x, y + 2, C('#4a2a18'));
    }
  }
  if (t.flower && press < 0.5) {
    const b = t.blades[t.blades.length - 1], bh = Math.max(1, Math.round(Hh * b.hm));
    const x = Math.round(sx0 + b.dx + (t.lean + fwd + b.curl + wind)), y = sy0 - bh;
    pset(x, y, t.flower); pset(x - 1, y, t.flower); pset(x + 1, y, t.flower); pset(x, y - 1, t.flower); pset(x, y, C('#f6e08a'));
  }
}

function renderObjects() {
  const list = [];
  const L = camXi - 24, Rr = camXi + VW + 24;
  for (const t of tufts) if (t.wx > L && t.wx < Rr) list.push({ y: t.gy, k: 0, o: t });
  for (const p of props) if (p.wx > L - 20 && p.wx < Rr + 20) list.push({ y: p.gy, k: 1, o: p });
  for (const h of hares) if (h.x > L && h.x < Rr) list.push({ y: h.y, k: 2, o: h });
  for (const d of ducks) if (d.x > L && d.x < Rr) list.push({ y: d.y, k: 3, o: d });
  for (const f of fishes) list.push({ y: f.y, k: 4, o: f });
  if (!(window.__lab && window.__lab.ghost)) list.push({ y: player.y, k: 5, o: player });
  list.sort((a, b) => a.y - b.y);

  // contact shadows first (under grass)
  for (const h of hares) shadow(Math.round(h.x - camXi), GT + Math.round(h.y), 3, 1.2, 0.85 + h.z * 0.02);
  if (!(window.__lab && window.__lab.ghost) && terrAt(player.x, player.y) !== T_WATER) shadow(Math.round(player.x - camXi), GT + Math.round(player.y), 4.5, 1.6);
  for (const p of props) if (p.wx > L && p.wx < Rr) shadow(p.wx - camXi + 2, GT + p.gy, p.spr.w * 0.42, 1.6, 0.82);

  for (const e of list) {
    const o = e.o;
    if (e.k === 0) drawTuft(o);
    else if (e.k === 1) blit(o.spr, o.wx - camXi, GT + o.gy, o.ax, o.ay, false);
    else if (e.k === 2) blit(HARE[o.hop >= 0 ? 1 : 0], Math.round(o.x - camXi), GT + Math.round(o.y - o.z), 6, 10, o.facing < 0);
    else if (e.k === 3) {
      const bobY = Math.sin(time * 2 + o.ang) > 0.3 ? 1 : 0, wl = GT + Math.round(o.y);
      blit(DUCK[o.dip > 0.15 && o.dip < 0.7 ? 1 : 0], Math.round(o.x - camXi), wl + 1 + bobY, 7, 9, o.facing < 0, wl, time + o.ang);
    } else if (e.k === 4) {
      const z = Math.sin(o.t * Math.PI) * 13;
      blit(FISH, Math.round(o.x - camXi), GT + Math.round(o.y - z), 3, 2, o.dir < 0);
    } else {
      const s = buildPlayer(o.frame, o.moving, time);
      const sink = Math.round(o.sink), wl = GT + Math.round(o.y);
      blit(s, Math.round(o.x - camXi), wl + sink, 11, 26, o.facing < 0, sink > 0 ? wl : -1, time);
    }
  }
}

// ---------------------------------------------------------------- particles / weather
const flakes = [];
for (let k = 0; k < 170; k++) flakes.push({ x: R() * VW, y: R() * VH, l: R() < 0.2 ? 2 : R() < 0.5 ? 1 : 0, p: R() * 6.28, h: R() });
const flies = [];
for (let k = 0; k < 36; k++) flies.push({ x: 780 + R() * 550, y: 6 + R() * 94, z: 3 + R() * 12, p: R() * 6.28, s: 0.5 + R() });
let lastCam = 0;
function renderParticles() {
  for (const p of parts) pset(Math.round(p.x - camXi), GT + Math.round(p.y - p.z), p.c);
  // fireflies over the meadow
  for (const f of flies) {
    const x = f.x + Math.sin(time * 0.4 * f.s + f.p) * 14, y = f.y + Math.sin(time * 0.33 + f.p * 2) * 5, z = f.z + Math.sin(time * 1.1 + f.p) * 3;
    const sx = Math.round(x - camXi), sy = GT + Math.round(y - z); if (sx < 1 || sx >= VW - 1 || sy < 1 || sy >= VH - 1) continue;
    const br = Math.sin(time * 2.4 * f.s + f.p * 3);
    if (br < -0.2) continue;
    const k = sy * VW + sx;
    buf[k] = mix(buf[k], C('#fff7b0'), 0.6 + 0.4 * br);
    if (br > 0.4) for (const o of [-1, 1, -VW, VW]) buf[k + o] = mix(buf[k + o], C('#d8ec70'), 0.35 * br);
  }
  // snowfall (screen space with parallax)
  const dc = cam - lastCam; lastCam = cam;
  if (snowfall) for (const f of flakes) {
    const sp = [10, 16, 26][f.l];
    f.y += sp / 60; f.x += Math.sin(time * 1.3 + f.p) * 0.12 - dc * [0.4, 0.7, 1.1][f.l] - 0.08;
    if (f.y > VH) { f.y = -2; f.x = R() * VW; } if (f.x < 0) f.x += VW; if (f.x >= VW) f.x -= VW;
    const sx = f.x | 0, sy = f.y | 0;
    if (snowiness(camXi + sx) < f.h) continue;
    const c = f.l === 0 ? C('#c9d3f2') : C('#ffffff');
    pset(sx, sy, c); if (f.l === 2) { pset(sx + 1, sy, c); pset(sx, sy + 1, c); pset(sx + 1, sy + 1, C('#dfe6ff')); }
  }
}

// ---------------------------------------------------------------- UI previews
const tv = $('trailView').getContext('2d'), wvx = $('waveView').getContext('2d');
const tImg = tv.createImageData(CW, CH), wImg = wvx.createImageData(CW, CH);
function updatePreviews() {
  const a = tImg.data, b = wImg.data;
  for (let i = 0; i < CW * CH; i++) {
    const v = trailA[i], cx = i % CW, edge = cx === MARGIN || cx === MARGIN + VW - 1;
    a[i * 4] = edge ? 255 : v; a[i * 4 + 1] = edge ? 211 : v; a[i * 4 + 2] = edge ? 156 : v; a[i * 4 + 3] = 255;
    if (!cWater[i]) { b[i * 4] = 18; b[i * 4 + 1] = 20; b[i * 4 + 2] = 40; }
    else {
      const h = clamp(wh[i] * 6, -1, 1);
      if (h >= 0) { b[i * 4] = 30 + 120 * h; b[i * 4 + 1] = 60 + 190 * h; b[i * 4 + 2] = 90 + 160 * h; }
      else { b[i * 4] = 30 - 220 * h; b[i * 4 + 1] = 60 - 90 * h; b[i * 4 + 2] = 90 + 30 * h; }
      if (wmark[i] === 1) { b[i * 4] = 230; b[i * 4 + 1] = 250; b[i * 4 + 2] = 255; }
    }
    if (edge) { b[i * 4] = 255; b[i * 4 + 1] = 211; b[i * 4 + 2] = 156; }
    b[i * 4 + 3] = 255;
  }
  tv.putImageData(tImg, 0, 0); wvx.putImageData(wImg, 0, 0);
}

let zoneName = '';
function updateZone() {
  const x = player.x;
  const z = x < ZONE.snowEnd + 30 ? 'snow' : x < ZONE.grassEnd + 10 ? 'grass' : 'water';
  if (z === zoneName) return; zoneName = z;
  $('zone').innerHTML = {
    snow: 'SNOWFIELD<small>値 ≥ 90 でへこみ / ≥ 166 で深いへこみ</small>',
    grass: 'MEADOW<small>11×8px の最大値で草が倒れ、勾配で傾く</small>',
    water: 'LAKESHORE<small>新規ペイント ≥ 64 が波源になる</small>',
  }[z];
}

// ---------------------------------------------------------------- main loop
function render() {
  renderBackground();
  renderGround();
  renderObjects();
  renderParticles();
  ctx.putImageData(img, 0, 0);
}
function fit() {
  const s = Math.max(1, Math.floor(Math.min((innerWidth - 24) / VW, (innerHeight - 140) / VH)));
  const sc = Math.max(2, s);
  canvas.style.width = VW * sc + 'px'; canvas.style.height = VH * sc + 'px';
}
addEventListener('resize', fit);

genTerrain(); genSky(); placeProps(); spawnCritters();
cam = clamp(player.x - VW / 2, 0, WW - VW); camXi = Math.round(cam); lastCam = cam;
originX = lastOriginX = camXi - MARGIN;
fit(); apNext(); updateZone();

let acc = 0, last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now; if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  if (window.__lab && window.__lab.paused) acc = 0;
  while (acc >= DT && n < 5) { step(); acc -= DT; n++; }
  if (n) { render(); if (stepCount % 2 === 0) updatePreviews(); updateZone(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// debug hook: advance the sim by n fixed steps (handy when rAF is throttled)
window.__lab = {
  paused: false, player, keys, hares, ducks, fishes, tufts, parts, clumps, warp, setAuto, step, render, buildPlayer, HARE, DUCK, props,
  get trail() { return trailA; }, get newPaint() { return newPaint; }, get wh() { return wh; }, wmark, cWater,
  get originX() { return originX; }, get camXi() { return camXi; }, get time() { return time; },
  setCam(x) { cam = x; camXi = Math.round(x); },
  addDot(d) { extraDots.push(d); },
  buf, img, terr, shoreDist, consts: { VW, VH, GT, GH, CW, CH, MARGIN, WW, T_SNOW, T_GRASS, T_WATER, T_SAND, T_DIRT },
  setFade(v) { FADE = v; }, resetTrails, set showMap(v) { showMap = v; }, set snowfall(v) { snowfall = v; },
  tick(n) { for (let k = 0; k < n; k++) step(); render(); updatePreviews(); updateZone(); },
};
})();
