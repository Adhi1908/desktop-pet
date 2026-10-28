'use strict';

// Treats: earned from daily quests (and a small daily bonus), given to the pets as snacks or spent
// in the furniture shop. Also remembers which furniture you own and where it stands. Saved in
// <userData>/home.json.

const fs = require('node:fs');

const STARTING_TREATS = 10;
const DAILY_BONUS = 2;
const QUESTS_PER_DAY = 3;

const SHOP = [
  { id: 'bowl', label: 'Food bowl', price: 8, description: 'Fed pets run over and eat from it' },
  { id: 'cushion', label: 'Cushion', price: 10, description: 'A comfy spot to sit on' },
  { id: 'bed', label: 'Bed', price: 15, description: 'Sleepy pets curl up in it' },
  { id: 'post', label: 'Scratching post', price: 12, description: 'For a good scratch now and then' },
  { id: 'plant', label: 'Plant', price: 5, description: 'Makes the taskbar homey' },
];

// Progress comes from today's stats counters (lib/stats.js).
const QUESTS = [
  { id: 'keys', label: 'Type 2,000 keys', counter: 'keys', target: 2000, reward: 3 },
  { id: 'breaks', label: 'Take 2 breaks (5+ minutes away)', counter: 'breaks', target: 2, reward: 3 },
  { id: 'played', label: 'Play ball with your pets', counter: 'played', target: 1, reward: 2 },
  { id: 'fed', label: 'Feed your pets 3 times', counter: 'fed', target: 3, reward: 2 },
  { id: 'petted', label: 'Pet your pets 3 times', counter: 'petted', target: 3, reward: 2 },
  { id: 'focus', label: 'Finish a Pomodoro focus session', counter: 'focus', target: 1, reward: 4 },
  { id: 'tricks', label: 'Watch 3 tricks', counter: 'tricks', target: 3, reward: 2 },
  { id: 'active', label: 'Be active for an hour', counter: 'activeMin', target: 60, reward: 3 },
  { id: 'toys', label: 'Play with toys twice', counter: 'toyPlays', target: 2, reward: 2 },
  { id: 'treat', label: 'Give a pet a treat', counter: 'treatsGiven', target: 1, reward: 1 },
];

// Same quests all day: picked with a PRNG seeded from the date.
function questsFor(dayKey) {
  let seed = [...dayKey].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pool = QUESTS.map((q) => q.id);
  const picked = [];
  while (picked.length < QUESTS_PER_DAY) picked.push(...pool.splice(Math.floor(random() * pool.length), 1));
  return picked;
}

class Economy {
  constructor(file) {
    this.file = file;
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // first run
    }
    const known = new Set(SHOP.map((item) => item.id));
    this.data = {
      treats: Number.isFinite(saved.treats) ? Math.max(0, saved.treats) : STARTING_TREATS,
      owned: Array.isArray(saved.owned) ? saved.owned.filter((id) => known.has(id)) : [],
      placed: {},
      day: typeof saved.day === 'string' ? saved.day : null,
      quests: Array.isArray(saved.quests) ? saved.quests : [],
      done: Array.isArray(saved.done) ? saved.done : [],
    };
    for (const [id, spot] of Object.entries(saved.placed ?? {})) {
      if (this.data.owned.includes(id)) this.data.placed[id] = { x: Number.isFinite(spot?.x) ? spot.x : null };
    }
  }

  get treats() {
    return this.data.treats;
  }

  // New day: fresh quests and the daily bonus. Returns true when the day changed.
  rollDay(dayKey) {
    if (this.data.day === dayKey) return false;
    const firstRun = this.data.day === null;
    this.data.day = dayKey;
    this.data.quests = questsFor(dayKey);
    this.data.done = [];
    if (!firstRun) this.data.treats += DAILY_BONUS;
    return !firstRun;
  }

  quests(today) {
    return this.data.quests
      .map((id) => QUESTS.find((q) => q.id === id))
      .filter(Boolean)
      .map((q) => ({
        id: q.id,
        label: q.label,
        reward: q.reward,
        target: q.target,
        progress: Math.min(q.target, today[q.counter] ?? 0),
        done: this.data.done.includes(q.id),
      }));
  }

  // Marks newly finished quests as done and pays out. Returns them.
  checkQuests(today) {
    const finished = this.quests(today).filter((q) => !q.done && q.progress >= q.target);
    for (const quest of finished) {
      this.data.done.push(quest.id);
      this.data.treats += quest.reward;
    }
    return finished;
  }

  spendTreat() {
    if (this.data.treats < 1) return false;
    this.data.treats -= 1;
    return true;
  }

  // Returns null on success, or why it failed.
  buy(id) {
    const item = SHOP.find((i) => i.id === id);
    if (!item) return 'unknown';
    if (this.data.owned.includes(id)) return 'owned';
    if (this.data.treats < item.price) return 'poor';
    this.data.treats -= item.price;
    this.data.owned.push(id);
    this.data.placed[id] = { x: null }; // the renderer picks a free spot and reports it back
    return null;
  }

  place(id, x = null) {
    if (!this.data.owned.includes(id)) return false;
    this.data.placed[id] = { x: Number.isFinite(x) ? Math.round(x) : null };
    return true;
  }

  putAway(id) {
    if (!(id in this.data.placed)) return false;
    delete this.data.placed[id];
    return true;
  }

  snapshot(today) {
    return {
      treats: this.data.treats,
      owned: [...this.data.owned],
      placed: { ...this.data.placed },
      shop: SHOP,
      quests: this.quests(today),
    };
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.warn(`Could not save home: ${err.message}`);
    }
  }
}

module.exports = { Economy, SHOP };
