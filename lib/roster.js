'use strict';

// The pets: name, look, needs (hunger with 100 = full, happiness; both 0-100) and XP. Saved in
// <userData>/pets.json. Needs only drop while the app runs, so closing it overnight doesn't leave
// you with starving pets.

const fs = require('node:fs');
const { HATS, TINTS, hatAvailable, effectiveHat } = require('./catalog');

const MAX_PETS = 4;
const MAX_LEVEL = 30;
const NAMES = ['Mochi', 'Pixel', 'Biscuit', 'Nori', 'Pudding', 'Tofu', 'Sprout', 'Bean'];

// What things the pets experience (reported by the renderer) do to their needs and XP.
const EFFECTS = {
  click: { happiness: 1, xp: 1 },
  trick: { happiness: 2, hunger: -1, xp: 3 },
  fling: { happiness: 1, xp: 1 },
  pounce: { happiness: 2, hunger: -1, xp: 2 },
  catch: { happiness: 3, hunger: -1, xp: 4 },
  tag: { happiness: 3, hunger: -1, xp: 3 },
  tagged: { happiness: 3, hunger: -1, xp: 3 },
  cuddle: { happiness: 8, xp: 5 },
  petted: { happiness: 3, xp: 2 },
  tickled: { happiness: 2, xp: 1 },
  played: { happiness: 15, hunger: -4, xp: 15 },
  toy: { happiness: 4, hunger: -1, xp: 3 },
  treat: { hunger: 6, happiness: 4, xp: 3 },
  scratch: { happiness: 2, xp: 1 },
};

const clamp = (value) => Math.min(100, Math.max(0, value));
const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

// Total XP needed to reach a level: 0, 50, 150, 300, 500, 750, ...
const xpForLevel = (level) => 25 * level * (level - 1);

function levelFor(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

function moodOf(pet) {
  if (pet.hunger < 25) return 'hungry';
  if (pet.happiness < 30) return 'sad';
  if (pet.happiness >= 75) return 'happy';
  return 'okay';
}

function cleanName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
}

class Roster {
  constructor(file, legacyFile) {
    this.file = file;
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8')).pets;
    } catch {
      // first run of this version
    }
    if (!Array.isArray(saved) || !saved.length) {
      // Carry over the single pet from earlier versions (pet-state.json).
      let legacy = {};
      try {
        legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      } catch {
        // brand new install
      }
      saved = [{ hunger: legacy?.hunger, happiness: legacy?.happiness }];
    }
    this.pets = [];
    for (const pet of saved.slice(0, MAX_PETS)) this.pets.push(this.normalize(pet));
  }

  normalize(p = {}) {
    const usedNames = new Set(this.pets.map((pet) => pet.name));
    const usedTints = new Set(this.pets.map((pet) => pet.tint));
    return {
      id: typeof p.id === 'string' ? p.id : `pet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName(p.name) || NAMES.find((n) => !usedNames.has(n)) || 'Pet',
      tint: TINTS.some((t) => t.id === p.tint) ? p.tint : (TINTS.find((t) => !usedTints.has(t.id))?.id ?? 'original'),
      hat: HATS.some((h) => h.id === p.hat) ? p.hat : 'seasonal',
      hunger: clamp(numberOr(p.hunger, 80)),
      happiness: clamp(numberOr(p.happiness, 80)),
      xp: Math.max(0, numberOr(p.xp, 0)),
    };
  }

  get(id) {
    return this.pets.find((pet) => pet.id === id);
  }

  ids() {
    return this.pets.map((pet) => pet.id);
  }

  maxLevel() {
    return Math.max(...this.pets.map((pet) => levelFor(pet.xp)));
  }

  snapshot(season) {
    return this.pets.map((pet) => {
      const level = levelFor(pet.xp);
      return {
        id: pet.id,
        name: pet.name,
        tint: pet.tint,
        hue: TINTS.find((t) => t.id === pet.tint).hue,
        hatChoice: pet.hat,
        hat: effectiveHat(pet.hat, level, season),
        hunger: Math.round(pet.hunger),
        happiness: Math.round(pet.happiness),
        mood: moodOf(pet),
        level,
        xp: Math.floor(pet.xp),
        levelXp: xpForLevel(level),
        nextXp: level < MAX_LEVEL ? xpForLevel(level + 1) : null,
      };
    });
  }

  add() {
    if (this.pets.length >= MAX_PETS) return null;
    const pet = this.normalize();
    this.pets.push(pet);
    return pet;
  }

  remove(id) {
    if (this.pets.length <= 1) return false;
    const before = this.pets.length;
    this.pets = this.pets.filter((pet) => pet.id !== id);
    return this.pets.length < before;
  }

  // Rename / recolour / change hat. Locked hats are refused.
  update(id, patch, season) {
    const pet = this.get(id);
    if (!pet || !patch) return false;
    if ('name' in patch) {
      const name = cleanName(patch.name);
      if (name) pet.name = name;
    }
    if ('tint' in patch && TINTS.some((t) => t.id === patch.tint)) pet.tint = patch.tint;
    if ('hat' in patch) {
      const hat = HATS.find((h) => h.id === patch.hat);
      if (hat && hatAvailable(hat, levelFor(pet.xp), season)) pet.hat = hat.id;
    }
    return true;
  }

  decay(hours, rates) {
    for (const pet of this.pets) {
      pet.hunger = clamp(pet.hunger - rates.hungerPerHour * hours);
      const sadness = rates.happinessPerHour * (pet.hunger < 25 ? 2 : 1); // hungry pets get sad faster
      pet.happiness = clamp(pet.happiness - sadness * hours);
    }
  }

  // Returns the level-ups this caused: [{ id, name, level, unlocks }].
  addXp(pet, amount) {
    const before = levelFor(pet.xp);
    pet.xp += amount;
    const after = levelFor(pet.xp);
    if (after === before) return [];
    const unlocks = HATS.filter((h) => h.level > before && h.level <= after).map((h) => h.label);
    return [{ id: pet.id, name: pet.name, level: after, unlocks }];
  }

  addXpAll(amount) {
    return this.pets.flatMap((pet) => this.addXp(pet, amount));
  }

  change(pet, { hunger = 0, happiness = 0, xp = 0 }) {
    pet.hunger = clamp(pet.hunger + hunger);
    pet.happiness = clamp(pet.happiness + happiness);
    return xp ? this.addXp(pet, xp) : [];
  }

  // Applies an event to one pet, or to all of them when id is null. Returns level-ups, or null
  // for unknown events/pets.
  apply(event, id) {
    if (!Object.hasOwn(EFFECTS, event)) return null;
    const pets = id ? [this.get(id)].filter(Boolean) : this.pets;
    if (!pets.length) return null;
    return pets.flatMap((pet) => this.change(pet, EFFECTS[event]));
  }

  // Returns { ate, levelUps }; a pet that's 90% full or more refuses food.
  feed(id, amount, xp) {
    const pet = this.get(id);
    if (!pet) return null;
    if (pet.hunger >= 90) return { ate: false, levelUps: [] };
    return { ate: true, levelUps: this.change(pet, { hunger: amount, happiness: 4, xp }) };
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify({ pets: this.pets }, null, 2));
    } catch (err) {
      console.warn(`Could not save pets: ${err.message}`);
    }
  }
}

module.exports = { Roster, MAX_PETS };
