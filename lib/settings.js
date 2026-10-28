'use strict';

// User settings: config.json holds the defaults, and anything changed in the settings window is
// stored as overrides in <userData>/settings.json, so it also works in the packaged app.

const fs = require('node:fs');

// What the settings window may change. Values are stored in config.json units; `factor`
// converts to the unit shown in the window (stored = shown × factor).
const SCHEMA = [
  { section: 'Pet', key: 'scale', label: 'Size', type: 'range', min: 1, max: 6, step: 1, unit: '×' },
  { section: 'Pet', key: 'speed.walk', label: 'Walk speed', type: 'range', min: 10, max: 150, step: 5, unit: 'px/s' },
  { section: 'Pet', key: 'speed.run', label: 'Run speed', type: 'range', min: 40, max: 400, step: 10, unit: 'px/s' },
  { section: 'Pet', key: 'cursorPlay.enabled', label: 'Chase my mouse cursor', type: 'checkbox' },
  { section: 'Pet', key: 'climbing.windows', label: 'Climb onto and walk on windows', type: 'checkbox' },
  { section: 'Pet', key: 'displays.all', label: 'Roam across all my monitors', type: 'checkbox' },
  { section: 'Pet', key: 'climbing.walls', label: 'Climb the screen edges', type: 'checkbox' },
  { section: 'Pet', key: 'seasons.enabled', label: 'Seasonal decorations', type: 'checkbox' },
  { section: 'Typing', key: 'typing.highRate', label: 'Gets excited above', type: 'range', min: 10, max: 120, step: 5, unit: 'keys / 10 s' },
  { section: 'Typing', key: 'typing.sitAfterSec', label: 'Sits after no typing for', type: 'number', min: 0.5, max: 60, step: 0.5, factor: 60, unit: 'min' },
  { section: 'Typing', key: 'typing.sleepAfterSec', label: 'Sleeps after no typing for', type: 'number', min: 1, max: 120, step: 1, factor: 60, unit: 'min' },
  { section: 'Speech', key: 'speech.enabled', label: 'Speech bubbles', type: 'checkbox' },
  { section: 'Speech', key: 'speech.chatter', label: 'Random chatter', type: 'checkbox', dependsOn: 'speech.enabled' },
  { section: 'Reminders', key: 'reminders.breakEnabled', label: 'Remind me to take breaks', type: 'checkbox' },
  { section: 'Reminders', key: 'reminders.breakEveryMin', label: 'Every', type: 'number', min: 10, max: 240, step: 5, unit: 'active min', dependsOn: 'reminders.breakEnabled' },
  { section: 'Reminders', key: 'reminders.waterEnabled', label: 'Remind me to drink water', type: 'checkbox' },
  { section: 'Reminders', key: 'reminders.waterEveryMin', label: 'Every', type: 'number', min: 10, max: 240, step: 5, unit: 'active min', dependsOn: 'reminders.waterEnabled' },
  { section: 'Pomodoro', key: 'pomodoro.focusMin', label: 'Focus', type: 'number', min: 1, max: 120, step: 1, unit: 'min' },
  { section: 'Pomodoro', key: 'pomodoro.shortBreakMin', label: 'Short break', type: 'number', min: 1, max: 30, step: 1, unit: 'min' },
  { section: 'Pomodoro', key: 'pomodoro.longBreakMin', label: 'Long break (every 4th)', type: 'number', min: 1, max: 60, step: 1, unit: 'min' },
  { section: 'Smart', key: 'smart.hideFullscreen', label: 'Hide during full-screen apps, games and presentations', type: 'checkbox' },
  { section: 'Smart', key: 'smart.night', label: 'Sleepy at night (nightcaps, naps sooner)', type: 'checkbox' },
  { section: 'Smart', key: 'smart.nightStart', label: 'Night starts', type: 'time', dependsOn: 'smart.night' },
  { section: 'Smart', key: 'smart.nightEnd', label: 'Night ends', type: 'time', dependsOn: 'smart.night' },
  { section: 'Do not disturb', key: 'dnd.enabled', label: 'Quiet hours (no bubbles, sounds or nudges)', type: 'checkbox' },
  { section: 'Do not disturb', key: 'dnd.start', label: 'From', type: 'time', dependsOn: 'dnd.enabled' },
  { section: 'Do not disturb', key: 'dnd.end', label: 'To', type: 'time', dependsOn: 'dnd.enabled' },
  { section: 'Sound', key: 'sound.enabled', label: 'Sound effects', type: 'checkbox' },
  { section: 'Sound', key: 'sound.volume', label: 'Volume', type: 'range', min: 0, max: 100, step: 5, factor: 0.01, unit: '%', dependsOn: 'sound.enabled' },
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function merge(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

const getPath = (obj, key) => key.split('.').reduce((o, k) => o?.[k], obj);

function setPath(obj, key, value) {
  const parts = key.split('.');
  const last = parts.pop();
  let target = obj;
  for (const part of parts) target = isObject(target[part]) ? target[part] : (target[part] = {});
  target[last] = value;
}

class Settings {
  constructor(defaultsFile, userFile) {
    this.defaults = JSON.parse(fs.readFileSync(defaultsFile, 'utf8'));
    this.userFile = userFile;
    try {
      this.overrides = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    } catch {
      this.overrides = {};
    }
    if (!isObject(this.overrides)) this.overrides = {};
    this.config = merge(this.defaults, this.overrides);
  }

  values() {
    return Object.fromEntries(SCHEMA.map((item) => [item.key, getPath(this.config, item.key)]));
  }

  // Ignores keys that aren't in SCHEMA and clamps numbers to their allowed range.
  set(key, value) {
    const item = SCHEMA.find((s) => s.key === key);
    if (!item) return false;
    if (item.type === 'checkbox') {
      value = Boolean(value);
    } else if (item.type === 'time') {
      if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
    } else {
      const factor = item.factor ?? 1;
      value = Number(value);
      if (!Number.isFinite(value)) return false;
      value = Math.min(item.max * factor, Math.max(item.min * factor, value));
    }
    setPath(this.overrides, key, value);
    this.config = merge(this.defaults, this.overrides);
    this.scheduleSave();
    return true;
  }

  reset() {
    this.overrides = {};
    this.config = merge(this.defaults, this.overrides);
    this.scheduleSave();
  }

  // Sliders send a stream of values; write the file once they settle.
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  save() {
    clearTimeout(this.saveTimer);
    try {
      fs.writeFileSync(this.userFile, JSON.stringify(this.overrides, null, 2));
    } catch (err) {
      console.warn(`Could not save settings: ${err.message}`);
    }
  }
}

module.exports = { Settings, SCHEMA };
