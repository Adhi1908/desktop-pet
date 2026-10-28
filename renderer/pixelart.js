// Tiny pixel-art pieces (hats, the Halloween pumpkin) drawn from character maps, with the same dark
// outline as the placeholder pet. Hats are drawn facing right and sit on the sprite's hatAnchor.

const OUTLINE = '#1b1b2f';

// A row from runs of [character, count], so wide pieces don't need hand-counted strings.
const row = (...runs) => runs.map(([ch, n]) => ch.repeat(n)).join('');

export const HATS = {
  nightcap: {
    palette: { b: '#4361ee', w: '#ffffff' },
    rows: ['.........ww', '......bbbww', '....bbbbb..', '...bbbbbb..', '..bbbbbbb..', '.wwwwwwwww.', '.wwwwwwwww.'],
  },
  bow: {
    palette: { p: '#ff6b9d', l: '#ffa3c4', k: '#c9184a' },
    rows: ['pp...pp', 'plp.plp', 'pllkllp', 'plp.plp', 'pp...pp'],
  },
  cap: {
    palette: { b: '#3a86ff', d: '#2667cc', w: '#ffffff' },
    rows: ['..bbbbb....', '.bbbwbbb...', '.bbbbbbbb..', '.dddddddddd'],
  },
  flower: {
    palette: { w: '#ffffff', y: '#ffd166', g: '#2a9d8f' },
    rows: ['.w.w.', 'wwyww', '.w.w.', '..g..'],
  },
  party: {
    palette: { r: '#e63946', y: '#ffd166', w: '#ffffff' },
    rows: ['...w...', '...r...', '..ryr..', '..yry..', '.ryryr.', '.yryry.', 'ryryryr'],
  },
  tophat: {
    palette: { k: '#2b2d42', r: '#e63946' },
    rows: ['..kkkkkk..', '..kkkkkk..', '..kkkkkk..', '..rrrrrr..', 'kkkkkkkkkk'],
  },
  crown: {
    palette: { y: '#ffd166', o: '#f4a261', r: '#e63946', b: '#3a86ff' },
    rows: ['y...y...y', 'yy.yyy.yy', 'yyyyyyyyy', 'yryybyyry', 'ooooooooo'],
  },
  witch: {
    palette: { k: '#3d2c5e', p: '#f4a261' },
    rows: [
      '.......kk...',
      '......kkk...',
      '.....kkk....',
      '....kkkk....',
      '....kkkkk...',
      '...kkkkkkk..',
      '...ppppppp..',
      'kkkkkkkkkkkk',
    ],
  },
  santa: {
    palette: { r: '#e63946', w: '#ffffff' },
    rows: ['.........ww', '......rrrww', '....rrrrr..', '...rrrrrr..', '..rrrrrrr..', '.wwwwwwwww.', '.wwwwwwwww.'],
  },
};

export const PUMPKIN = {
  palette: { o: '#f8961e', g: '#2a9d8f', y: '#ffd166' },
  rows: [
    '.....gg......',
    '......g......',
    '..ooooooooo..',
    '.ooooooooooo.',
    'ooyyoooooyyoo',
    'ooyyoooooyyoo',
    'ooooooyoooooo',
    'ooyoyoyoyoyoo',
    '.ooyyyyyyyoo.',
    '..ooooooooo..',
  ],
};

export const TREAT = {
  palette: { c: '#d4a373', k: '#5c3a21' },
  rows: [row(['.', 1], ['c', 5], ['.', 1]), row(['c', 2], ['k', 1], ['c', 4]), row(['c', 5], ['k', 1], ['c', 1]), row(['c', 1], ['k', 1], ['c', 5]), row(['.', 1], ['c', 5], ['.', 1])],
};

// Furniture from the shop (ids match lib/economy.js).
export const FURNITURE = {
  bed: {
    palette: { w: '#8d5524', p: '#ffffff', b: '#6a8dff', d: '#4a6bd8' },
    rows: [
      row(['w', 3], ['.', 27]),
      row(['w', 3], ['.', 27]),
      row(['w', 3], ['p', 5], ['.', 22]),
      row(['w', 3], ['p', 5], ['b', 22]),
      row(['w', 3], ['b', 27]),
      row(['w', 3], ['b', 27]),
      row(['w', 3], ['d', 27]),
      row(['w', 30]),
      row(['w', 2], ['.', 26], ['w', 2]),
    ],
  },
  bowl: {
    palette: { b: '#3a86ff', d: '#2667cc', f: '#8d5524' },
    rows: [
      row(['.', 2], ['f', 8], ['.', 2]),
      row(['.', 1], ['f', 10], ['.', 1]),
      row(['b', 12]),
      row(['.', 1], ['b', 10], ['.', 1]),
      row(['.', 2], ['d', 8], ['.', 2]),
    ],
  },
  cushion: {
    palette: { c: '#e76f91', d: '#c94f73', y: '#ffd166' },
    rows: [
      row(['y', 1], ['.', 1], ['c', 18], ['.', 1], ['y', 1]),
      row(['.', 1], ['c', 20], ['.', 1]),
      row(['c', 22]),
      row(['d', 22]),
      row(['y', 1], ['d', 20], ['y', 1]),
    ],
  },
  plant: {
    palette: { g: '#2a9d8f', G: '#1d6f65', p: '#c8553d', P: '#a3432f' },
    rows: [
      row(['.', 4], ['g', 2], ['.', 4]),
      row(['.', 2], ['g', 2], ['.', 1], ['g', 2], ['.', 3]),
      row(['.', 1], ['g', 3], ['.', 1], ['g', 3], ['.', 2]),
      row(['g', 3], ['.', 1], ['g', 2], ['.', 1], ['g', 3]),
      row(['.', 1], ['g', 2], ['.', 1], ['g', 2], ['.', 1], ['g', 2], ['.', 1]),
      row(['.', 2], ['g', 6], ['.', 2]),
      row(['.', 3], ['g', 4], ['.', 3]),
      row(['.', 4], ['G', 2], ['.', 4]),
      row(['p', 10]),
      row(['.', 1], ['p', 8], ['.', 1]),
      row(['.', 1], ['p', 8], ['.', 1]),
      row(['.', 2], ['P', 6], ['.', 2]),
    ],
  },
  post: {
    palette: { t: '#8d5524', r: '#e9c46a', R: '#d4a373' },
    rows: [
      row(['t', 8]),
      row(['t', 8]),
      ...Array.from({ length: 12 }, (_, i) => row(['.', 2], [i % 2 ? 'R' : 'r', 4], ['.', 2])),
      row(['t', 8]),
      row(['t', 8]),
    ],
  },
};

// Draws `art` into `canvas` at `scale` CSS px per art pixel (crisp on high-DPI screens) and
// returns its CSS size.
export function renderPixelArt(canvas, art, scale, { mirror = false } = {}) {
  const { rows, palette } = art;
  const cols = rows[0].length;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.max(1, Math.round(scale * dpr));
  const width = cols + 2; // 1px outline on each side
  const height = rows.length + 2;
  canvas.width = width * px;
  canvas.height = height * px;
  const size = { width: (width * px) / dpr, height: (height * px) / dpr };
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;

  const ctx = canvas.getContext('2d');
  const solid = (x, y) => (rows[y]?.[x] ?? '.') !== '.';
  const fill = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(((mirror ? cols - 1 - x : x) + 1) * px, (y + 1) * px, px, px);
  };
  for (let y = -1; y <= rows.length; y++) {
    for (let x = -1; x <= cols; x++) {
      if (solid(x, y)) fill(x, y, palette[rows[y][x]]);
      else if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) fill(x, y, OUTLINE);
    }
  }
  return size;
}

// Where the hat sits for an animation, in frame pixels (top of the head, as drawn in the sheet).
export function hatAnchor(sprite, animKey) {
  return sprite.animations[animKey]?.hatAnchor ?? sprite.hatAnchor ?? { x: sprite.frameWidth / 2, y: 0 };
}
