'use strict';

const { powerMonitor } = require('electron');

const AWAY_SEC = 5 * 60;

// Break and water reminders count *active* minutes only (any keyboard or mouse input in the last
// five minutes). Being away for five minutes or more counts as having taken a break.
class Reminders {
  constructor({ getConfig, isPaused, isQuiet, pomodoroActive, notify, onActiveMinute, onBreak }) {
    Object.assign(this, { getConfig, isPaused, isQuiet, pomodoroActive, notify, onActiveMinute, onBreak });
    this.breakMin = 0;
    this.waterMin = 0;
    this.away = false;
    setInterval(() => this.tick(), 60_000);
  }

  tick() {
    if (powerMonitor.getSystemIdleTime() >= AWAY_SEC) {
      if (!this.away) this.onBreak(); // counted once per time away
      this.away = true;
      this.breakMin = 0;
      return;
    }
    this.away = false;
    if (this.isPaused()) return;
    this.onActiveMinute();

    const { reminders } = this.getConfig();
    const quiet = this.isQuiet(); // do-not-disturb: hold the nudges until it's over
    this.waterMin++;
    if (reminders.waterEnabled && this.waterMin >= reminders.waterEveryMin && !quiet) {
      this.waterMin = 0;
      this.notify('water');
    }

    // A running pomodoro schedules its own breaks.
    if (this.pomodoroActive()) {
      this.breakMin = 0;
      return;
    }
    this.breakMin++;
    if (reminders.breakEnabled && this.breakMin >= reminders.breakEveryMin && !quiet) {
      this.breakMin = 0;
      this.notify('break');
    }
  }
}

const PHASE_MINUTES = { focus: 'focusMin', short: 'shortBreakMin', long: 'longBreakMin' };

// Focus / short break cycles, with a long break after every `longBreakEvery` focus sessions.
class Pomodoro {
  constructor({ getConfig, onChange, onFocusDone }) {
    Object.assign(this, { getConfig, onChange, onFocusDone });
    this.phase = null;
  }

  get active() {
    return this.phase !== null;
  }

  start() {
    this.completed = 0;
    this.begin('focus');
  }

  stop() {
    clearTimeout(this.timer);
    this.phase = null;
    this.onChange('stop');
  }

  begin(phase) {
    const minutes = this.getConfig().pomodoro[PHASE_MINUTES[phase]];
    this.phase = phase;
    this.endsAt = Date.now() + minutes * 60_000;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), minutes * 60_000);
    this.onChange(phase, minutes);
  }

  advance() {
    if (this.phase !== 'focus') return this.begin('focus');
    this.completed++;
    this.onFocusDone();
    const every = this.getConfig().pomodoro.longBreakEvery ?? 4;
    this.begin(this.completed % every === 0 ? 'long' : 'short');
  }

  minutesLeft() {
    return Math.max(0, Math.ceil((this.endsAt - Date.now()) / 60_000));
  }
}

module.exports = { Reminders, Pomodoro };
