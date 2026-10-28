// Wires the pets to the window: render loop, mouse input (petting, dragging, throwing), toys,
// treats and furniture, reminder signs, speech, sounds, seasonal decorations and messages from main.

import { Pet } from './pet.js';
import { PetView } from './view.js';
import { Toy } from './toy.js';
import { Prop } from './props.js';
import { FURNITURE, TREAT } from './pixelart.js';
import { loadSheet, validateSheet } from './sprite.js';
import { SeasonEffects } from './seasons.js';
import * as fx from './effects.js';
import { configureSound, setQuiet, play } from './sound.js';
import { phrase, greetingKey } from './phrases.js';

const DOUBLE_CLICK_MS = 300;
const DRAG_THRESHOLD_PX = 4;
const FLING_SAMPLE_MS = 100; // release velocity is averaged over this much pointer movement
const EAT_MS = 2500;
const BALL_GAME_MS = 30_000;
const YARN_IDLE_MS = 60_000; // yarn nobody has touched for a minute gets tidied away
const LASER_MS = 2 * 60_000;
const MAX_TREATS = 5;
const RUB_WINDOW_MS = 1200;
const REMINDERS = new Set(['break', 'water', 'pomodoro-focus', 'pomodoro-short', 'pomodoro-long', 'pomodoro-stop']);
const SPEECH_PRIORITY = { chatter: 0, reaction: 1, reminder: 2 };

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const randomMinutes = (min, max) => (min + Math.random() * (max - min)) * 60_000;

const api = window.petAPI;
let config = await api.getConfig();
// This window covers one monitor; `edges` says which sides lead on to another monitor.
let display = (await api.getDisplay()) ?? { primary: true, edges: {} };
const sheet = await loadSheet(config.spriteUrl);
const usable = validateSheet(sheet, config);
configureSound(config.sound, config.soundUrls);

// Shared by the pets on this monitor (see pet.js).
const world = {
  width: window.innerWidth,
  height: window.innerHeight,
  edges: display.edges,
  platforms: [],
  sides: [],
  pets: [],
  toys: [new Toy($('ball'), 'ball'), new Toy($('yarn'), 'yarn')],
  treats: [],
  furniture: [],
  laser: { on: false },
  cursor: null, // { x, y, movedAt }; forwarded by main even while click-through
  night: config.ambient.night,
  tired: false, // low battery
};
const [ball, yarn] = world.toys;
const views = new Map(); // pet id -> PetView
const signs = new Map(); // reminder id -> pet holding it
const seasonFx = new SeasonEffects($('season-back'), $('season-front'));
const laserEl = $('laser');

let quiet = config.ambient.quiet; // do not disturb
let paused = false;
let lastHome = null;
let hovered = null; // pet under the cursor (shows its name tag)
let press = null; // left button held on something: { kind, target, x, y, grabX, grabY, dragging, samples }
let pressingSign = false; // left button held on a reminder sign's button
let lastPointerMoveAt = 0;
let pendingClick = null; // { pet, timer } while waiting to see if a click becomes a double click
let capturing = false; // true while the window takes mouse input instead of passing it through
let loopScheduled = false;
let lastTick = 0;
let ballKicks = 0;
let ballKicksNeeded = 3;
let ballEndsAt = 0;
let laserTimer = null;
let reportedStatus = '';
const speechCooldowns = new Map(); // `${petId}:${key}` -> time it may be said again
const rub = { pet: null, lastX: 0, dir: 0, travel: 0, flips: [] };
setQuiet(quiet);

const petById = (id) => world.pets.find((pet) => pet.id === id);
const leader = () => world.pets.find((pet) => pet.state !== 'sleep') ?? world.pets[0];
const props = () => [...world.furniture, ...world.treats];

// ---- pets coming and going ---------------------------------------------------------

function addPet(profile) {
  const pet = new Pet(config, world, usable, profile.id);
  const view = new PetView($('pets'), $('overlay'), sheet);
  view.setup(config, pet);
  view.setNight(world.night);
  pet.nextChatterAt = performance.now() + randomMinutes(2, 6);
  pet.onStateChange = (state, prev) => onPetState(pet, state, prev);
  pet.onEvent = (type, data) => onPetEvent(pet, type, data);
  world.pets.push(pet);
  views.set(pet.id, view);
  return pet;
}

// `quietly`: it walked over to another monitor rather than saying goodbye.
function removePet(pet, { quietly = false } = {}) {
  if (!world.pets.includes(pet)) return;
  if (!quietly) {
    fx.poof({ x: pet.cx(), y: pet.y + pet.h / 2 });
    play('poof');
  }
  views.get(pet.id).destroy();
  views.delete(pet.id);
  world.pets.splice(world.pets.indexOf(pet), 1);
  for (const [id, holder] of signs) if (holder === pet) signs.delete(id);
  if (press?.target === pet) press = null;
  if (hovered === pet) hovered = null;
  if (pendingClick?.pet === pet) {
    clearTimeout(pendingClick.timer);
    pendingClick = null;
  }
}

// `pets` is everyone; `here` the ids of the pets on this monitor.
function syncRoster({ pets: list, here }) {
  const all = new Set(list.map((p) => p.id));
  const mine = new Set(here);
  for (const pet of [...world.pets]) if (!mine.has(pet.id)) removePet(pet, { quietly: all.has(pet.id) });
  for (const profile of list) {
    if (!mine.has(profile.id)) continue;
    const pet = petById(profile.id) ?? addPet(profile);
    pet.profile = profile;
    pet.setMood(profile.mood);
    views.get(pet.id).setProfile(profile);
  }
  const order = list.map((p) => p.id);
  world.pets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); // first pet leads the nap pile
  renderAll();
  reportStatus();
  ensureLoop();
}

// ---- furniture and treats -------------------------------------------------------------

// A spot near the first pet that doesn't overlap other furniture.
function freeSpot(width) {
  const center = leader()?.cx() ?? world.width / 2;
  for (let k = 1; k < 30; k++) {
    const x = clamp(center + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 110 - width / 2, 0, world.width - width);
    if (!world.furniture.some((f) => x < f.x + f.w + 10 && x + width > f.x - 10)) return x;
  }
  return clamp(center, 0, world.width - width);
}

// Furniture lives on the main monitor.
function syncHome(home) {
  if (!display.primary) home = { ...home, placed: {} };
  lastHome = home;
  for (const prop of [...world.furniture]) {
    if (prop.id in home.placed) continue;
    fx.poof({ x: prop.cx, y: prop.y + prop.h / 2 });
    prop.remove();
    world.furniture.splice(world.furniture.indexOf(prop), 1);
  }
  for (const [id, spot] of Object.entries(home.placed)) {
    if (world.furniture.some((p) => p.id === id) || !FURNITURE[id]) continue;
    const isNew = spot.x === null; // just bought: drops in from above
    const width = (FURNITURE[id].rows[0].length + 2) * config.scale;
    const prop = new Prop($('furniture'), {
      id,
      kind: id,
      art: FURNITURE[id],
      scale: config.scale,
      world,
      x: spot.x ?? freeSpot(width),
      y: isNew ? world.height * 0.25 : undefined,
    });
    prop.moved = isNew; // report where it lands
    world.furniture.push(prop);
  }
  ensureLoop();
}

// Rebuilt at the new size when the pet scale changes.
function rebuildFurniture() {
  if (!lastHome) return;
  const placed = { ...lastHome.placed };
  for (const prop of world.furniture) {
    placed[prop.id] = { x: prop.x };
    prop.remove();
  }
  world.furniture = [];
  syncHome({ ...lastHome, placed });
}

function onPropLanded(prop) {
  if (prop.kind === 'treat') {
    const nearest = [...world.pets].sort((a, b) => Math.abs(a.cx() - prop.cx) - Math.abs(b.cx() - prop.cx))[0];
    speak(nearest, 'treatSpotted', { chance: 0.6, cooldownMs: 10_000 });
    return;
  }
  play('thunk');
  if (!prop.moved) return;
  prop.moved = false;
  api.placeFurniture(prop.id, prop.x);
}

function wakeNappers() {
  for (const pet of world.pets) {
    if (pet.state === 'sleep' && pet.sleepReason === 'idle') pet.wake();
    pet.noteInput();
  }
}

function dropTreat() {
  if (world.treats.length >= MAX_TREATS) world.treats.shift().remove();
  const cursor = world.cursor;
  const lead = leader();
  const x = cursor ? cursor.x : (lead ? lead.cx() + (Math.random() - 0.5) * 300 : world.width / 2);
  const treat = new Prop($('furniture'), {
    id: `treat-${Date.now()}`,
    kind: 'treat',
    art: TREAT,
    scale: config.scale,
    world,
    x: x - 12,
    y: cursor ? Math.min(cursor.y, world.height - 60) : 0,
  });
  world.treats.push(treat);
  wakeNappers();
  play('boop');
  ensureLoop();
}

// ---- toys ------------------------------------------------------------------------------

function setLaser(on) {
  world.laser.on = on;
  clearTimeout(laserTimer);
  if (on) {
    laserTimer = setTimeout(() => setLaser(false), LASER_MS);
    wakeNappers();
    play('pew');
    speak(leader(), 'laser', { chance: 0.7 });
    api.sendEvent('toy', null);
  }
  placeLaser();
  reportStatus();
  ensureLoop();
}

function placeLaser() {
  const cursor = world.cursor;
  laserEl.hidden = !world.laser.on || !cursor;
  if (cursor) laserEl.style.transform = `translate(${Math.round(cursor.x) - 6}px, ${Math.round(cursor.y) - 6}px)`;
}

function throwYarn() {
  const cursor = world.cursor;
  const lead = leader();
  const x = cursor ? cursor.x : (lead ? lead.cx() + 200 : world.width / 2);
  const y = cursor ? Math.min(cursor.y, world.height - 40) : world.height * 0.5;
  yarn.spawn(clamp(x, 20, world.width - 20), y, (Math.random() - 0.5) * 300, -200);
  wakeNappers();
  speak(lead, 'yarn', { chance: 0.6 });
  api.sendEvent('toy', null);
  ensureLoop();
}

function startPlay() {
  const first = leader();
  if (!first) return;
  wakeNappers();
  const center = first.cx();
  const side = center < world.width / 2 ? 1 : -1; // toss it toward the roomier side
  const x = Math.min(world.width - 40, Math.max(40, center + side * (220 + Math.random() * 220)));
  ball.spawn(x, world.height * 0.5, -side * 150, -250);
  ballKicks = 0;
  ballKicksNeeded = 1 + 2 * world.pets.length;
  ballEndsAt = performance.now() + BALL_GAME_MS;
  speak(first, 'playStart');
  ensureLoop();
}

function onKick(toy) {
  play(toy === yarn ? 'boop' : 'kick');
  for (const pet of world.pets) pet.noteInput(); // playing counts as activity
  if (toy !== ball || ++ballKicks < ballKicksNeeded) return;
  ball.inPlay = false; // everyone stops chasing; the last kick flies off and the game wraps up
  ballEndsAt = performance.now() + 1200;
}

function endPlay(completed) {
  ball.finish();
  if (!completed) return;
  speak(leader(), 'playDone');
  play('trick');
  api.sendEvent('played', null); // every pet played
}

function putToysAway() {
  if (ball.active) endPlay(false);
  if (yarn.active) yarn.finish();
  setLaser(false);
}

// ---- rendering and loop -------------------------------------------------------------

function renderAll() {
  for (const pet of world.pets) views.get(pet.id).render(pet, world.width);
  for (const prop of props()) prop.render();
}

// The loop stops completely while every pet sleeps and nothing moves, or while paused.
function running() {
  if (paused) return false;
  return (
    world.toys.some((t) => t.active) ||
    props().some((p) => !p.isResting()) ||
    world.pets.some((pet) => pet.state !== 'sleep')
  );
}

function ensureLoop() {
  if (loopScheduled || !running()) return;
  loopScheduled = true;
  lastTick = performance.now();
  setTimeout(tick, 0);
}

function tick() {
  loopScheduled = false;
  if (!running()) return;

  const now = performance.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;
  const { gravity } = config.physics;

  for (const toy of world.toys) {
    if (!toy.active) continue;
    toy.update(dt, world.width, world.height, gravity * 0.8);
    toy.render();
  }
  if (ball.active && now >= ballEndsAt) endPlay(true);
  if (yarn.active && !yarn.held && now - yarn.touchedAt > YARN_IDLE_MS) yarn.finish();
  for (const prop of props()) if (prop.update(dt, gravity)) onPropLanded(prop);

  for (const pet of world.pets) {
    pet.update(dt, now);
    maybeChatter(pet, now);
  }
  renderAll();
  updateHover();

  if (!running()) return; // everyone fell asleep this tick: frames are drawn, loop stops here
  loopScheduled = true;
  const smooth =
    world.toys.some((t) => t.active) || props().some((p) => !p.isResting()) || world.pets.some((pet) => pet.needsSmoothMotion());
  setTimeout(tick, 1000 / (smooth ? (config.motionFps ?? config.fps) : config.fps));
}

function applySeason() {
  seasonFx.apply(!paused && config.seasons.enabled ? config.season : null, {
    width: world.width,
    height: world.height,
    scale: config.scale,
    heads: () => world.pets.map((pet) => pet.headPoint()),
  });
}

function reportStatus() {
  const status = {
    sleeping: world.pets.length ? world.pets.every((pet) => pet.state === 'sleep') : null, // null: no pets here
    laser: world.laser.on,
  };
  const key = JSON.stringify(status);
  if (key === reportedStatus) return;
  reportedStatus = key;
  api.reportStatus(status);
}

// ---- speech -------------------------------------------------------------------------

// Reminders always show; reactions need speech bubbles on and no do-not-disturb; chatter also
// needs chatter on.
function speak(pet, key, { kind = 'reaction', vars, chance = 1, cooldownMs = 0 } = {}) {
  if (!pet || !views.has(pet.id)) return;
  const { speech } = config;
  if (kind !== 'reminder' && (paused || quiet || !speech.enabled)) return;
  if (kind === 'chatter' && !speech.chatter) return;
  const now = performance.now();
  const cooldownKey = `${pet.id}:${key}`;
  if (now < (speechCooldowns.get(cooldownKey) ?? 0) || Math.random() >= chance) return;
  const view = views.get(pet.id);
  const ms = kind === 'reminder' ? speech.durationMs * 2 : speech.durationMs;
  if (!view.say(phrase(key, vars), { priority: SPEECH_PRIORITY[kind], ms })) return;
  speechCooldowns.set(cooldownKey, now + cooldownMs);
  view.render(pet, world.width);
}

function maybeChatter(pet, now) {
  if (now < pet.nextChatterAt) return;
  pet.nextChatterAt = now + randomMinutes(3, 7) * world.pets.length; // more pets, each talks less
  if (!['idle', 'sit', 'walk'].includes(pet.state)) return;
  if (pet.mood === 'hungry' || pet.mood === 'sad') return speak(pet, pet.mood, { cooldownMs: 10 * 60_000 });
  speak(pet, pet.mood === 'happy' && Math.random() < 0.5 ? 'happy' : 'idle', { kind: 'chatter', chance: 0.5 });
}

// ---- moving between monitors ----------------------------------------------------------

// The pet walked or flew off an edge that leads to another monitor: main moves it there.
async function handOver(pet, side) {
  const onFloor = pet.isGrounded() && !pet.surface;
  const moved = await api
    .transferPet(pet.id, {
      side,
      grounded: onFloor,
      feetY: pet.feetY(),
      vx: pet.vx,
      vy: pet.vy,
      dir: pet.dir,
      state: pet.state,
      idleMs: performance.now() - pet.lastInputAt,
    })
    .catch(() => false);
  if (moved) removePet(pet, { quietly: true });
  else pet.stayHere();
  ensureLoop();
}

// Dragged and let go beyond this monitor's edge: if that's on another monitor, it lands there.
async function dropElsewhere(pet, x, feetY) {
  const moved = await api.transferPet(pet.id, { x, y: feetY, dir: pet.dir, idleMs: 0 }).catch(() => false);
  if (moved) removePet(pet, { quietly: true });
  else pet.endDrag(0, 0);
  ensureLoop();
}

// Safety net: a pet that's been out of sight here for two checks in a row (a hand-over that never
// happened, a window it rode off the screen, a bad position) drops back onto the floor.
const strays = new Map(); // pet id -> checks it's been out of sight
setInterval(() => {
  for (const pet of world.pets) {
    if (pet.state === 'dragged' || !pet.outOfSight()) {
      strays.delete(pet.id);
      continue;
    }
    const checks = (strays.get(pet.id) ?? 0) + 1;
    strays.set(pet.id, checks);
    if (checks < 2) continue;
    strays.delete(pet.id);
    const x = Number.isFinite(pet.x) ? clamp(pet.cx(), pet.w / 2, world.width - pet.w / 2) : world.width / 2;
    pet.summon(x, world.height - pet.h / 2, 0);
    renderAll();
    ensureLoop();
  }
}, 2000);

api.onArrive(({ profile, arrival }) => {
  const pet = petById(profile.id) ?? addPet(profile);
  pet.profile = profile;
  pet.setMood(profile.mood);
  views.get(pet.id).setProfile(profile);
  pet.enterMonitor(arrival);
  renderAll();
  reportStatus();
  ensureLoop();
});

api.onDisplay(async (next) => {
  display = next;
  world.edges = next.edges;
  syncHome(await api.getHome()); // furniture follows the main monitor
});

// ---- pet state and events -----------------------------------------------------------

function onPetState(pet, state, prev) {
  if (state === 'eat') {
    play('munch');
    if (!usable.has('eat')) fx.food(pet.headPoint(), EAT_MS);
    if (pet.pendingYum) speak(pet, 'yum');
    pet.pendingYum = false;
  }
  if (state !== 'sleep' && prev !== 'sleep') return;
  views.get(pet.id)?.showZzz(state === 'sleep');
  reportStatus();
  if (state === 'sleep' && ball.active && world.pets.every((p) => p.state === 'sleep')) endPlay(false);
}

function onPetEvent(pet, type, data) {
  switch (type) {
    case 'exit':
      handOver(pet, data.side);
      break;
    case 'mount':
      play('jump');
      speak(pet, 'mount', { chance: 0.3, cooldownMs: 60_000 });
      break;
    case 'typing-fast':
      if (pet === leader()) speak(pet, 'typingFast', { cooldownMs: 3 * 60_000 });
      break;
    case 'fling':
      play('whoosh');
      speak(pet, 'fling', { chance: 0.6 });
      api.sendEvent('fling', pet.id);
      break;
    case 'bounce':
      play('thud');
      if (data.impact > 1800 && performance.now() > 5000) speak(pet, 'hardLanding', { chance: 0.4, cooldownMs: 10_000 });
      break;
    case 'land':
      if (data.impact > 900) play('thud');
      break;
    case 'pounce-start':
      play('squeak');
      break;
    case 'pounce':
      api.sendEvent(data.caught ? 'catch' : 'pounce', pet.id);
      if (data.caught) {
        fx.heart(pet.headPoint());
        speak(pet, 'caught', { cooldownMs: data.laser ? 15_000 : 0 });
      }
      break;
    case 'kick':
      onKick(data.toy);
      break;
    case 'ate-treat': {
      world.treats.splice(world.treats.indexOf(data.treat), 1);
      data.treat.remove();
      fx.sparkles(pet.headPoint(), 6);
      speak(pet, 'ateTreat', { chance: 0.6 });
      api.sendEvent('treat', pet.id);
      break;
    }
    case 'scratch':
      speak(pet, 'scratch', { chance: 0.4, cooldownMs: 60_000 });
      api.sendEvent('scratch', pet.id);
      break;
    case 'sniff':
      speak(pet, 'sniff', { chance: 0.5, cooldownMs: 60_000 });
      break;
    case 'wake':
      play('yawn');
      speak(pet, 'wake', { chance: 0.6 });
      break;
    case 'chase-friend':
      speak(pet, 'chaseFriend', { chance: 0.5 });
      speak(data.other, 'fleeing', { chance: 0.4 });
      break;
    case 'tag':
      play('tag');
      fx.heart(pet.headPoint());
      fx.heart(data.other.headPoint());
      speak(pet, 'tag', { chance: 0.7 });
      api.sendEvent('tag', pet.id);
      api.sendEvent('tagged', data.other.id);
      break;
    case 'jump':
      play('jump');
      speak(pet, 'jump', { chance: 0.15 });
      break;
    case 'climb':
      speak(pet, 'climb', { chance: 0.3, cooldownMs: 60_000 });
      break;
  }
}

// ---- mouse ----------------------------------------------------------------------------

// Topmost pet under a point (later pets are drawn on top).
function petAt(x, y) {
  const pad = config.hitboxPadding ?? 0;
  for (let i = world.pets.length - 1; i >= 0; i--) {
    if (world.pets[i].contains(x, y, pad)) return world.pets[i];
  }
  return null;
}

// What can be grabbed at a point: a toy (small, so it wins over a pet behind it), a pet, or a piece
// of furniture.
function grabbableAt(x, y) {
  const toy = world.toys.find((t) => t.contains(x, y));
  if (toy) return { kind: 'toy', target: toy };
  const pet = petAt(x, y);
  if (pet) return { kind: 'pet', target: pet };
  const prop = [...world.furniture].reverse().find((p) => p.contains(x, y));
  if (prop) return { kind: 'prop', target: prop };
  return null;
}

const overSign = (x, y) => [...views.values()].some((view) => view.signContains(x, y));

// Re-checked on every mouse move *and* every tick, since pets can walk out from under a still
// cursor; otherwise the window would keep swallowing clicks meant for the desktop.
function updateHover() {
  const cursor = world.cursor;
  const over = cursor ? grabbableAt(cursor.x, cursor.y) : null;
  const tagged = press?.kind === 'pet' ? press.target : over?.kind === 'pet' ? over.target : null;
  if (tagged !== hovered) {
    if (hovered) views.get(hovered.id)?.showTag(false);
    hovered = tagged;
    if (hovered) {
      views.get(hovered.id).showTag(true);
      views.get(hovered.id).render(hovered, world.width);
    }
  }
  const want =
    !paused && (press !== null || pressingSign || over !== null || (cursor !== null && overSign(cursor.x, cursor.y)));
  if (want !== capturing) {
    capturing = want;
    api.setIgnoreMouse(!want);
  }
}

// Rubbing: the cursor going back and forth over a pet. Three strokes within a moment is petting,
// fast ones tickle.
function trackRub(pet, x, now) {
  if (pet !== rub.pet) {
    Object.assign(rub, { pet, lastX: x, dir: 0, travel: 0, flips: [] });
    return;
  }
  const dx = x - rub.lastX;
  rub.lastX = x;
  if (!dx) return;
  const dir = Math.sign(dx);
  if (dir !== rub.dir) {
    if (rub.dir !== 0 && rub.travel >= 6) rub.flips.push(now);
    rub.dir = dir;
    rub.travel = 0;
  }
  rub.travel += Math.abs(dx);
  rub.flips = rub.flips.filter((t) => now - t < RUB_WINDOW_MS);
  if (rub.flips.length < 3) return;
  const fast = rub.flips.filter((t) => now - t < 700).length >= 5;
  onRub(pet, fast ? 'tickled' : 'petted', now);
}

function onRub(pet, kind, now) {
  const result = pet.rub(kind);
  if (!result) return;
  ensureLoop();
  if (now < (pet.nextRubFxAt ?? 0)) return;
  pet.nextRubFxAt = now + 700;
  const head = pet.headPoint();
  if (result === 'asleep') {
    fx.heart(head); // purrs in its sleep
    if (now >= (pet.nextPurrAt ?? 0)) {
      pet.nextPurrAt = now + 2500;
      play('purr');
    }
    return;
  }
  if (result === 'petted') {
    fx.heart(head);
    if (now >= (pet.nextPurrAt ?? 0)) {
      pet.nextPurrAt = now + 2500;
      play('purr');
    }
    speak(pet, 'petted', { chance: 0.5, cooldownMs: 8000 });
  } else {
    fx.giggle(head);
    play('giggle');
    speak(pet, 'tickled', { chance: 0.6, cooldownMs: 6000 });
  }
  if (now >= (pet.nextRubCreditAt ?? 0)) {
    pet.nextRubCreditAt = now + 3000;
    api.sendEvent(result, pet.id);
  }
}

function wakePet(pet) {
  pet.wake();
  ensureLoop();
}

function singleClick(pet) {
  if (!world.pets.includes(pet)) return;
  fx.heart(pet.headPoint());
  play('boop');
  api.sendEvent('click', pet.id);
  if (pet.hop()) ensureLoop();
}

function handleClick(pet) {
  if (pet.state === 'sleep') return wakePet(pet);

  if (pendingClick?.pet === pet) {
    clearTimeout(pendingClick.timer);
    pendingClick = null;
    if (pet.doTrick()) {
      play('trick');
      speak(pet, 'trick', { chance: 0.4 });
      api.sendEvent('trick', pet.id);
      ensureLoop();
    }
    return;
  }

  if (pendingClick) {
    clearTimeout(pendingClick.timer); // a click on another pet: the first one was a single click
    singleClick(pendingClick.pet);
  }
  // Wait to see whether this becomes a double click before reacting.
  pendingClick = {
    pet,
    timer: setTimeout(() => {
      pendingClick = null;
      singleClick(pet);
    }, DOUBLE_CLICK_MS),
  };
}

// Average pointer velocity (px/s) over the last moments of a drag.
function releaseVelocity(samples, now) {
  const recent = samples.filter((s) => now - s.t <= FLING_SAMPLE_MS);
  if (recent.length < 2) return [0, 0];
  const first = recent[0];
  const last = recent.at(-1);
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? [(last.x - first.x) / dt, (last.y - first.y) / dt] : [0, 0];
}

function startDragging() {
  const { kind, target } = press;
  press.dragging = true;
  if (kind === 'pet') {
    if (target.state === 'sleep') target.wake();
    target.startDrag();
    views.get(target.id).root.classList.add('grabbing');
  }
  ensureLoop();
}

function dragTo(x, y) {
  const { kind, target, grabX, grabY } = press;
  if (kind === 'pet') {
    target.dragTo(x - grabX, y - grabY);
    views.get(target.id).render(target, world.width);
  } else if (kind === 'toy') {
    target.hold(clamp(x, target.r, world.width - target.r), clamp(y, target.r, world.height - target.r));
    target.render();
  } else {
    target.hold(x - grabX, y - grabY);
    target.render();
  }
}

function releasePress(isClick, timeStamp = performance.now(), point = null) {
  if (!press) return;
  const { kind, target, dragging, samples, grabX, grabY } = press;
  press = null;
  const [vx, vy] = dragging ? releaseVelocity(samples, timeStamp) : [0, 0];
  if (kind === 'pet') {
    views.get(target.id)?.root.classList.remove('grabbing');
    const outside = point && (point.x < 0 || point.x >= world.width || point.y < 0 || point.y >= world.height);
    if (dragging && outside) dropElsewhere(target, point.x - grabX + target.w / 2, point.y - grabY + target.h);
    else if (dragging) target.endDrag(vx, vy);
    else if (isClick) handleClick(target);
  } else if (kind === 'toy') {
    if (dragging) target.release(vx, vy);
    else if (isClick) target.kick(Math.random() < 0.5 ? -1 : 1); // a flick
  } else if (dragging) {
    target.drop();
    target.moved = true; // furniture: remember where it lands
  }
  ensureLoop();
  updateHover();
}

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || paused) return;
  const hit = grabbableAt(e.clientX, e.clientY);
  if (!hit) {
    // Keep taking the mouse until the button comes up, so the click lands on the sign.
    pressingSign = overSign(e.clientX, e.clientY);
    return;
  }
  const { target } = hit;
  const origin = hit.kind === 'pet' ? { x: target.x, y: target.y } : hit.kind === 'prop' ? { x: target.x, y: target.y } : { x: 0, y: 0 };
  press = { ...hit, x: e.clientX, y: e.clientY, grabX: e.clientX - origin.x, grabY: e.clientY - origin.y, dragging: false, samples: [] };
  document.body.setPointerCapture(e.pointerId);
  if (hit.kind === 'pet') target.noteInput();
  updateHover();
});

window.addEventListener('pointermove', (e) => {
  const now = performance.now();
  lastPointerMoveAt = now;
  world.cursor = { x: e.clientX, y: e.clientY, movedAt: now };
  placeLaser();

  if (press && !press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD_PX) startDragging();
  if (press?.dragging) {
    press.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (press.samples.length > 20) press.samples.shift();
    dragTo(e.clientX, e.clientY);
  } else if (!press) {
    const pet = petAt(e.clientX, e.clientY);
    if (pet) trackRub(pet, e.clientX, now);
    else rub.pet = null;
  }

  updateHover();
});

window.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  releasePress(true, e.timeStamp, { x: e.clientX, y: e.clientY });
  if (pressingSign) setTimeout(() => (pressingSign = false), 0); // after the click event
});
window.addEventListener('pointercancel', () => {
  pressingSign = false;
  releasePress(false);
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (paused) return;
  const hit = grabbableAt(e.clientX, e.clientY);
  if (hit?.kind === 'pet') {
    // A pet holding a reminder sign gets Done / Snooze in its menu too.
    const reminderId = [...signs].find(([, holder]) => holder === hit.target)?.[0] ?? null;
    api.showContextMenu(hit.target.id, reminderId);
  } else if (hit?.kind === 'prop') {
    api.showFurnitureMenu(hit.target.id);
  }
});

// The cursor position also arrives from main (see onCursor below), so it doesn't depend only on the
// mouse moves Electron forwards to the click-through window. No 'mouseleave' handling: the window
// covers the whole work area, so a stale position is harmless.

window.addEventListener('resize', () => {
  world.width = window.innerWidth;
  world.height = window.innerHeight;
  for (const pet of world.pets) {
    pet.resize();
    views.get(pet.id).setup(config, pet);
  }
  for (const prop of props()) prop.resize();
  applySeason();
  renderAll();
  updateHover();
  ensureLoop();
});

// ---- reminder signs -------------------------------------------------------------------

function closeSign(id, action) {
  const pet = signs.get(id);
  signs.delete(id);
  if (pet && views.has(pet.id)) {
    views.get(pet.id).hideSign();
    pet.dropSign();
  }
  api.reminderAction(id, action);
  play(action === 'done' ? 'coin' : 'boop', { force: true });
  renderAll();
  updateHover();
  ensureLoop();
}

api.onReminder(({ id, text }) => {
  const pet = world.pets.find((p) => !p.holdingSign) ?? leader();
  if (!pet) return;
  for (const [otherId, holder] of signs) if (holder === pet) signs.delete(otherId); // replaced
  pet.holdSign();
  views.get(pet.id).showSign(text, {
    onDone: () => closeSign(id, 'done'),
    onSnooze: () => closeSign(id, 'snooze'),
  });
  signs.set(id, pet);
  fx.sparkles(pet.headPoint(), 8);
  play('chime', { force: true }); // your own reminders get through do-not-disturb
  renderAll();
  updateHover();
  ensureLoop();
});

// ---- messages from main ---------------------------------------------------------------

api.onRoster(syncRoster);
api.onHome(syncHome);

// Cursor position polled by main: used only when no real mouse move has arrived just now.
api.onCursor(({ x, y }) => {
  const now = performance.now();
  if (now - lastPointerMoveAt < 150 || press) return;
  world.cursor = { x, y, movedAt: now };
  placeLaser();
  updateHover();
});

api.onPlatforms(({ ledges, sides }) => {
  world.platforms = ledges;
  world.sides = sides;
  for (const pet of world.pets) {
    // Climbing a window side that went away: let go.
    if (pet.followSide(sides) && pet.state === 'climb') {
      pet.letGo();
      continue;
    }
    if (!pet.followSurface(ledges)) continue; // still standing (possibly riding a moved window)
    pet.loseFooting();
    speak(pet, 'whoa', { chance: 0.5, cooldownMs: 20_000 });
  }
  for (const prop of props()) prop.follow(ledges);
  renderAll();
  updateHover();
  ensureLoop();
});

api.onKeyActivity(() => {
  if (paused) return;
  for (const pet of world.pets) {
    pet.noteInput();
    if (pet.state === 'sleep' && pet.sleepReason === 'idle') wakePet(pet);
  }
});

api.onTypingRate((perTenSec) => {
  if (!paused) for (const pet of world.pets) pet.setTypingRate(perTenSec);
});

api.onSay(({ key, vars, petId }) => {
  const pet = (petId && petById(petId)) || leader();
  if (!pet) return;
  const reminder = REMINDERS.has(key);
  if (reminder && pet.state === 'sleep' && pet.sleepReason === 'idle') wakePet(pet);
  speak(pet, key, { kind: reminder ? 'reminder' : 'reaction', vars });
  if (!reminder) return;
  play('chime');
  if (!paused && pet.hop()) ensureLoop();
});

// Called to the cursor, or (`home`) brought back to the taskbar next to the tray.
api.onSummon(({ x, y, home, petIds }) => {
  const called = petIds ? world.pets.filter((pet) => petIds.includes(pet.id)) : world.pets;
  if (!called.length) return;
  if (home) {
    x = world.width - 200;
    y = world.height - called[0].h / 2;
  }
  fx.poof({ x, y });
  play('poof');
  called.forEach((pet, i) => pet.summon(x, y, (i - (called.length - 1) / 2) * pet.w * 0.9));
  if (home) speak(called[0], 'backHome');
  else speak(called[0], 'summon', { chance: 0.7 });
  renderAll();
  ensureLoop();
});

api.onSystem(({ event, awayMin }) => {
  if (event === 'lock') {
    for (const pet of world.pets) if (!pet.holdingSign) pet.sleep('lock'); // curl up while you're gone
    renderAll();
    return;
  }
  for (const pet of world.pets) {
    if (pet.state === 'sleep' && pet.sleepReason !== 'manual') pet.wake();
  }
  speak(leader(), awayMin >= 5 ? 'missedYou' : 'welcomeBack');
  for (const pet of world.pets) {
    fx.heart(pet.headPoint());
    pet.hop();
  }
  ensureLoop();
});

api.onAmbient(({ night, quiet: q }) => {
  const nightfall = night && !world.night;
  world.night = night;
  quiet = q;
  setQuiet(q);
  for (const view of views.values()) view.setNight(night);
  if (nightfall) speak(leader(), 'nightfall');
  renderAll();
});

api.onLevelUp(({ id, name, level, unlocks }) => {
  const pet = petById(id);
  if (pet) {
    fx.sparkles(pet.headPoint());
    speak(pet, 'levelUp', { vars: { level } });
    if (!paused && pet.hop()) ensureLoop();
  }
  if (quiet) return;
  play('levelup');
  fx.toast({
    icon: '⭐',
    kicker: 'Level up',
    title: `${name} reached level ${level}!`,
    description: unlocks.length ? `New hat: ${unlocks.join(', ')}` : 'Keep playing together!',
  });
});

api.onToast(({ sound, ...toast }) => {
  if (quiet) return;
  if (sound) play(sound);
  fx.toast(toast);
});

api.onConfig((next) => {
  const rescaled = next.scale !== config.scale;
  config = next;
  for (const pet of world.pets) {
    pet.applyConfig(next);
    views.get(pet.id).setup(next, pet);
  }
  if (rescaled) rebuildFurniture();
  configureSound(next.sound, next.soundUrls);
  applySeason();
  renderAll();
  updateHover();
  ensureLoop();
});

api.onCommand(({ type, petId, on, id, action }) => {
  const pet = petId ? petById(petId) : null;
  switch (type) {
    case 'pause':
      paused = true;
      releasePress(false);
      applySeason();
      updateHover();
      break;
    case 'resume':
      paused = false;
      for (const p of world.pets) p.resetActivity(); // don't fall asleep the instant we resume
      applySeason();
      ensureLoop();
      break;
    case 'sleep':
      for (const p of world.pets) if (!p.holdingSign) p.sleep('manual');
      renderAll();
      updateHover();
      break;
    case 'wake':
      for (const p of world.pets) p.wake();
      ensureLoop();
      break;
    case 'eat':
      if (paused || !pet) break;
      if (pet.state === 'sleep') pet.wake();
      pet.pendingYum = true;
      pet.goEat(EAT_MS); // runs to the bowl first if there is one
      ensureLoop();
      break;
    case 'full':
      speak(pet, 'full');
      break;
    case 'cuddle':
      if (paused || !pet) break;
      if (pet.state === 'sleep') pet.wake();
      pet.cuddle();
      fx.heartBurst(pet.headPoint());
      play('purr');
      speak(pet, 'cuddle');
      ensureLoop();
      break;
    case 'play':
      if (!paused) startPlay();
      break;
    case 'treat':
      dropTreat();
      break;
    case 'laser':
      if (!paused) setLaser(Boolean(on));
      break;
    case 'yarn':
      if (!paused) throwYarn();
      break;
    case 'toys-away':
      putToysAway();
      break;
    case 'reminder': // Done / Snooze picked from the pet's right-click menu
      if (signs.has(id)) closeSign(id, action === 'snooze' ? 'snooze' : 'done');
      break;
  }
});

// ---- battery ------------------------------------------------------------------------

// Low battery (20% or less, not charging) makes the pets sleepy; plugging in perks them up.
navigator
  .getBattery?.()
  .then((battery) => {
    const isLow = () => !battery.charging && battery.level <= 0.2;
    world.tired = isLow();
    const update = () => {
      if (isLow() === world.tired) return;
      world.tired = isLow();
      speak(leader(), world.tired ? 'lowBattery' : 'charging');
    };
    battery.addEventListener('levelchange', update);
    battery.addEventListener('chargingchange', update);
  })
  .catch(() => {});

// ---- start --------------------------------------------------------------------------

syncRoster(await api.getRoster());
const startPlatforms = await api.getPlatforms();
world.platforms = startPlatforms.ledges;
world.sides = startPlatforms.sides;
syncHome(await api.getHome());
for (const view of views.values()) view.setNight(world.night);
applySeason();
ensureLoop();
setTimeout(() => {
  const season = config.season;
  speak(leader(), season && Math.random() < 0.6 ? season : greetingKey());
}, 2000);
