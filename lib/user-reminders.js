'use strict';

// Your own reminders: one-off or repeating, delivered by a pet holding a sign. Saved in
// <userData>/reminders.json.

const fs = require('node:fs');

const REPEATS = ['once', 'daily', 'weekdays', 'weekends', 'days'];
const MAX_TEXT = 80;
const MAX_REMINDERS = 50;
const LATE_MS = 2 * 60 * 60 * 1000; // still delivered if the app starts up to 2 h after the time

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function occursOn(reminder, date) {
  const weekday = date.getDay();
  switch (reminder.repeat) {
    case 'once':
      return reminder.date === dayKey(date);
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekends':
      return weekday === 0 || weekday === 6;
    default:
      return reminder.days.includes(weekday);
  }
}

function dueTime(reminder, date) {
  const [h, m] = reminder.time.split(':').map(Number);
  const due = new Date(date);
  due.setHours(h, m, 0, 0);
  return due;
}

class UserReminders {
  constructor(file) {
    this.file = file;
    let saved = [];
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8')).reminders ?? [];
    } catch {
      // none yet
    }
    this.items = Array.isArray(saved) ? saved.map((r) => this.normalize(r)).filter(Boolean) : [];
  }

  // Validates input from the settings window; returns null if it isn't a usable reminder.
  normalize(input) {
    const text = typeof input?.text === 'string' ? input.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
    if (!text || !TIME_RE.test(input.time ?? '')) return null;
    const repeat = REPEATS.includes(input.repeat) ? input.repeat : 'once';
    const days = Array.isArray(input.days) ? [...new Set(input.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    if (repeat === 'days' && !days.length) return null;
    const date = DATE_RE.test(input.date ?? '') ? input.date : dayKey(new Date());
    return {
      id: typeof input.id === 'string' ? input.id : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      time: input.time,
      repeat,
      days,
      date,
      enabled: input.enabled !== false,
      lastFired: typeof input.lastFired === 'string' ? input.lastFired : null,
      snoozedUntil: Number.isFinite(input.snoozedUntil) ? input.snoozedUntil : null,
    };
  }

  list() {
    return this.items.map((r) => ({ ...r }));
  }

  upsert(input) {
    const reminder = this.normalize(input);
    if (!reminder) return null;
    // Don't fire straight away for a time that has already passed today.
    const now = new Date();
    reminder.lastFired = occursOn(reminder, now) && dueTime(reminder, now) <= now ? dayKey(now) : null;
    reminder.snoozedUntil = null;
    const index = this.items.findIndex((r) => r.id === reminder.id);
    if (index >= 0) this.items[index] = reminder;
    else if (this.items.length < MAX_REMINDERS) this.items.push(reminder);
    else return null;
    return reminder;
  }

  remove(id) {
    this.items = this.items.filter((r) => r.id !== id);
  }

  setEnabled(id, enabled) {
    const reminder = this.items.find((r) => r.id === id);
    if (reminder) reminder.enabled = Boolean(enabled);
  }

  snooze(id, minutes) {
    const reminder = this.items.find((r) => r.id === id);
    if (reminder) reminder.snoozedUntil = Date.now() + minutes * 60_000;
  }

  // Reminders to deliver now. Each occurrence fires once; ones more than 2 h late are skipped.
  due(now = new Date()) {
    const fire = [];
    for (const r of this.items) {
      if (r.snoozedUntil) {
        if (now.getTime() >= r.snoozedUntil) {
          r.snoozedUntil = null;
          fire.push(r);
        }
        continue;
      }
      if (!r.enabled || r.lastFired === dayKey(now) || !occursOn(r, now)) continue;
      const due = dueTime(r, now);
      if (now < due) continue;
      r.lastFired = dayKey(now);
      if (r.repeat === 'once') r.enabled = false;
      if (now - due <= LATE_MS) fire.push(r);
    }
    return fire.map((r) => ({ id: r.id, text: r.text }));
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify({ reminders: this.items }, null, 2));
    } catch (err) {
      console.warn(`Could not save reminders: ${err.message}`);
    }
  }
}

module.exports = { UserReminders };
