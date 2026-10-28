'use strict';

// Global typing rate. Only the fact that a key went down is counted: the event object (which
// carries the key code) is never read, stored or logged. onKeys gets the number of keys pressed
// in each second (for daily stats). Returns a function that stops it.
function startKeyboardWatch({ isPaused, onActivity, onRate, onKeys }) {
  let uIOhook;
  try {
    ({ uIOhook } = require('uiohook-napi'));
  } catch (err) {
    console.warn(`uiohook-napi failed to load, typing reactions disabled: ${err.message}`);
    return () => {};
  }

  const buckets = new Array(10).fill(0); // ten 1-second buckets = rolling 10 s window
  let current = 0;
  let lastRate = 0;
  let lastPing = 0;

  uIOhook.on('keydown', () => {
    if (isPaused()) return;
    buckets[current]++;
    // Throttled "a key was pressed" ping so a sleeping pet wakes immediately.
    const now = Date.now();
    if (now - lastPing >= 1000) {
      lastPing = now;
      onActivity();
    }
  });

  const interval = setInterval(() => {
    if (buckets[current]) onKeys(buckets[current]);
    const rate = buckets.reduce((sum, n) => sum + n, 0);
    if (rate !== lastRate) {
      lastRate = rate;
      onRate(rate);
    }
    current = (current + 1) % buckets.length;
    buckets[current] = 0;
  }, 1000);

  uIOhook.start();
  return () => {
    clearInterval(interval);
    uIOhook.stop();
  };
}

module.exports = { startKeyboardWatch };
