// Seasonal decorations: a jack-o'-lantern and bats for Halloween, snow in winter, confetti for the
// New Year, hearts on Valentine's Day. All CSS-animated DOM, so they cost no JavaScript per frame.

import { PUMPKIN, renderPixelArt } from './pixelart.js';
import * as fx from './effects.js';

const rand = (min, max) => min + Math.random() * (max - min);
const SNOWY = new Set(['christmas', 'winter', 'newyear']);

export class SeasonEffects {
  constructor(back, front) {
    this.back = back; // behind the pets
    this.front = front; // in front of them
    this.timers = [];
    this.key = null;
  }

  // season = null clears everything. Rebuilt only when the season or the screen size changes.
  apply(season, { width, height, scale, heads }) {
    const key = season ? `${season}:${width}x${height}:${scale}` : null;
    if (key === this.key) return;
    this.clear();
    this.key = key;
    if (!season) return;

    if (season === 'halloween') {
      this.pumpkin(width, height, scale);
      this.every(8_000, 60_000, 150_000, () => this.bat(width, height));
    }
    if (SNOWY.has(season)) this.snow(width, height);
    if (season === 'newyear') this.later(1500, () => fx.confetti(width));
    if (season === 'valentine') this.every(10_000, 40_000, 80_000, () => heads().forEach((head) => fx.heart(head)));
  }

  clear() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.back.replaceChildren();
    this.front.replaceChildren();
  }

  later(ms, fn) {
    this.timers.push(setTimeout(fn, ms));
  }

  every(firstMs, minMs, maxMs, fn) {
    const run = () => {
      fn();
      this.later(rand(minMs, maxMs), run);
    };
    this.later(firstMs, run);
  }

  pumpkin(width, height, scale) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pumpkin';
    const size = renderPixelArt(canvas, PUMPKIN, scale);
    canvas.style.transform = `translate(${Math.round(rand(width * 0.15, width * 0.85))}px, ${Math.round(height - size.height)}px)`;
    this.back.append(canvas);
  }

  bat(width, height) {
    const bat = document.createElement('span');
    bat.className = 'bat';
    bat.textContent = '\u{1F987}';
    const fromLeft = Math.random() < 0.5;
    bat.style.setProperty('--from', fromLeft ? '-60px' : `${width + 60}px`);
    bat.style.setProperty('--to', fromLeft ? `${width + 60}px` : '-60px');
    bat.style.setProperty('--y', `${Math.round(rand(height * 0.08, height * 0.4))}px`);
    bat.addEventListener('animationend', (e) => e.animationName === 'bat-fly' && bat.remove());
    this.front.append(bat);
  }

  snow(width, height) {
    for (let i = 0; i < 28; i++) {
      const flake = document.createElement('span');
      flake.className = 'flake';
      flake.textContent = Math.random() < 0.5 ? '❄' : '•';
      const duration = rand(9, 18);
      flake.style.left = `${Math.round(rand(0, width))}px`;
      flake.style.fontSize = `${Math.round(rand(8, 16))}px`;
      flake.style.animationDuration = `${duration.toFixed(1)}s`;
      flake.style.animationDelay = `${(-rand(0, duration)).toFixed(1)}s`; // already mid-fall at start
      flake.style.setProperty('--fall', `${height + 40}px`);
      this.front.append(flake);
    }
  }
}
