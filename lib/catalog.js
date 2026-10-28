'use strict';

// Hats, colour tints and seasons. Each hat's pixel art lives in renderer/pixelart.js under the
// same id.

const HATS = [
  { id: 'none', label: 'No hat' },
  { id: 'seasonal', label: 'Seasonal (automatic)' },
  { id: 'bow', label: 'Bow', level: 2 },
  { id: 'cap', label: 'Cap', level: 3 },
  { id: 'flower', label: 'Flower', level: 4 },
  { id: 'party', label: 'Party hat', level: 5, seasons: ['newyear'] },
  { id: 'tophat', label: 'Top hat', level: 7 },
  { id: 'crown', label: 'Crown', level: 10 },
  { id: 'witch', label: 'Witch hat', seasons: ['halloween'] },
  { id: 'santa', label: 'Santa hat', seasons: ['christmas', 'newyear', 'winter'] },
];

const TINTS = [
  { id: 'original', label: 'Original', hue: 0 },
  { id: 'rose', label: 'Rose', hue: 320 },
  { id: 'mint', label: 'Mint', hue: 130 },
  { id: 'sky', label: 'Sky', hue: 180 },
  { id: 'grape', label: 'Grape', hue: 250 },
  { id: 'lime', label: 'Lime', hue: 60 },
];

const SEASON_LABELS = {
  halloween: 'Halloween',
  christmas: 'Christmas',
  newyear: 'New Year',
  winter: 'Winter',
  valentine: "Valentine's Day",
};

// [season, from, to] with dates written as month * 100 + day. First match wins.
const SEASONS = [
  ['newyear', 1231, 1231],
  ['newyear', 101, 102],
  ['valentine', 213, 215],
  ['halloween', 1015, 1102],
  ['christmas', 1201, 1230],
  ['winter', 103, 228],
];

const SEASONAL_HAT = { halloween: 'witch', christmas: 'santa', winter: 'santa', newyear: 'party' };

function currentSeason(date = new Date()) {
  const day = (date.getMonth() + 1) * 100 + date.getDate();
  return SEASONS.find(([, from, to]) => day >= from && day <= to)?.[0] ?? null;
}

function hatAvailable(hat, level, season) {
  if (hat.id === 'none' || hat.id === 'seasonal') return true;
  if (season && hat.seasons?.includes(season)) return true;
  return hat.level !== undefined && level >= hat.level;
}

// The hat that's actually drawn: resolves "seasonal" and drops hats that aren't available (yet).
function effectiveHat(hatId, level, season) {
  if (hatId === 'seasonal') return SEASONAL_HAT[season] ?? 'none';
  const hat = HATS.find((h) => h.id === hatId);
  return hat && hatAvailable(hat, level, season) ? hatId : 'none';
}

module.exports = { HATS, TINTS, SEASON_LABELS, currentSeason, hatAvailable, effectiveHat };
