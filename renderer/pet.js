// Pet behaviour: a weighted-random state machine plus simple physics. Pets stand on the taskbar or
// on the top edges of other windows ("platforms"), climb the screen edges, use their furniture,
// and play with the cursor, toys, treats and each other. Coordinates are CSS pixels inside the
// overlay window; (x, y) is the sprite's top-left corner.
//
// `world` is shared by the pets on one monitor: { width, height, edges, platforms, sides, pets, toys,
// treats, furniture, laser, cursor, night, tired }. `edges` says which sides lead to another
// monitor; `platforms` are window tops ("ledges") and `sides` the windows' climbable sides.

import { findLanding, rideSurface, surfaceKey } from './physics.js';

// States that last a random time and then pick a successor from the transition tables.
const TIMED = new Set(['idle', 'walk', 'run', 'sit', 'excited']);
// Clinging to a screen edge: no gravity.
const ATTACHED = new Set(['climb', 'ceiling']);
// Being rubbed by the cursor.
const RUBBED = new Set(['petted', 'tickled']);

// Animations a sprite sheet may leave out, and what to show instead.
const ANIM_FALLBACKS = {
  chase: 'run',
  pounce: 'excited',
  jump: 'pounce',
  leap: 'jump',
  eat: 'excited',
  sad: 'sit',
  dragged: 'fall',
  run: 'walk',
  climb: 'walk',
  ceiling: 'walk',
  petted: 'sit',
  tickled: 'excited',
  scratch: 'excited',
  sniff: 'idle',
  sign: 'sit',
};

// How mood colours behaviour: movement speed, playfulness, and transition weights.
const MOODS = {
  happy: { speed: 1.1, curiosity: 1.5, weights: { run: 1.5, excited: 1.5, sit: 0.7 } },
  okay: { speed: 1, curiosity: 1, weights: {} },
  sad: { speed: 0.7, curiosity: 0.4, weights: { sit: 2, run: 0.3, excited: 0.3 } },
  hungry: { speed: 0.7, curiosity: 0.4, weights: { sit: 2, walk: 0.7, run: 0.3, excited: 0.3 } },
};
// Late at night or on low battery everyone is a bit sleepy.
const DROWSY_WEIGHTS = { sit: 2, run: 0.4, excited: 0.6 };
// What a pet does when it reaches a piece of furniture.
const FURNITURE_ACTIVITY = { post: 'scratch', plant: 'sniff', cushion: 'sit' };

const randBetween = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const restingMotion = () => ({ rotate: 0, scaleX: 1, offsetY: 0, flip: null });

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [state, weight] of entries) {
    roll -= weight;
    if (roll < 0) return state;
  }
  return entries.at(-1)?.[0] ?? 'idle';
}

export class Pet {
  constructor(config, world, usableAnims, id) {
    this.id = id;
    this.cfg = config;
    this.world = world;
    this.usable = usableAnims;
    this.measure();

    this.x = randBetween(0, this.maxX());
    this.y = -this.h - Math.random() * 200; // drop in from above the screen
    this.vx = 0;
    this.vy = 0;
    this.spin = 0; // degrees, while tumbling after a throw
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.surface = null; // the window ledge underfoot; null = the taskbar
    this.wall = null; // 'left' | 'right': which way the feet point while climbing
    this.side = null; // the window side being climbed (null on a screen edge)
    this.climbTo = 0;
    this.wantsToClimb = false;
    this.exiting = false; // walked off the monitor; waiting to be handed to the next one

    this.lastInputAt = performance.now();
    this.typingHigh = false;
    this.sleepReason = null; // 'idle' (any key wakes it), 'manual' (tray or a click), 'lock'
    this.mood = 'okay';
    this.trick = null;
    this.chase = null; // { target, speed, ... } while in the 'chase' state
    this.holdingSign = false;
    this.cursorCooldownUntil = 0;
    this.playCooldownUntil = 0;
    this.nextCuriosityAt = 0;
    this.nextFriendCheck = 0;
    this.nextJumpCheck = 0;
    this.nextFurnitureCheck = performance.now() + 10_000;
    this.nextKickAt = 0;
    this.nextLaserPounceAt = 0;
    this.gaveUpNapSpotAt = 0;
    this.pounceCaught = false;
    this.motion = restingMotion(); // visual-only transforms
    this.onStateChange = null;
    this.onEvent = null; // (type, data) => void, for sounds, speech and stats

    this.state = null;
    this.setState('fall');
  }

  // ---- geometry -----------------------------------------------------------

  measure() {
    this.w = this.cfg.sprite.frameWidth * this.cfg.scale;
    this.h = this.cfg.sprite.frameHeight * this.cfg.scale;
  }

  get baseline() {
    return (this.cfg.sprite.baselineOffset ?? 0) * this.cfg.scale;
  }

  cx() {
    return this.x + this.w / 2;
  }

  feetY() {
    return this.y + this.h - this.baseline;
  }

  groundY() {
    return (this.surface ? this.surface.y : this.world.height) - this.h + this.baseline;
  }

  maxX() {
    return Math.max(0, this.world.width - this.w);
  }

  isGrounded() {
    return this.vx === 0 && this.vy === 0 && this.y >= this.groundY();
  }

  surfaceKey() {
    return surfaceKey(this.surface);
  }

  contains(x, y, pad = 0) {
    return x >= this.x - pad && x <= this.x + this.w + pad && y >= this.y - pad && y <= this.y + this.h + pad;
  }

  // Airborne, sliding and trick motion is ticked at motionFps; everything else at fps.
  needsSmoothMotion() {
    if (this.state === 'trick' || RUBBED.has(this.state)) return true;
    if (this.state === 'dragged' || this.state === 'sleep' || ATTACHED.has(this.state)) return false;
    return !this.isGrounded();
  }

  headPoint() {
    return {
      x: this.x + this.w * (0.5 + 0.2 * this.dir),
      y: this.y + this.motion.offsetY + this.h * 0.1,
    };
  }

  get drowsy() {
    return this.world.night || this.world.tired;
  }

  speedFactor() {
    return MOODS[this.mood].speed * (this.world.night ? 0.8 : 1) * (this.world.tired ? 0.7 : 1);
  }

  // Seconds of no typing before sitting / sleeping; halved at night.
  idleLimits() {
    const factor = this.world.night ? 0.5 : 1;
    return { sit: this.cfg.typing.sitAfterSec * factor, sleep: this.cfg.typing.sleepAfterSec * factor };
  }

  resize() {
    const grounded = this.isGrounded();
    this.x = clamp(this.x, 0, this.maxX());
    if (!this.surface && (grounded || this.y > this.groundY())) {
      this.y = this.groundY();
      this.vy = 0;
    }
  }

  // Settings changed (e.g. size): keep the feet where they were.
  applyConfig(config) {
    const grounded = this.isGrounded();
    const feet = this.feetY();
    this.cfg = config;
    this.measure();
    this.y = grounded ? this.groundY() : feet - this.h + this.baseline;
    this.x = clamp(this.x, 0, this.maxX());
    this.anim = config.sprite.animations[this.animKey];
  }

  // The windows moved, opened or closed. Ride along with ours; returns true if it's gone.
  followSurface(platforms) {
    return rideSurface(this, platforms);
  }

  // Same for the window side being climbed. Returns true if it's gone (then let go).
  followSide(sides) {
    const old = this.side;
    if (!old) return false;
    const next = sides.find((s) => s.id === old.id && s.edge === old.edge && Math.abs(s.y1 - s.top - (old.y1 - old.top)) < 2);
    if (!next) {
      this.side = null;
      return true;
    }
    this.x += next.left - old.left;
    this.y += next.top - old.top;
    this.side = next;
    return false;
  }

  // ---- moving between monitors ------------------------------------------------

  // Walked or flew past an edge that leads to another monitor? Then it's handed over (once).
  crossedEdge() {
    const edges = this.world.edges ?? {};
    const cx = this.cx();
    const side = cx < 0 && edges.left ? 'left' : cx > this.world.width && edges.right ? 'right' : null;
    if (!side || this.exiting || this.state === 'chase') return false;
    this.exiting = true;
    this.onEvent?.('exit', { side });
    return true;
  }

  // Nowhere to be seen on this monitor: off an edge with no hand-over, or a broken position.
  outOfSight() {
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) return true;
    return this.x + this.w < 0 || this.x > this.world.width || this.y + this.h < 0 || this.y > this.world.height;
  }

  // The hand-over didn't happen (no monitor there any more): turn back.
  stayHere() {
    this.exiting = false;
    this.x = clamp(this.x, 0, this.maxX());
    this.vx = -this.vx;
    this.dir = this.x <= 0 ? 1 : -1;
  }

  // Coming in from another monitor: through a side edge (walking or flying), or dropped at a point.
  enterMonitor(a) {
    this.exiting = false;
    this.surface = null;
    this.side = null;
    this.lastInputAt = performance.now() - (a.idleMs ?? 0);
    const inward = a.edge === 'left' ? 1 : a.edge === 'right' ? -1 : a.dir || 1;
    this.x = a.edge === 'left' ? -this.w / 2 : a.edge === 'right' ? this.world.width - this.w / 2 : clamp(a.x - this.w / 2, 0, this.maxX());
    if (a.feetY === null || a.feetY === undefined) {
      this.y = this.groundY();
      this.vx = 0;
      this.vy = 0;
      this.setState(a.state === 'run' ? 'run' : 'walk', 2500);
    } else {
      this.y = clamp(a.feetY - this.h + this.baseline, 0, this.world.height - this.h);
      this.vx = a.vx ?? 0;
      this.vy = a.vy ?? 0;
      this.setState('fall');
    }
    this.dir = inward;
  }

  loseFooting() {
    if (this.state === 'sleep') {
      this.sleepReason = null;
      this.noteInput();
    }
    if (this.state === 'dragged' || ATTACHED.has(this.state)) return;
    this.setState('fall');
  }

  // ---- state machine ------------------------------------------------------

  setState(name, durationMs) {
    const prev = this.state;
    const now = performance.now();
    this.state = name;
    this.stateStartedAt = now;

    if (durationMs === undefined && TIMED.has(name)) {
      const [min, max] = this.cfg.behavior.durationMs[name] ?? [2000, 5000];
      durationMs = randBetween(min, max);
    }
    this.stateEndsAt = durationMs === undefined ? Infinity : now + durationMs;

    if (name === 'walk' || name === 'run') this.pickDirection();
    if (name !== 'chase') this.chase = null;
    if (!ATTACHED.has(name) && name !== 'leap') {
      this.wall = null;
      this.side = null;
    }
    this.setAnimation(this.animFor(name));
    this.onStateChange?.(name, prev);
  }

  animFor(state) {
    if (state === 'trick') return this.trick.animation;
    if (state === 'chase' && this.chase?.target === 'spot') return 'walk';
    if ((state === 'idle' || state === 'sit') && (this.mood === 'sad' || this.mood === 'hungry')) return 'sad';
    return state;
  }

  resolveAnim(key) {
    const seen = new Set();
    while (!this.usable.has(key) && !seen.has(key)) {
      seen.add(key);
      key = ANIM_FALLBACKS[key] ?? 'idle';
    }
    return key;
  }

  setAnimation(key) {
    const resolved = this.resolveAnim(key);
    if (resolved === this.animKey) return;
    this.animKey = resolved;
    this.anim = this.cfg.sprite.animations[resolved];
    this.frame = 0;
    this.frameClock = 0;
  }

  next() {
    const { transitions, typingTransitions } = this.cfg.behavior;
    const base = this.typingHigh ? typingTransitions : (transitions[this.state] ?? transitions.idle);
    const moodWeights = MOODS[this.mood].weights;
    const weights = Object.fromEntries(
      Object.entries(base).map(([s, w]) => [s, w * (moodWeights[s] ?? 1) * (this.drowsy ? (DROWSY_WEIGHTS[s] ?? 1) : 1)]),
    );
    const choice = weightedPick(weights);
    this.setState(TIMED.has(choice) ? choice : 'idle');
  }

  // Near a screen edge pets usually head back toward the middle, but sometimes make for the wall
  // to climb it.
  pickDirection() {
    const edge = this.world.width * 0.1;
    const edges = this.world.edges ?? {};
    // An edge with another monitor beyond it isn't a wall: wander across freely.
    const nearLeft = this.x < edge && !edges.left;
    const nearRight = this.x > this.maxX() - edge && !edges.right;
    const climb = this.cfg.climbing;
    this.wantsToClimb = false;
    if ((nearLeft || nearRight) && climb.walls && !this.surface && Math.random() < climb.wallChance) {
      this.dir = nearLeft ? -1 : 1;
      this.wantsToClimb = true;
    } else if (nearLeft) {
      this.dir = 1;
    } else if (nearRight) {
      this.dir = -1;
    } else if (Math.random() < 0.5) {
      this.dir = -this.dir;
    }
  }

  update(dt, now) {
    if (this.state === 'sleep') return;
    if (this.state !== 'dragged') {
      this.think(now);
      this.move(dt);
      this.applyPhysics(dt);
    }
    this.updateMotion(now);
    this.advanceFrame(dt);
  }

  think(now) {
    if (TIMED.has(this.state) && this.isGrounded()) {
      if (this.holdingSign) return this.setState('sign'); // stays put until the reminder is dismissed
      const idleSec = (now - this.lastInputAt) / 1000;
      const limits = this.idleLimits();
      if (idleSec >= limits.sleep) return this.sleep('idle');
      if (idleSec >= limits.sit) return this.idleSit();
      if (this.world.laser.on && this.world.cursor) return this.startChase('laser');
      const toy = this.world.toys.find((t) => t.inPlay);
      if (toy) return this.startChase('toy', { toy });
      const treat = this.nearestTreat();
      if (treat) return this.startChase('treat', { treat });
      if (this.wantsToChaseCursor(now)) return this.startChase('cursor');
      if (this.maybePlayWithFriend(now) || this.maybeGoUp(now) || this.maybeVisitFurniture(now)) return;
      this.watchCursor(now);
    }
    if (this.state === 'chase') return this.updateChase(now);
    if (ATTACHED.has(this.state)) return this.updateClimb(now);
    if (now >= this.stateEndsAt) this.next();
  }

  move(dt) {
    const walkSpeed = this.cfg.speed.walk * this.speedFactor();
    if (this.state === 'climb') {
      this.y = Math.max(0, this.y - walkSpeed * 1.8 * dt);
      return;
    }
    if (this.state === 'ceiling') {
      this.x = clamp(this.x + this.dir * walkSpeed * dt, 0, this.maxX());
      return;
    }

    let speed = 0;
    if (this.state === 'walk' || this.state === 'run') speed = this.cfg.speed[this.state] * this.speedFactor();
    else if (this.state === 'chase') speed = this.chase.speed;
    if (!speed) return;
    this.x += this.dir * speed * dt;
    if (this.crossedEdge()) return; // off to the next monitor

    // Screen edges with no monitor beyond (always, while chasing): turn around, or sometimes climb.
    const edges = this.state === 'chase' ? {} : (this.world.edges ?? {});
    const atLeft = this.x <= 0 && !edges.left;
    const atRight = this.x >= this.maxX() && !edges.right;
    if (atLeft || atRight) {
      this.x = clamp(this.x, 0, this.maxX());
      if (this.state !== 'chase') {
        const climb = this.cfg.climbing;
        if (climb.walls && !this.surface && this.isGrounded() && (this.wantsToClimb || Math.random() < climb.wallChance)) {
          return this.startClimb(atLeft ? 'left' : 'right');
        }
        this.dir = atLeft ? 1 : -1;
      }
    }

    // End of a window ledge: hop off, or turn around.
    const s = this.surface;
    if (s && this.isGrounded()) {
      const cx = this.cx();
      if (cx >= s.x1 && cx <= s.x2) return;
      if (this.state === 'chase' || Math.random() < this.cfg.climbing.dropChance) {
        this.surface = null;
        if (this.state !== 'chase') this.setState('fall');
      } else {
        this.x = clamp(cx, s.x1, s.x2) - this.w / 2;
        this.dir = -this.dir;
      }
    }
  }

  applyPhysics(dt) {
    if (ATTACHED.has(this.state)) return;
    if (this.isGrounded()) {
      this.y = this.groundY();
      return;
    }

    const p = this.cfg.physics;
    const bounce = p.bounce ?? 0.45;
    const sliding = this.vy === 0 && this.y >= this.groundY();
    const wasRising = this.vy < 0;
    const prevFeet = this.feetY();
    if (sliding) {
      this.vx *= Math.exp(-(p.groundFriction ?? 5) * dt);
      if (Math.abs(this.vx) < 20) this.vx = 0;
    } else {
      this.vy += p.gravity * dt;
      if (this.state === 'fall') {
        this.vx *= Math.exp(-(p.airDrag ?? 0) * dt);
        this.spin += this.vx * dt * 0.5;
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.crossedEdge()) return; // flying off into the next monitor

    // Leaping at a window side: grab on once level with it; drop if it was out of reach.
    if (this.state === 'leap') {
      if (this.side && this.y + this.h * 0.5 <= this.side.y2) {
        this.vx = 0;
        this.vy = 0;
        this.setState('climb');
        this.onEvent?.('climb');
        return;
      }
      if (this.vy >= 0) this.setState('fall');
    }

    // Screen edges (with no monitor beyond) and the top of the screen are walls.
    const edges = this.world.edges ?? {};
    const hitLeft = this.x <= 0 && !edges.left;
    const hitRight = this.x >= this.maxX() && !edges.right;
    if (hitLeft || hitRight) {
      this.x = clamp(this.x, 0, this.maxX());
      this.vx = (hitLeft ? 1 : -1) * Math.abs(this.vx) * bounce;
      if (Math.abs(this.vx) > 150) this.onEvent?.('bounce', { impact: Math.abs(this.vx) / bounce });
    }
    if (this.y < 0 && this.vy < 0) {
      this.y = 0;
      this.vy = -this.vy * bounce;
    }

    // Top of a pounce: did the paws reach the cursor?
    const cursor = this.world.cursor;
    if (this.state === 'pounce' && wasRising && this.vy >= 0 && cursor) {
      this.pounceCaught = this.contains(cursor.x, cursor.y, 16);
    }

    if (sliding) {
      // Slid off the end of a window ledge.
      if (this.surface && (this.cx() < this.surface.x1 || this.cx() > this.surface.x2)) this.surface = null;
    } else if (this.vy > 0) {
      const landing = findLanding(this.world.platforms, this.world.height, this.cx(), prevFeet, this.feetY(), this.h);
      if (landing !== undefined) {
        this.surface = landing;
        this.y = this.groundY();
        const impact = this.vy;
        if (this.state === 'fall' && impact > (p.bounceMinSpeed ?? 400)) {
          this.vy = -impact * bounce;
          this.onEvent?.('bounce', { impact });
        } else {
          this.vy = 0;
          this.spin = 0;
          if (this.state !== 'fall') this.vx = 0; // hops, jumps and pounces stick the landing
          this.onEvent?.('land', { impact });
        }
      }
    }

    if (!this.isGrounded()) return;
    if (this.state === 'pounce') {
      this.onEvent?.('pounce', { caught: this.pounceCaught, laser: this.world.laser.on });
      this.setState('idle');
    } else if (this.state === 'fall' || this.state === 'jump') {
      this.setState('idle');
    }
  }

  updateMotion(now) {
    const m = this.motion;
    const native = this.cfg.sprite.facing === 'left' ? -1 : 1;
    const t = (now - this.stateStartedAt) / 1000;
    m.rotate = this.state === 'fall' ? this.spin : 0;
    m.scaleX = 1;
    m.offsetY = 0;
    m.flip = null;

    if (this.state === 'climb') {
      // Feet on the wall, head up.
      m.rotate = this.wall === 'left' ? 90 : -90;
      m.flip = this.wall === 'left' ? -native : native;
    } else if (this.state === 'ceiling') {
      m.rotate = 180; // upside down, still facing the way it walks
      m.flip = -this.dir * native;
    } else if (this.state === 'petted') {
      m.rotate = Math.sin(t * 4) * 5; // leaning into the hand
    } else if (this.state === 'tickled') {
      m.rotate = Math.sin(t * 30) * 9;
      m.offsetY = -Math.abs(Math.sin(t * 15)) * 5;
    } else if (this.state === 'scratch') {
      m.rotate = Math.sin(t * 22) * 4;
    } else if (this.state === 'trick') {
      const { motion, durationMs, height = 60 } = this.trick;
      const p = clamp((now - this.stateStartedAt) / durationMs, 0, 1);
      if (motion === 'spin') {
        m.scaleX = Math.cos(p * Math.PI * 4); // two full turns around the vertical axis
      } else if (motion === 'backflip') {
        m.rotate = -360 * p * this.dir;
        m.offsetY = -4 * height * p * (1 - p);
      } else if (motion === 'wiggle') {
        m.rotate = Math.sin(p * Math.PI * 6) * 15;
      }
    }
  }

  advanceFrame(dt) {
    if (!this.anim) return;
    const fps = Math.min(this.anim.fps ?? this.cfg.fps, this.cfg.fps); // never faster than cfg.fps
    if (!(fps > 0)) return;
    this.frameClock += dt;
    while (this.frameClock >= 1 / fps) {
      this.frameClock -= 1 / fps;
      if (this.frame < this.anim.frames - 1) this.frame++;
      else if (this.anim.loop !== false) this.frame = 0;
    }
  }

  // ---- climbing -------------------------------------------------------------

  startClimb(side) {
    this.surface = null;
    this.side = null;
    this.wall = side;
    this.x = side === 'left' ? 0 : this.maxX();
    // Half the time all the way up (then along the ceiling), otherwise let go partway.
    this.climbTo = Math.random() < 0.5 ? 0 : this.world.height * randBetween(0.3, 0.7);
    this.setState('climb');
    this.onEvent?.('climb');
  }

  updateClimb(now) {
    if (this.state === 'climb' && this.side) return this.climbWindow();
    if (this.state === 'climb') {
      if (this.y > this.climbTo) return;
      if (this.y <= 0 && Math.random() < 0.7) {
        this.dir = this.wall === 'left' ? 1 : -1;
        return this.setState('ceiling', randBetween(2500, 6000));
      }
      return this.letGo();
    }
    const atWall = this.x <= 0 || this.x >= this.maxX();
    if (now >= this.stateEndsAt || (atWall && now - this.stateStartedAt > 500)) this.letGo();
  }

  letGo() {
    const push = this.state === 'climb' ? (this.wall === 'left' ? 80 : -80) : 0;
    this.setState('fall');
    this.surface = null;
    this.vx = push;
    this.vy = 0;
    this.spin = 0;
  }

  // ---- climbing windows -----------------------------------------------------------

  // Where the pet stands to climb a side: just outside the window, against it.
  standX(side) {
    return side.edge === 'left' ? side.x - this.w : side.x;
  }

  // The window top it pulls itself onto from a side, if that bit of the top is visible.
  ledgeAtTop(side) {
    const cx = side.edge === 'left' ? side.x + this.w / 2 : side.x - this.w / 2;
    return this.world.platforms.find((p) => p.id === side.id && cx >= p.x1 && cx <= p.x2 && Math.abs(p.y - side.y1) < 3) ?? null;
  }

  // A window side worth climbing: its top well above us with room to stand there, its bottom
  // within reach (walking up to it, or a leap), and the foot of it reachable from where we are.
  climbableSide() {
    const feet = this.feetY();
    const cx = this.cx();
    const here = this.surface;
    const options = this.world.sides.filter((s) => {
      const x = this.standX(s);
      if (x < 0 || x > this.maxX() || Math.abs(x + this.w / 2 - cx) > 900) return false;
      if (s.y1 > feet - this.h || s.y1 - this.h < 0) return false;
      if (s.y2 < feet - this.cfg.climbing.maxJumpHeight) return false;
      if (here && (x + this.w / 2 < here.x1 || x + this.w / 2 > here.x2)) return false;
      return Boolean(this.ledgeAtTop(s));
    });
    return options.length ? pick(options) : null;
  }

  reachableLedge() {
    const climb = this.cfg.climbing;
    const feet = this.feetY();
    const cx = this.cx();
    const options = this.world.platforms.filter((p) => {
      const rise = feet - p.y;
      if (rise < 30 || rise > climb.maxJumpHeight || p.y - this.h < 0 || p.x2 - p.x1 < this.w) return false;
      const gap = cx < p.x1 ? p.x1 - cx : cx > p.x2 ? cx - p.x2 : 0;
      return gap < 260;
    });
    return options.length ? pick(options) : null;
  }

  // Up onto a window: jump if its top is close, otherwise climb up its side.
  maybeGoUp(now) {
    const climb = this.cfg.climbing;
    if (!climb.windows || now < this.nextJumpCheck || (!this.world.platforms.length && !this.world.sides.length)) return false;
    this.nextJumpCheck = now + 1500;
    if (Math.random() >= climb.jumpChance) return false;
    const ledge = this.reachableLedge();
    const side = !ledge || Math.random() < 0.4 ? this.climbableSide() : null;
    if (side) {
      this.startChase('spot', { x: this.standX(side), then: 'climbSide', side, surface: this.surfaceKey() }, 15_000);
      return true;
    }
    if (!ledge) return false;
    const margin = this.w * 0.5;
    this.jumpTo(clamp(this.cx() + (Math.random() - 0.5) * 120, ledge.x1 + margin, ledge.x2 - margin), ledge.y);
    return true;
  }

  // At the foot of a window side: start climbing, or leap up to it if it starts higher.
  climbSide(target) {
    const side =
      this.world.sides.find((s) => s.id === target.id && s.edge === target.edge && Math.abs(s.y1 - target.y1) < 30) ??
      this.world.sides.find((s) => s.id === target.id && s.edge === target.edge);
    if (!side) return this.setState('idle');
    const feet = this.feetY();
    this.surface = null;
    this.x = this.standX(side);
    this.side = side;
    this.wall = side.edge === 'left' ? 'right' : 'left'; // feet against the window
    if (side.y2 >= feet - this.h * 0.3) {
      this.setState('climb');
      this.onEvent?.('climb');
      return;
    }
    const g = this.cfg.physics.gravity;
    this.setState('leap');
    this.vx = 0;
    this.vy = -Math.sqrt(2 * g * (feet - side.y2 + this.h * 0.6));
    this.onEvent?.('jump');
  }

  // Climbing a window side (move() does the going up); at the top, pull up onto it.
  climbWindow() {
    const side = this.side;
    if (this.y > side.y1 - this.h * 0.25) return;
    const ledge = this.ledgeAtTop(side);
    if (!ledge) return this.letGo();
    this.x = side.edge === 'left' ? side.x : side.x - this.w;
    this.surface = ledge;
    this.setState('idle');
    this.y = this.groundY();
    this.vx = 0;
    this.vy = 0;
    this.onEvent?.('mount');
  }

  // A window top right under the feet, or one the lower body is already overlapping (dropped onto
  // a title bar): stand on that rather than falling through it.
  ledgeUnderfoot() {
    const feet = this.feetY();
    const cx = this.cx();
    const options = this.world.platforms.filter(
      (p) => cx >= p.x1 && cx <= p.x2 && p.y >= feet - this.h * 0.6 && p.y <= feet + 4 && p.y - this.h >= 0,
    );
    return options.sort((a, b) => Math.abs(a.y - feet) - Math.abs(b.y - feet))[0] ?? null;
  }

  standOn(ledge) {
    this.surface = ledge;
    this.vx = 0;
    this.vy = 0;
    this.y = this.groundY();
    this.setState('idle');
  }

  // ---- furniture --------------------------------------------------------------

  // Nearest piece of furniture of a kind that's on the taskbar or on this pet's own ledge.
  findFurniture(kind) {
    const here = this.surfaceKey();
    const options = this.world.furniture.filter(
      (f) => f.kind === kind && !f.held && f.isResting() && (f.surfaceKey === 'floor' || f.surfaceKey === here),
    );
    return options.sort((a, b) => Math.abs(a.cx - this.cx()) - Math.abs(b.cx - this.cx()))[0] ?? null;
  }

  // Walk to `prop` (standing `offset` px off its centre), then do `then`.
  visit(prop, then, offset = 0, durationMs = 12_000) {
    const x = clamp(prop.cx - this.w / 2 + offset, 0, this.maxX());
    this.startChase('spot', { x, then, prop, surface: prop.surfaceKey }, durationMs);
  }

  maybeVisitFurniture(now) {
    if (now < this.nextFurnitureCheck || !this.world.furniture.length) return false;
    this.nextFurnitureCheck = now + 10_000;
    if (Math.random() >= 0.15) return false;
    const options = Object.keys(FURNITURE_ACTIVITY)
      .map((kind) => this.findFurniture(kind))
      .filter((prop) => prop && Math.abs(prop.cx - this.cx()) < 900);
    if (!options.length) return false;
    const prop = pick(options);
    this.visit(prop, FURNITURE_ACTIVITY[prop.kind]);
    return true;
  }

  // Fed: run to the bowl if there is one, otherwise eat on the spot.
  goEat(durationMs) {
    const bowl = this.findFurniture('bowl');
    if (bowl && this.isGrounded()) return this.visit(bowl, 'eat', 0, 8000);
    this.eat(durationMs);
  }

  // ---- play: cursor, laser, toys, treats, friends, windows -------------------------

  // Turn to look at a cursor moving nearby.
  watchCursor(now) {
    const c = this.world.cursor;
    if (!this.cfg.cursorPlay.enabled || !c || now - c.movedAt > 1000) return;
    if (this.state === 'walk' || this.state === 'run') return;
    const dx = c.x - this.cx();
    if (Math.abs(dx) > 30 && Math.abs(dx) < this.cfg.cursorPlay.noticeDistance) this.dir = Math.sign(dx);
  }

  wantsToChaseCursor(now) {
    const cp = this.cfg.cursorPlay;
    const c = this.world.cursor;
    if (!cp.enabled || !c || now < this.cursorCooldownUntil || now < this.nextCuriosityAt) return false;
    if (now - c.movedAt > 1500 || this.contains(c.x, c.y, 20)) return false; // only moving cursors, not hovering
    const dx = c.x - this.cx();
    const heightAboveFeet = this.feetY() - c.y;
    if (Math.abs(dx) > cp.noticeDistance || heightAboveFeet < 0 || heightAboveFeet > cp.maxPounceHeight + this.h) {
      return false;
    }
    this.nextCuriosityAt = now + 1000; // roll the dice at most once a second
    return Math.random() < cp.chance * MOODS[this.mood].curiosity;
  }

  nearestTreat() {
    const treats = this.world.treats.filter((t) => !t.claimed && t.isResting());
    return treats.sort((a, b) => Math.abs(a.cx - this.cx()) - Math.abs(b.cx - this.cx()))[0] ?? null;
  }

  maybePlayWithFriend(now) {
    if (this.world.pets.length < 2 || now < this.nextFriendCheck || now < this.playCooldownUntil) return false;
    this.nextFriendCheck = now + 2000;
    const here = this.surfaceKey();
    const friends = this.world.pets.filter(
      (p) =>
        p !== this &&
        TIMED.has(p.state) &&
        p.isGrounded() &&
        !p.holdingSign &&
        p.surfaceKey() === here &&
        now >= p.playCooldownUntil &&
        Math.abs(p.cx() - this.cx()) < 500,
    );
    if (!friends.length || Math.random() >= this.cfg.friends.playChance * MOODS[this.mood].curiosity) return false;
    const friend = pick(friends);
    this.startChase('friend', { pet: friend }, 6000);
    friend.flee(this);
    this.onEvent?.('chase-friend', { other: friend });
    return true;
  }

  flee(chaser) {
    this.setState('run', 4000);
    this.dir = this.cx() < chaser.cx() ? -1 : 1;
  }

  // Ballistic jump that comes down on a ledge at height `ledgeY`, centred at tx.
  jumpTo(tx, ledgeY) {
    const g = this.cfg.physics.gravity;
    const clearance = 40;
    const vy = -Math.sqrt(2 * g * (this.feetY() - ledgeY + clearance));
    const airtime = -vy / g + Math.sqrt((2 * clearance) / g);
    this.setState('jump');
    this.surface = null;
    this.vy = vy;
    this.vx = (tx - this.cx()) / airtime;
    if (this.vx) this.dir = Math.sign(this.vx);
    this.onEvent?.('jump');
  }

  // Nap time: everyone heads for the bed if there is one, otherwise gathers next to the first
  // pet, so they sleep in a pile.
  idleSit() {
    const pets = this.world.pets;
    const index = pets.indexOf(this);
    const stillTrying = this.gaveUpNapSpotAt < this.lastInputAt;
    const bed = stillTrying ? this.findFurniture('bed') : null;
    if (bed) {
      const offset = (index % 2 ? 1 : -1) * Math.ceil(index / 2) * this.w * 0.45;
      const spot = clamp(bed.cx - this.w / 2 + offset, 0, this.maxX());
      if (Math.abs(spot - this.x) > 8) return this.visit(bed, 'nap', offset, 20_000);
    } else {
      const leader = pets[0];
      if (stillTrying && leader !== this && leader.surfaceKey() === this.surfaceKey() && leader.state !== 'chase') {
        const offset = (index % 2 ? 1 : -1) * Math.ceil(index / 2) * this.w * 0.7;
        const spot = clamp(leader.x + offset, 0, this.maxX());
        if (Math.abs(spot - this.x) > 8) return this.startChase('spot', { x: spot, then: 'nap' }, 15_000);
      }
    }
    if (this.state !== 'sit' || this.stateEndsAt !== Infinity) this.setState('sit', Infinity);
  }

  startChase(target, extra = {}, durationMs) {
    if (target === 'cursor') durationMs = this.cfg.cursorPlay.maxChaseSec * 1000;
    this.chase = { target, speed: 0, ...extra };
    this.setState('chase', durationMs);
  }

  updateChase(now) {
    const cx = this.cx();
    switch (this.chase.target) {
      case 'toy':
        return this.chaseToy(now, cx);
      case 'cursor':
        return this.chaseCursor(now, cx);
      case 'laser':
        return this.chaseLaser(now, cx);
      case 'treat':
        return this.chaseTreat(now, cx);
      case 'friend':
        return this.chaseFriend(now, cx);
      default:
        return this.walkToSpot(now);
    }
  }

  chaseToy(now, cx) {
    const { toy } = this.chase;
    if (!toy.inPlay || !toy.active) return this.setState('idle');
    const dx = toy.x - cx;
    const reach = this.w * 0.35 + toy.r;
    const zoomies = this.cfg.speed.run * 1.5;
    if (toy.held) {
      // You're holding it: wait underneath, watching.
      if (Math.abs(dx) > 6) this.dir = Math.sign(dx);
      this.chase.speed = Math.abs(dx) > this.w ? zoomies : 0;
      return;
    }
    if (this.surface) {
      // Up on a window: run off the ledge to get down to the toy.
      if (Math.abs(dx) > reach) this.dir = Math.sign(dx);
      this.chase.speed = zoomies;
      return;
    }
    if (Math.abs(dx) > 6) this.dir = Math.sign(dx);
    this.chase.speed = Math.abs(dx) > reach * 0.6 ? zoomies : 0;
    const toyLow = toy.y + toy.r >= this.feetY() - this.h * 0.6;
    if (Math.abs(dx) <= reach && toyLow && now >= this.nextKickAt) {
      toy.kick(this.dir);
      this.nextKickAt = now + 600;
      this.onEvent?.('kick', { toy });
    }
  }

  chaseCursor(now, cx) {
    const cp = this.cfg.cursorPlay;
    const c = this.world.cursor;
    const giveUp = !c || now >= this.stateEndsAt || now - c.movedAt > 2500 || this.contains(c.x, c.y, 10);
    const dx = c ? c.x - cx : 0;
    if (giveUp || Math.abs(dx) > cp.noticeDistance * 1.5) {
      this.cursorCooldownUntil = now + cp.cooldownSec * 1000;
      return this.setState('idle');
    }
    if (Math.abs(dx) > 6) this.dir = Math.sign(dx);
    const above = this.y - c.y; // how far above the pet's head the cursor is
    if (Math.abs(dx) < cp.pounceDistance && above > 0 && above < cp.maxPounceHeight) return this.pounce(c, now);
    this.chase.speed = Math.abs(dx) > cp.pounceDistance * 0.5 ? this.cfg.speed.run : 0;
  }

  // The laser dot is the cursor; no getting bored, quick re-pounces.
  chaseLaser(now, cx) {
    const c = this.world.cursor;
    if (!this.world.laser.on || !c) return this.setState('idle');
    const cp = this.cfg.cursorPlay;
    const dx = c.x - cx;
    if (Math.abs(dx) > 6) this.dir = Math.sign(dx);
    const above = this.y + this.h * 0.5 - c.y;
    const inReach = Math.abs(dx) < cp.pounceDistance && above > -this.h * 0.3 && above < cp.maxPounceHeight;
    if (inReach && now >= this.nextLaserPounceAt && this.isGrounded()) {
      this.nextLaserPounceAt = now + 1200;
      return this.pounce(c, now, 0);
    }
    this.chase.speed = Math.abs(dx) > 10 ? this.cfg.speed.run * 1.3 : 0;
  }

  chaseTreat(now, cx) {
    const { treat } = this.chase;
    if (treat.claimed || !this.world.treats.includes(treat)) return this.setState('idle');
    const dx = treat.cx - cx;
    const rise = this.feetY() - treat.bottom; // > 0: the treat is up on a ledge
    if (Math.abs(dx) > 6) this.dir = Math.sign(dx);
    if (rise > 20 && this.isGrounded() && Math.abs(dx) < 220 && rise <= this.cfg.climbing.maxJumpHeight) {
      return this.jumpTo(treat.cx, treat.bottom);
    }
    if (Math.abs(dx) < this.w * 0.3 && Math.abs(rise) < this.h * 0.5) {
      treat.claimed = true;
      this.onEvent?.('ate-treat', { treat });
      return this.setState('eat', 1200);
    }
    this.chase.speed = Math.abs(dx) > 4 ? this.cfg.speed.run * 1.4 : 0;
  }

  chaseFriend(now, cx) {
    const friend = this.chase.pet;
    if (!this.world.pets.includes(friend) || now >= this.stateEndsAt || friend.state === 'sleep' || friend.state === 'dragged') {
      return this.setState('idle');
    }
    const dx = friend.cx() - cx;
    if (Math.abs(dx) > 6) this.dir = Math.sign(dx);
    if (Math.abs(dx) < this.w * 0.6 && Math.abs(friend.feetY() - this.feetY()) < this.h * 0.5) {
      this.playCooldownUntil = friend.playCooldownUntil = now + 30_000;
      this.setState('excited', 1200);
      friend.setState('excited', 1200);
      this.hop();
      friend.hop();
      this.onEvent?.('tag', { other: friend });
      return;
    }
    this.chase.speed = this.cfg.speed.run * 1.15; // a bit faster than the one running away
  }

  walkToSpot(now) {
    const { x, then, surface } = this.chase;
    if (then === 'nap' && (now - this.lastInputAt) / 1000 < this.idleLimits().sit) return this.setState('idle'); // you're back
    // Up on a window and the spot is on the taskbar: head for the nearer end of the ledge first.
    const s = this.surface;
    if (surface && surface !== this.surfaceKey() && s) {
      this.dir = this.cx() - s.x1 < s.x2 - this.cx() ? -1 : 1;
      this.chase.speed = this.cfg.speed.walk;
      return;
    }
    const dx = x - this.x;
    const arrived = Math.abs(dx) < 8;
    if (arrived || now >= this.stateEndsAt) return this.arrive(then, arrived, now);
    this.dir = Math.sign(dx);
    this.chase.speed = then === 'eat' ? this.cfg.speed.run : this.cfg.speed.walk * this.speedFactor();
  }

  arrive(then, arrived, now) {
    const { prop } = this.chase;
    switch (then) {
      case 'eat':
        if (prop) {
          // Face the bowl with the head over it.
          this.dir = Math.sign(prop.cx - this.cx()) || this.dir;
          this.x = clamp(prop.cx - (this.dir === 1 ? 0.8 : 0.2) * this.w, 0, this.maxX());
        }
        this.eat(2500);
        return;
      case 'sit':
        return this.setState('sit');
      case 'scratch':
        if (!arrived) return this.setState('idle');
        this.dir = Math.sign(prop.cx - this.cx()) || this.dir;
        this.setState('scratch', 2500);
        return this.onEvent?.('scratch');
      case 'sniff':
        if (!arrived) return this.setState('idle');
        this.dir = Math.sign(prop.cx - this.cx()) || this.dir;
        this.setState('sniff', 1800);
        return this.onEvent?.('sniff');
      case 'climbSide':
        return arrived ? this.climbSide(this.chase.side) : this.setState('idle');
      default: // nap
        if (!arrived) this.gaveUpNapSpotAt = now;
        return this.setState('sit', Infinity);
    }
  }

  // Jump so the top of the arc reaches the target (cursor or laser dot).
  pounce(target, now, cooldownMs = this.cfg.cursorPlay.cooldownSec * 1000) {
    const { gravity } = this.cfg.physics;
    const cp = this.cfg.cursorPlay;
    const rise = clamp(this.y + this.h * 0.3 - target.y, 30, cp.maxPounceHeight);
    const vy = -Math.sqrt(2 * gravity * rise);
    const timeToApex = -vy / gravity;
    this.setState('pounce');
    this.surface = null;
    this.vy = vy;
    this.vx = clamp((target.x - this.cx()) / timeToApex, -700, 700);
    this.pounceCaught = false;
    this.cursorCooldownUntil = now + cooldownMs;
    this.onEvent?.('pounce-start');
  }

  // ---- reactions ----------------------------------------------------------

  noteInput() {
    this.lastInputAt = performance.now();
    if (this.state === 'sit' && this.stateEndsAt === Infinity) this.stateEndsAt = 0; // end idle-sit
  }

  resetActivity() {
    this.typingHigh = false;
    this.noteInput();
  }

  setTypingRate(perTenSec) {
    const { highRate } = this.cfg.typing;
    if (!this.typingHigh && perTenSec >= highRate) {
      this.typingHigh = true;
      this.onEvent?.('typing-fast');
      if (TIMED.has(this.state) && this.isGrounded()) this.next(); // react right away
    } else if (this.typingHigh && perTenSec < highRate * 0.6) {
      this.typingHigh = false;
    }
  }

  setMood(mood) {
    if (!MOODS[mood] || mood === this.mood) return;
    this.mood = mood;
    this.setAnimation(this.animFor(this.state));
  }

  // The cursor is rubbing back and forth over the pet. Returns what happened: 'petted',
  // 'tickled', 'asleep' (it purrs in its sleep), or null if it's busy.
  rub(kind) {
    if (this.state === 'sleep') return 'asleep';
    if (this.holdingSign || !this.isGrounded()) return null;
    if (!TIMED.has(this.state) && !RUBBED.has(this.state)) return null;
    if (this.state === kind) this.stateEndsAt = performance.now() + 1200;
    else this.setState(kind, 1200);
    this.noteInput();
    return kind;
  }

  hop() {
    if (!this.isGrounded() || !TIMED.has(this.state)) return false;
    this.surface = null; // lands back on the same ledge
    this.vy = -this.cfg.physics.hopVelocity;
    return true;
  }

  doTrick() {
    const tricks = this.cfg.tricks ?? [];
    if (!tricks.length || !this.isGrounded() || !TIMED.has(this.state)) return false;
    this.trick = pick(tricks);
    this.setState('trick', this.trick.durationMs);
    return true;
  }

  eat(durationMs) {
    this.setState('eat', durationMs);
  }

  cuddle() {
    this.setState('excited', 1500);
  }

  holdSign() {
    this.holdingSign = true;
    if (this.state === 'sleep') this.wake();
    if (this.isGrounded() && this.state !== 'dragged') this.setState('sign');
  }

  dropSign() {
    this.holdingSign = false;
    if (this.state === 'sign') this.setState('excited', 1000);
  }

  startDrag() {
    this.vx = 0;
    this.vy = 0;
    this.surface = null;
    this.setState('dragged');
  }

  dragTo(x, y) {
    this.x = clamp(x, 0, this.maxX());
    this.y = clamp(y, 0, this.world.height - this.h + this.baseline);
  }

  // Released: thrown if the mouse was still moving fast, otherwise just dropped.
  endDrag(vx = 0, vy = 0) {
    const speed = Math.hypot(vx, vy);
    if (speed < 300) {
      const ledge = this.ledgeUnderfoot();
      if (ledge) return this.standOn(ledge);
      this.setState(this.y < this.groundY() ? 'fall' : 'idle');
      return;
    }
    const k = Math.min(1, (this.cfg.physics.maxFlingSpeed ?? 3000) / speed);
    this.setState('fall');
    this.vx = vx * k;
    this.vy = vy * k;
    this.spin = 0;
    if (Math.abs(this.vx) > 50) this.dir = Math.sign(this.vx);
    this.onEvent?.('fling');
  }

  // Pops out next to the cursor and drops from there.
  summon(x, y, offset) {
    this.sleepReason = null;
    this.surface = null;
    this.exiting = false;
    this.x = clamp(x - this.w / 2 + offset, 0, this.maxX());
    this.y = clamp(y - this.h / 2, 0, this.world.height - this.h);
    this.vx = 0;
    this.vy = 0;
    this.noteInput();
    const ledge = this.ledgeUnderfoot();
    if (ledge) return this.standOn(ledge);
    this.setState('fall');
  }

  sleep(reason) {
    if (this.state === 'sleep') {
      if (reason === 'manual' || reason === 'lock') this.sleepReason = reason;
      return;
    }
    this.sleepReason = reason;
    if (!this.isGrounded() || ATTACHED.has(this.state)) this.surface = null; // never asleep mid-air or on a wall
    this.y = this.groundY();
    this.vx = 0;
    this.vy = 0;
    this.motion = restingMotion();
    this.setState('sleep');
  }

  wake() {
    if (this.state !== 'sleep') return;
    this.sleepReason = null;
    this.noteInput();
    this.setState('idle');
    this.onEvent?.('wake');
  }
}
