'use strict';

// Daily counters and achievements, saved in <userData>/stats.json. Only counts are stored (how
// many keys, minutes, feeds...), never what was typed.

const fs = require('node:fs');

const KEEP_DAYS = 60;

const ACHIEVEMENTS = [
  { id: 'first-feed', icon: '🍖', title: 'Snack time', description: 'Feed a pet for the first time', test: (s) => s.totals.fed >= 1 },
  { id: 'well-fed', icon: '🍱', title: 'Well fed', description: 'Feed your pets 25 times', test: (s) => s.totals.fed >= 25 },
  { id: 'ball-buddy', icon: '⚽', title: 'Ball buddy', description: 'Play 10 ball games', test: (s) => s.totals.played >= 10 },
  { id: 'cursor-catcher', icon: '🖱️', title: 'Caught!', description: 'Get your cursor caught 10 times', test: (s) => s.totals.catches >= 10 },
  { id: 'show-off', icon: '✨', title: 'Show-off', description: 'Watch 25 tricks', test: (s) => s.totals.tricks >= 25 },
  { id: 'frequent-flyer', icon: '🪁', title: 'Frequent flyer', description: 'Throw a pet 20 times', test: (s) => s.totals.flings >= 20 },
  { id: 'tag', icon: '🏃', title: "Tag, you're it", description: 'Watch two pets play tag', test: (s) => s.totals.tags >= 1 },
  { id: 'warming-up', icon: '⌨️', title: 'Warming up', description: 'Type 1,000 keys in a day', test: (s) => s.today.keys >= 1000 },
  { id: 'keyboard-warrior', icon: '⚔️', title: 'Keyboard warrior', description: 'Type 10,000 keys in a day', test: (s) => s.today.keys >= 10000 },
  { id: 'novelist', icon: '📚', title: 'Novelist', description: 'Type 100,000 keys in total', test: (s) => s.totals.keys >= 100000 },
  { id: 'in-the-zone', icon: '🍅', title: 'In the zone', description: 'Finish a Pomodoro focus session', test: (s) => s.totals.focus >= 1 },
  { id: 'deep-work', icon: '🧠', title: 'Deep work', description: 'Finish 4 focus sessions in a day', test: (s) => s.today.focus >= 4 },
  { id: 'regular', icon: '📅', title: 'Regular', description: 'Spend time with your pets 3 days in a row', test: (s) => s.streak >= 3 },
  { id: 'devoted', icon: '💖', title: 'Devoted', description: 'Keep a 7-day streak', test: (s) => s.streak >= 7 },
  { id: 'growing-up', icon: '🌱', title: 'Growing up', description: 'Get a pet to level 5', test: (s) => s.maxLevel >= 5 },
  { id: 'royalty', icon: '👑', title: 'Royalty', description: 'Get a pet to level 10', test: (s) => s.maxLevel >= 10 },
  { id: 'best-friends', icon: '🤝', title: 'Best friends', description: 'Have two pets at once', test: (s) => s.petCount >= 2 },
  { id: 'night-owl', icon: '🦉', title: 'Night owl', description: 'Be active between midnight and 4 am', test: (s) => s.hour < 4 && s.today.activeMin > 0 },
  { id: 'good-pet', icon: '🫶', title: 'Good pet', description: 'Pet your pets 25 times', test: (s) => s.totals.petted >= 25 },
  { id: 'treat-time', icon: '🍪', title: 'Treat time', description: 'Give your pets 10 treats', test: (s) => s.totals.treatsGiven >= 10 },
  { id: 'home-sweet-home', icon: '🏡', title: 'Home sweet home', description: 'Own 3 pieces of furniture', test: (s) => s.ownedCount >= 3 },
  { id: 'quest-master', icon: '📜', title: 'Quest master', description: 'Finish 10 daily quests', test: (s) => s.totals.quests >= 10 },
];

const COUNTERS = [
  'keys',
  'activeMin',
  'breaks',
  'focus',
  'fed',
  'played',
  'petted',
  'tricks',
  'catches',
  'flings',
  'clicks',
  'tags',
  'treatsGiven',
  'toyPlays',
  'quests',
];

function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const filled = (counts = {}) => Object.fromEntries(COUNTERS.map((c) => [c, counts[c] ?? 0]));
const isActive = (day) => Boolean(day && Object.values(day).some((n) => n > 0));

class Stats {
  constructor(file, getExtras) {
    this.file = file;
    this.getExtras = getExtras; // () => ({ maxLevel, petCount })
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // first run
    }
    this.data = { days: data.days ?? {}, totals: data.totals ?? {}, achievements: data.achievements ?? {} };
  }

  add(counter, amount = 1) {
    if (!amount) return [];
    const day = (this.data.days[dayKey()] ??= {});
    day[counter] = (day[counter] ?? 0) + amount;
    this.data.totals[counter] = (this.data.totals[counter] ?? 0) + amount;
    return this.check();
  }

  todayCounts() {
    return filled(this.data.days[dayKey()]);
  }

  // Consecutive days with any activity, ending today (or yesterday, if today hasn't started yet).
  streak() {
    const date = new Date();
    if (!isActive(this.data.days[dayKey(date)])) date.setDate(date.getDate() - 1);
    let days = 0;
    while (isActive(this.data.days[dayKey(date)])) {
      days++;
      date.setDate(date.getDate() - 1);
    }
    return days;
  }

  // Unlocks any achievements that are now earned and returns them.
  check() {
    const summary = {
      today: filled(this.data.days[dayKey()]),
      totals: filled(this.data.totals),
      streak: this.streak(),
      hour: new Date().getHours(),
      ...this.getExtras(),
    };
    const unlocked = [];
    for (const { test, ...achievement } of ACHIEVEMENTS) {
      if (this.data.achievements[achievement.id] || !test(summary)) continue;
      this.data.achievements[achievement.id] = Date.now();
      unlocked.push(achievement);
    }
    return unlocked;
  }

  snapshot() {
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      last7.push({ date: dayKey(date), ...filled(this.data.days[dayKey(date)]) });
    }
    return {
      today: filled(this.data.days[dayKey()]),
      totals: filled(this.data.totals),
      streak: this.streak(),
      last7,
      achievements: ACHIEVEMENTS.map(({ test, ...a }) => ({ ...a, unlockedAt: this.data.achievements[a.id] ?? null })),
    };
  }

  save() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    for (const key of Object.keys(this.data.days)) if (key < dayKey(cutoff)) delete this.data.days[key];
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch (err) {
      console.warn(`Could not save stats: ${err.message}`);
    }
  }
}

module.exports = { Stats, dayKey };
