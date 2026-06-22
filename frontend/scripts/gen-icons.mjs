// Dependency-free PWA icon generator.
// Renders "162" in Airbnb-pink on a white background as vector strokes
// (line segments + circular arcs) with 4x supersampled anti-aliasing,
// then encodes PNGs by hand via Node's built-in zlib. No native deps.
//
//   node scripts/gen-icons.mjs          → writes the real icons to public/
//   node scripts/gen-icons.mjs --test   → also writes a 256px preview to scripts/
//
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '../public');

const PINK = [255, 90, 95];
const WHITE = [255, 255, 255];

// --- Glyph geometry (coords in "em" units; y grows downward) -----------------
// Each digit is a list of strokes. Segments: {seg:[ax,ay,bx,by]}.
// Arcs: {arc:[cx,cy,r,a0deg,a1deg]} swept a0→a1 (degrees, y-down: top=-90).
const HW = 0.115; // stroke half-width, em
const GLYPHS = {
  '1': {
    w: 0.62,
    strokes: [
      { seg: [0.52, 0.06, 0.52, 0.94] }, // stem
      { seg: [0.24, 0.30, 0.52, 0.06] }, // top flag
      { seg: [0.24, 0.94, 0.82, 0.94] }, // base serif
    ],
  },
  '6': {
    w: 0.74,
    strokes: [
      { arc: [0.40, 0.67, 0.27, 0, 360] }, // bowl (closed loop)
      { arc: [0.78, 0.62, 0.66, 198, 250] }, // tail sweeping up to top
    ],
  },
  '2': {
    w: 0.72,
    strokes: [
      { arc: [0.38, 0.32, 0.29, 165, 372] }, // top bowl, over the top to the right
      { seg: [0.654, 0.355, 0.16, 0.92] }, // diagonal down to bottom-left
      { seg: [0.13, 0.92, 0.74, 0.92] }, // base
    ],
  },
};

function distToSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy || 1e-9;
  let t = (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function distToArc(px, py, cx, cy, r, a0, a1) {
  const ang = Math.atan2(py - cy, px - cx); // radians, y-down
  let lo = (a0 * Math.PI) / 180, hi = (a1 * Math.PI) / 180;
  // Normalize sweep lo→hi (a1 may exceed a0 by >360 conceptually); test membership.
  let a = ang;
  while (a < lo) a += Math.PI * 2;
  if (a <= hi) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  // Outside the sweep → nearest endpoint
  const e0x = cx + r * Math.cos(lo), e0y = cy + r * Math.sin(lo);
  const e1x = cx + r * Math.cos(hi), e1y = cy + r * Math.sin(hi);
  return Math.min(Math.hypot(px - e0x, py - e0y), Math.hypot(px - e1x, py - e1y));
}

// Min distance from an em-space point to the whole "162" string.
function distToText(px, py, layout) {
  let best = Infinity;
  for (const d of layout) {
    for (const s of d.strokes) {
      let dist;
      if (s.seg) dist = distToSeg(px, py, s.seg[0] + d.ox, s.seg[1], s.seg[2] + d.ox, s.seg[3]);
      else dist = distToArc(px, py, s.arc[0] + d.ox, s.arc[1], s.arc[2], s.arc[3], s.arc[4]);
      if (dist < best) best = dist;
    }
  }
  return best;
}

function layoutText(text) {
  const gap = 0.12;
  let cursor = 0;
  const out = [];
  for (const ch of text) {
    const g = GLYPHS[ch];
    out.push({ ...g, ox: cursor });
    cursor += g.w + gap;
  }
  const totalW = cursor - gap;
  return { layout: out, totalW };
}

// Rounded-rect coverage (1 inside, 0 outside) in normalized 0..1 canvas coords.
function inRoundRect(x, y, radius) {
  const r = radius;
  const qx = Math.max(r - x, x - (1 - r), 0);
  const qy = Math.max(r - y, y - (1 - r), 0);
  return Math.hypot(qx, qy) <= r;
}

function renderIcon(size, { rounded, widthFrac }) {
  const SS = 4; // supersampling
  const { layout, totalW } = layoutText('162');
  // "162" is wide → fit by width. em = digit height in px.
  const em = (size * widthFrac) / totalW;
  const tx = (size - totalW * em) / 2;    // left of text block, px
  const ty = (size - em) / 2;             // top of text block, px
  const radius = 0.22;                    // rounded-corner radius (fraction)

  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          // background
          const inBg = rounded ? inRoundRect(fx / size, fy / size, radius) : true;
          if (!inBg) continue; // transparent outside the rounded square
          // foreground digits
          const emx = (fx - tx) / em;
          const emy = (fy - ty) / em;
          const inFg = distToText(emx, emy, layout) <= HW;
          const col = inFg ? PINK : WHITE;
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

// --- Minimal RGBA PNG encoder ------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // rows with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Emit --------------------------------------------------------------------
function write(path, size, opts) {
  writeFileSync(path, encodePNG(renderIcon(size, opts), size));
  console.log('wrote', path);
}

mkdirSync(PUBLIC, { recursive: true });
write(resolve(PUBLIC, 'icon-192.png'), 192, { rounded: true, widthFrac: 0.80 });
write(resolve(PUBLIC, 'icon-512.png'), 512, { rounded: true, widthFrac: 0.80 });
// Maskable: full-bleed white square, digits kept inside the ~80% safe zone.
write(resolve(PUBLIC, 'icon-maskable-512.png'), 512, { rounded: false, widthFrac: 0.64 });
// iOS apple-touch-icon: full square (iOS applies its own rounding).
write(resolve(PUBLIC, 'apple-touch-icon.png'), 180, { rounded: false, widthFrac: 0.80 });

if (process.argv.includes('--test')) {
  write(resolve(__dirname, 'preview-162.png'), 256, { rounded: true, widthFrac: 0.80 });
}
