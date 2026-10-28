// Sound effects, synthesized with Web Audio so no audio files are needed. Dropping
// assets/sounds/<name>.wav|mp3|ogg into the project replaces the sound with that name.

let settings = { enabled: true, volume: 0.5 };
let files = {};
let quiet = false;
let ctx = null;
let master = null;
let noiseBuffer = null;
let idleTimer = null;

export function configureSound(soundSettings, soundUrls = {}) {
  settings = soundSettings;
  files = soundUrls;
  if (master) master.gain.value = settings.volume;
}

// Do-not-disturb: silent, except for sounds played with { force: true } (your own reminders).
export function setQuiet(value) {
  quiet = value;
}

export function play(name, { force = false } = {}) {
  if (!settings.enabled || !(settings.volume > 0) || (quiet && !force)) return;
  if (files[name]) {
    const audio = new Audio(files[name]);
    audio.volume = Math.min(1, settings.volume);
    audio.play().catch(() => {});
    return;
  }
  const recipe = SYNTHS[name];
  if (!recipe) return;
  recipe(context().currentTime + 0.01);
  // Let the audio thread sleep once nothing has played for a while.
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => ctx.suspend(), 3000);
}

function context() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function envelope(t, dur, vol) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(master);
  return gain;
}

// One oscillator note, optionally gliding from one pitch to another.
function tone(t, { type = 'sine', from, to = from, dur, vol = 0.3 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(envelope(t, dur, vol));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A burst of filtered white noise (munching, whooshes, thuds).
function hiss(t, { dur, vol = 0.3, filter = 'lowpass', from = 1000, to = from, q = 1 }) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(from, t);
  if (to !== from) biquad.frequency.exponentialRampToValueAtTime(to, t + dur);
  src.connect(biquad).connect(envelope(t, dur, vol));
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SYNTHS = {
  boop: (t) => tone(t, { from: 660, to: 990, dur: 0.12, vol: 0.25 }),
  trick: (t) => [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.08, { type: 'triangle', from: f, dur: 0.14, vol: 0.22 })),
  munch: (t) => [0, 0.17, 0.34].forEach((d) => hiss(t + d, { dur: 0.08, from: 900, vol: 0.35 })),
  purr: (t) => {
    for (let i = 0; i < 8; i++) tone(t + i * 0.09, { type: 'triangle', from: 95, to: 80, dur: 0.08, vol: 0.18 });
  },
  whoosh: (t) => hiss(t, { dur: 0.35, filter: 'bandpass', from: 400, to: 2400, q: 2, vol: 0.4 }),
  thud: (t) => {
    tone(t, { from: 150, to: 55, dur: 0.14, vol: 0.4 });
    hiss(t, { dur: 0.05, from: 400, vol: 0.2 });
  },
  squeak: (t) => tone(t, { from: 900, to: 1700, dur: 0.1, vol: 0.18 }),
  kick: (t) => {
    tone(t, { from: 220, to: 90, dur: 0.09, vol: 0.35 });
    hiss(t, { dur: 0.04, from: 2000, vol: 0.15 });
  },
  yawn: (t) => tone(t, { type: 'triangle', from: 520, to: 260, dur: 0.6, vol: 0.15 }),
  chime: (t) => {
    tone(t, { from: 880, dur: 0.9, vol: 0.25 });
    tone(t + 0.18, { from: 1175, dur: 1.1, vol: 0.22 });
  },
  levelup: (t) => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(t + i * 0.07, { type: 'triangle', from: f, dur: 0.2, vol: 0.2 })),
  achievement: (t) => {
    [523, 659, 784].forEach((f) => tone(t, { type: 'triangle', from: f, dur: 0.35, vol: 0.12 }));
    [659, 784, 1047].forEach((f) => tone(t + 0.22, { type: 'triangle', from: f, dur: 0.8, vol: 0.12 }));
  },
  poof: (t) => hiss(t, { dur: 0.25, filter: 'highpass', from: 3000, to: 800, vol: 0.25 }),
  tag: (t) => {
    tone(t, { from: 700, to: 1200, dur: 0.08, vol: 0.18 });
    tone(t + 0.1, { from: 900, to: 1500, dur: 0.08, vol: 0.18 });
  },
  jump: (t) => tone(t, { type: 'triangle', from: 300, to: 700, dur: 0.12, vol: 0.15 }),
  giggle: (t) => [0, 0.09, 0.18].forEach((d, i) => tone(t + d, { from: 1100 + i * 90, to: 900 + i * 90, dur: 0.07, vol: 0.15 })),
  pew: (t) => tone(t, { type: 'square', from: 1800, to: 600, dur: 0.15, vol: 0.08 }),
  coin: (t) => {
    tone(t, { from: 988, dur: 0.1, vol: 0.2 });
    tone(t + 0.09, { from: 1319, dur: 0.35, vol: 0.2 });
  },
  thunk: (t) => {
    tone(t, { from: 200, to: 120, dur: 0.12, vol: 0.3 });
    hiss(t, { dur: 0.06, from: 600, vol: 0.15 });
  },
};
