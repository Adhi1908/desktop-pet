#!/usr/bin/env node
'use strict';

// Generates placeholder art so the app runs before real art exists:
//   <sprite.path in config.json>         sprite sheet laid out from config.json (one row per animation)
//   assets/tray.png, assets/tray@2x.png  tray icon
//   build/icon.png                       256x256 app icon for electron-builder
// Existing files are kept unless --force is passed, so real art is never overwritten.
//
// Usage: node scripts/generate-placeholder-sprites.js [--force] [--quiet]

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const force = process.argv.includes('--force');
const quiet = process.argv.includes('--quiet');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// ---- minimal RGBA bitmap + PNG encoder (no dependencies) ----------------------

function createBitmap(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // every row starts with filter byte 0
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function upscale(src, k) {
  const out = createBitmap(src.width * k, src.height * k);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = (Math.floor(y / k) * src.width + Math.floor(x / k)) * 4;
      src.data.copy(out.data, (y * out.width + x) * 4, from, from + 4);
    }
  }
  return out;
}

// Draws into one cell of a bitmap on a fixed design grid (32x32 for the pet, 16x16 for icons),
// scaled to the cell size and clipped to it so nothing bleeds into neighbouring frames.
class Painter {
  constructor(bmp, cellX, cellY, cellW, cellH, grid) {
    Object.assign(this, { bmp, cellX, cellY, cellW, cellH });
    this.sx = cellW / grid;
    this.sy = cellH / grid;
  }

  offset(px, py) {
    return ((this.cellY + py) * this.bmp.width + this.cellX + px) * 4;
  }

  rect(x, y, w, h, color) {
    const x0 = Math.max(0, Math.round(x * this.sx));
    const x1 = Math.min(this.cellW, Math.round((x + w) * this.sx));
    const y0 = Math.max(0, Math.round(y * this.sy));
    const y1 = Math.min(this.cellH, Math.round((y + h) * this.sy));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.bmp.data.set(color, this.offset(px, py));
    }
  }

  // 1px outline around everything drawn so far, so the pet reads on any wallpaper.
  outline(color) {
    const { cellW, cellH } = this;
    const solid = (px, py) =>
      px >= 0 && py >= 0 && px < cellW && py < cellH && this.bmp.data[this.offset(px, py) + 3] > 0;
    const edge = [];
    for (let py = 0; py < cellH; py++) {
      for (let px = 0; px < cellW; px++) {
        if (!solid(px, py) && (solid(px - 1, py) || solid(px + 1, py) || solid(px, py - 1) || solid(px, py + 1))) {
          edge.push([px, py]);
        }
      }
    }
    for (const [px, py] of edge) this.bmp.data.set(color, this.offset(px, py));
  }
}

// ---- the placeholder creature (32x32 design grid, facing right) ----------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(255);
const shade = ([r, g, b, a], f) => [r, g, b].map((v) => Math.min(255, Math.round(v * f))).concat(a);

const INK = hex('#1b1b2f');
const WHITE = hex('#ffffff');
const GOLD = hex('#ffd166');
const BOWL = hex('#3a86ff');
const FOOD = hex('#8d5524');
const TEAR = hex('#4cc9f0');

// A distinct colour per row makes it obvious which animation is playing.
const COLORS = {
  idle: '#f4a261',
  walk: '#2a9d8f',
  run: '#e76f51',
  sit: '#8ab17d',
  sleep: '#7b8cde',
  excited: '#f9c74f',
  dragged: '#c77dff',
  fall: '#4cc9f0',
  eat: '#f8961e',
  sad: '#8d99ae',
};
const EXTRA_COLORS = ['#ff6b9d', '#06d6a0', '#f15bb5', '#577590', '#43aa8b'];

function eye(p, x, y, kind) {
  if (kind === 'closed') {
    p.rect(x, y + 2, 3, 1, INK);
  } else if (kind === 'wide') {
    p.rect(x, y, 3, 3, INK);
    p.rect(x + 1, y, 1, 1, WHITE);
  } else {
    p.rect(x, y, 2, 3, INK);
  }
}

function sparkle(p, x, y) {
  p.rect(x - 1, y, 3, 1, GOLD);
  p.rect(x, y - 1, 1, 3, GOLD);
}

// bob moves the body (legs stretch to keep the feet planted); air lifts the whole pet.
function standing(p, c, opts = {}) {
  const { bob = 0, air = 0, lift = [0, 0, 0, 0], shift = [0, 0, 0, 0], eyes = 'open', tail = 0, mouth = false } = opts;
  const dark = shade(c, 0.72);
  const at = (y) => y + bob - air;
  p.rect(2, at(13) + tail, 4, 3, dark); // tail
  [7, 11, 17, 21].forEach((x, i) => {
    const top = at(24);
    p.rect(x + shift[i], top, 3, 32 - air - lift[i] - top, dark); // legs
  });
  p.rect(6, at(15), 18, 10, c); // body
  p.rect(16, at(8), 13, 10, c); // head
  p.rect(17, at(5), 4, 3, dark); // ears
  p.rect(25, at(5), 4, 3, dark);
  eye(p, 24, at(11), eyes);
  if (mouth) p.rect(27, at(14), 2, 2, INK);
}

// Used for tricks and any animation name the generator doesn't know.
function genericFrame(p, c, i, n) {
  const angle = (i / n) * Math.PI * 2;
  standing(p, c, { bob: i % 2 ? -1 : 0, eyes: i % 3 === 2 ? 'closed' : 'wide', mouth: i % 2 === 0, tail: i % 2 ? -2 : 0 });
  sparkle(p, Math.round(16 + Math.cos(angle) * 13), Math.round(14 + Math.sin(angle) * 10));
}

const ANIMATIONS = {
  idle(p, c, i, n) {
    standing(p, c, { bob: i % 4 >= 2 ? -1 : 0, eyes: i === n - 1 ? 'closed' : 'open', tail: i % 2 ? -1 : 0 });
  },

  walk(p, c, i, n) {
    const s = Math.sin((i / n) * Math.PI * 2);
    const a = s > 0.3 ? 2 : 0;
    const b = s < -0.3 ? 2 : 0;
    standing(p, c, { bob: Math.abs(s) > 0.5 ? -1 : 0, lift: [a, b, b, a], shift: [a / 2, b / 2, b / 2, a / 2], tail: i % 2 ? -1 : 0 });
  },

  run(p, c, i, n) {
    const s = Math.round(Math.sin((i / n) * Math.PI * 2) * 2);
    const lift = i % 2 ? [2, 0, 0, 2] : [0, 2, 2, 0];
    standing(p, c, { bob: i % 2 ? -2 : -1, lift, shift: [s, -s, s, -s], tail: -2, eyes: 'wide' });
    p.rect(0, 17 + (i % 2), 3, 1, WHITE); // speed lines
    p.rect(0, 21 - (i % 2), 4, 1, WHITE);
  },

  sit(p, c, i, n) {
    const dark = shade(c, 0.72);
    const nod = i === 2 ? 1 : 0;
    p.rect(1 + (i % 2), 27, 6, 3, dark); // tail swishing on the floor
    p.rect(6, 16, 15, 16, c); // upright body
    p.rect(15, 24, 3, 8, dark); // front legs
    p.rect(19, 24, 3, 8, dark);
    p.rect(13, 8 + nod, 13, 10, c); // head
    p.rect(14, 5 + nod, 4, 3, dark);
    p.rect(22, 5 + nod, 4, 3, dark);
    eye(p, 21, 11 + nod, i === n - 1 ? 'closed' : 'open');
  },

  sleep(p, c, i) {
    const dark = shade(c, 0.72);
    const breathe = i % 2;
    p.rect(4, 23 - breathe, 20, 9 + breathe, c); // curled-up body
    p.rect(1, 28, 7, 3, dark); // tail wrapped around
    p.rect(18, 21, 11, 11, c); // head resting on the floor
    p.rect(19, 18, 4, 3, dark);
    p.rect(25, 18, 4, 3, dark);
    eye(p, 23, 24, 'closed');
  },

  excited(p, c, i) {
    const air = [0, 2, 3, 2][i % 4];
    standing(p, c, { air, lift: air ? [2, 2, 2, 2] : [0, 0, 0, 0], eyes: 'wide', mouth: true, tail: -2 });
    sparkle(p, i % 2 ? 4 : 29, i % 2 ? 6 : 3);
  },

  dragged(p, c, i) {
    const sway = [-1, 0, 1, 0][i % 4];
    standing(p, c, { air: 3, lift: [-2, -2, -2, -2], shift: [sway, sway, sway, sway], eyes: 'wide', mouth: true, tail: 2 });
  },

  fall(p, c, i) {
    const flail = i % 2;
    standing(p, c, {
      air: 2,
      lift: [1 + flail, 2 - flail, 2 - flail, 1 + flail],
      shift: [-2, -1, 1, 2],
      eyes: 'wide',
      mouth: true,
      tail: -3,
    });
  },

  eat(p, c, i) {
    const dark = shade(c, 0.72);
    const chomp = i % 2;
    p.rect(2, 13 - chomp, 4, 3, dark); // tail wagging
    [7, 11, 17, 21].forEach((x) => p.rect(x, 24, 3, 8, dark));
    p.rect(6, 15, 18, 10, c); // body
    p.rect(17, 13 + chomp, 12, 10, c); // head dipped into the bowl
    p.rect(18, 10 + chomp, 4, 3, dark);
    p.rect(25, 10 + chomp, 4, 3, dark);
    eye(p, 24, 15 + chomp, 'closed');
    p.rect(24, 25 + chomp, 6, 2, FOOD);
    p.rect(22, 27, 10, 5, BOWL);
  },

  sad(p, c, i) {
    const dark = shade(c, 0.72);
    p.rect(1, 29, 6, 2, dark); // tail flat on the floor
    p.rect(6, 17, 15, 15, c); // slumped body
    p.rect(15, 25, 3, 7, dark);
    p.rect(19, 25, 3, 7, dark);
    p.rect(13, 10, 13, 10, c); // head hanging low
    p.rect(11, 11, 3, 2, dark); // drooping ears
    p.rect(25, 11, 3, 2, dark);
    p.rect(20, 14, 3, 1, INK); // downcast eye
    if (i >= 2) p.rect(21, 15 + (i - 2) * 2, 1, 2, TEAR);
  },
};

function buildSheet(sprite) {
  const anims = Object.entries(sprite.animations);
  const { frameWidth: fw, frameHeight: fh } = sprite;
  const cols = Math.max(...anims.map(([, a]) => (a.col ?? 0) + a.frames));
  const rows = Math.max(...anims.map(([, a]) => a.row)) + 1;
  const sheet = createBitmap(cols * fw, rows * fh);

  let extra = 0;
  for (const [name, anim] of anims) {
    const color = hex(COLORS[name] ?? EXTRA_COLORS[extra++ % EXTRA_COLORS.length]);
    const draw = ANIMATIONS[name] ?? genericFrame;
    for (let i = 0; i < anim.frames; i++) {
      const p = new Painter(sheet, ((anim.col ?? 0) + i) * fw, anim.row * fh, fw, fh, 32);
      draw(p, color, i, anim.frames);
      p.outline(INK);
    }
  }
  return sheet;
}

function buildIcon() {
  const icon = createBitmap(16, 16);
  const p = new Painter(icon, 0, 0, 16, 16, 16);
  const c = hex(COLORS.idle);
  const dark = shade(c, 0.72);
  p.rect(2, 2, 4, 3, dark); // ears
  p.rect(10, 2, 4, 3, dark);
  p.rect(1, 4, 14, 10, c); // head
  p.rect(4, 7, 2, 3, INK); // eyes
  p.rect(10, 7, 2, 3, INK);
  p.rect(7, 10, 2, 1, dark); // nose
  p.outline(INK);
  return icon;
}

// ---- write files ------------------------------------------------------------------

const icon = buildIcon();
const outputs = [
  [config.sprite.path, () => buildSheet(config.sprite)],
  ['assets/tray.png', () => icon],
  ['assets/tray@2x.png', () => upscale(icon, 2)],
  ['build/icon.png', () => upscale(icon, 16)],
];

for (const [relPath, build] of outputs) {
  const file = path.join(ROOT, relPath);
  if (fs.existsSync(file) && !force) {
    if (!quiet) console.log(`kept   ${relPath} (already exists; use --force to overwrite)`);
    continue;
  }
  const bmp = build();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(bmp));
  console.log(`wrote  ${relPath} (${bmp.width}x${bmp.height})`);
}
