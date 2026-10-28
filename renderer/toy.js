// Toys: the ball ("Play ball") and the ball of yarn. DOM elements with bouncy physics, stepped by
// the main loop while active. Pets chase whichever toy is in play; you can grab one and throw it.

const RESTITUTION = 0.6;
const ROLL_FRICTION = 3.5;

const rand = (min, max) => min + Math.random() * (max - min);

export class Toy {
  constructor(el, kind) {
    this.el = el;
    this.kind = kind;
    this.r = kind === 'yarn' ? 12 : 11;
    this.active = false; // on screen
    this.inPlay = false; // pets are chasing it
    this.held = false;
  }

  spawn(x, y, vx, vy) {
    Object.assign(this, { x, y, vx, vy, angle: 0, active: true, inPlay: true, held: false });
    this.touchedAt = performance.now();
    clearTimeout(this.fadeTimer);
    this.el.classList.remove('fading');
    this.el.hidden = false;
    this.render();
  }

  kick(dir) {
    const strength = this.kind === 'yarn' ? 0.65 : 1; // yarn is batted, not booted
    this.vx = dir * rand(250, 450) * strength;
    this.vy = -rand(300, 500) * strength;
    this.touchedAt = performance.now();
  }

  contains(x, y) {
    return this.active && Math.hypot(x - this.x, y - this.y) <= this.r + 8;
  }

  hold(x, y) {
    this.held = true;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.touchedAt = performance.now();
  }

  release(vx, vy) {
    this.held = false;
    this.vx = vx;
    this.vy = vy;
  }

  finish() {
    this.active = false;
    this.inPlay = false;
    this.held = false;
    this.el.classList.add('fading');
    this.fadeTimer = setTimeout(() => {
      this.el.hidden = true;
    }, 600);
  }

  update(dt, width, floor, gravity) {
    if (this.held) return;
    const { r } = this;
    this.vy += gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < r || this.x > width - r) {
      this.x = Math.min(width - r, Math.max(r, this.x));
      this.vx = -this.vx * RESTITUTION;
    }
    if (this.y < r && this.vy < 0) {
      this.y = r;
      this.vy = -this.vy * RESTITUTION;
    }
    if (this.y > floor - r) {
      this.y = floor - r;
      this.vy = this.vy > 150 ? -this.vy * RESTITUTION : 0;
      this.vx *= Math.exp(-ROLL_FRICTION * dt);
      if (Math.abs(this.vx) < 5) this.vx = 0;
    }
    this.angle += (this.vx * dt) / r; // roll
  }

  render() {
    const { x, y, r, angle } = this;
    this.el.style.transform = `translate(${Math.round(x - r)}px, ${Math.round(y - r)}px) rotate(${angle.toFixed(2)}rad)`;
  }
}
