// Things that sit on the taskbar or on windows: furniture you place and treats you drop. They fall,
// land on ledges, ride along when a window moves, and can be picked up and moved.

import { renderPixelArt } from './pixelart.js';
import { findLanding, rideSurface, surfaceKey } from './physics.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class Prop {
  constructor(layer, { id, kind, art, scale, world, x, y }) {
    this.id = id;
    this.kind = kind;
    this.world = world;
    this.el = document.createElement('canvas');
    this.el.className = `prop prop-${kind}`;
    const size = renderPixelArt(this.el, art, scale);
    this.w = size.width;
    this.h = size.height;
    this.x = clamp(x, 0, Math.max(0, world.width - this.w));
    this.y = y ?? world.height - this.h; // on the taskbar unless dropped from somewhere
    this.vy = 0;
    this.surface = null;
    this.held = false;
    this.claimed = false; // treats: a pet got to it
    layer.append(this.el);
    this.render();
  }

  get cx() {
    return this.x + this.w / 2;
  }

  get bottom() {
    return this.y + this.h;
  }

  get surfaceKey() {
    return surfaceKey(this.surface);
  }

  groundY() {
    return (this.surface ? this.surface.y : this.world.height) - this.h;
  }

  isResting() {
    return !this.held && this.vy === 0 && this.y >= this.groundY();
  }

  contains(x, y, pad = 4) {
    return x >= this.x - pad && x <= this.x + this.w + pad && y >= this.y - pad && y <= this.y + this.h + pad;
  }

  // Returns true on the step it lands.
  update(dt, gravity) {
    if (this.held) return false;
    if (this.isResting()) {
      this.y = this.groundY();
      return false;
    }
    const prevBottom = this.bottom;
    this.vy += gravity * dt;
    this.y += this.vy * dt;
    const landing = findLanding(this.world.platforms, this.world.height, this.cx, prevBottom, this.bottom, this.h);
    if (landing === undefined) return false;
    this.surface = landing;
    this.y = this.groundY();
    this.vy = 0;
    return true;
  }

  // Window moved: ride along. Returns true if it lost its footing (and will now fall).
  follow(platforms) {
    return rideSurface(this, platforms);
  }

  resize() {
    this.x = clamp(this.x, 0, Math.max(0, this.world.width - this.w));
    if (!this.surface && !this.held) this.y = Math.min(this.y, this.groundY());
  }

  hold(x, y) {
    this.held = true;
    this.surface = null;
    this.vy = 0;
    this.x = clamp(x, 0, Math.max(0, this.world.width - this.w));
    this.y = clamp(y, 0, this.world.height - this.h);
  }

  drop() {
    this.held = false;
  }

  render() {
    this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
  }

  remove() {
    this.el.remove();
  }
}
