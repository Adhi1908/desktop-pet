'use strict';

// Asks Windows whether a full-screen app, game or presentation is running
// (SHQueryUserNotificationState), so the pets can get out of the way.

// QUERY_USER_NOTIFICATION_STATE values that mean "don't draw over the screen".
const BUSY_STATES = new Set([
  2, // QUNS_BUSY: a full-screen app is running
  3, // QUNS_RUNNING_D3D_FULL_SCREEN: a full-screen game
  4, // QUNS_PRESENTATION_MODE
  7, // QUNS_APP: a full-screen Store app
]);

// Returns () => boolean, or null when this can't be checked.
function createFullscreenCheck() {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    const query = koffi
      .load('shell32.dll')
      .func('long __stdcall SHQueryUserNotificationState(_Out_ int *state)');
    return () => {
      const state = [0];
      return query(state) === 0 && BUSY_STATES.has(state[0]);
    };
  } catch (err) {
    console.warn(`Full-screen detection unavailable: ${err.message}`);
    return null;
  }
}

// "HH:MM" -> minutes since midnight.
const minutesOf = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

// Whether `date` falls in the daily window [from, to), which may wrap past midnight.
function inWindow(from, to, date = new Date()) {
  const now = date.getHours() * 60 + date.getMinutes();
  const start = minutesOf(from);
  const end = minutesOf(to);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

module.exports = { createFullscreenCheck, inWindow };
