// Settings window: the pets (look, needs, levels), shop and quests, your reminders, stats with
// achievements, and settings. The list of settings comes from main (lib/settings.js SCHEMA), so
// adding one there makes it show up here.

import { FURNITURE, renderPixelArt } from './pixelart.js';

const api = window.settingsAPI;
const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function button(label, onClick, className = '') {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

const MOODS = {
  happy: ['😊', 'Happy'],
  okay: ['🙂', 'Okay'],
  sad: ['😢', 'Sad: play with them!'],
  hungry: ['😋', 'Hungry: time to eat!'],
};
const SEASON_ICONS = { halloween: '🎃', christmas: '🎄', newyear: '🎉', winter: '❄️', valentine: '💕' };

const initial = await api.get();
const { hats, tints, maxPets, season, seasonLabel, seasonalHat } = initial;
let roster = initial.roster;
let stats = initial.stats;
let home = initial.home;
let reminders = initial.reminders;

// ---- tabs ---------------------------------------------------------------------------

const TABS = ['pets', 'home', 'reminders', 'stats', 'settings'];
let currentTab = 'pets';

function showTab(name) {
  if (!TABS.includes(name)) return;
  currentTab = name;
  for (const tab of TABS) {
    $(`tab-btn-${tab}`).setAttribute('aria-selected', String(tab === name));
    $(`tab-${tab}`).hidden = tab !== name;
  }
  if (name === 'stats') refreshStats();
}

for (const tab of TABS) $(`tab-btn-${tab}`).addEventListener('click', () => showTab(tab));

// ---- pets ---------------------------------------------------------------------------

const cards = new Map(); // pet id -> card elements

function hatAvailable(hat, level) {
  if (hat.id === 'none' || hat.id === 'seasonal') return true;
  if (season && hat.seasons?.includes(season)) return true;
  return hat.level !== undefined && level >= hat.level;
}

function hatLabel(hat, level) {
  if (hat.id === 'seasonal') {
    const current = hats.find((h) => h.id === seasonalHat);
    return `Seasonal (${current && current.id !== 'none' ? current.label.toLowerCase() : 'none right now'})`;
  }
  if (hatAvailable(hat, level)) return hat.label;
  return hat.level !== undefined ? `${hat.label} (unlocks at level ${hat.level})` : `${hat.label} (seasonal)`;
}

function meter(label, kind) {
  const root = el('div', 'meter');
  const fill = el('div', `fill ${kind}`);
  const bar = el('div', 'bar');
  bar.append(fill);
  const output = el('output');
  root.append(el('span', '', label), bar, output);
  return { root, fill, output };
}

function field(label, control) {
  const root = el('div', 'field');
  root.append(el('span', 'label', label), control);
  return root;
}

function buildCard(pet) {
  const root = el('article', 'card pet-card');

  const name = el('input', 'name');
  name.maxLength = 16;
  name.setAttribute('aria-label', 'Name');
  name.addEventListener('change', () => api.updatePet(pet.id, { name: name.value }));
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur();
  });
  const level = el('span', 'level');
  const mood = el('span', 'mood');
  const header = el('header', 'pet-header');
  header.append(name, level, mood);
  const where = el('p', 'where muted');

  const xp = meter('Next level', 'xp');
  const fullness = meter('Fullness', 'hunger');
  const happiness = meter('Happiness', 'happiness');

  const swatches = el('div', 'swatches');
  for (const tint of tints) {
    const swatch = button('', () => api.updatePet(pet.id, { tint: tint.id }), 'swatch');
    const dot = el('span', 'dot');
    if (tint.hue) dot.style.filter = `hue-rotate(${tint.hue}deg)`;
    swatch.append(dot);
    swatch.title = tint.label;
    swatch.setAttribute('aria-label', `${tint.label} color`);
    swatch.dataset.tint = tint.id;
    swatches.append(swatch);
  }

  const hatSelect = el('select', 'hat-select');
  hatSelect.setAttribute('aria-label', 'Hat');
  hatSelect.addEventListener('change', () => api.updatePet(pet.id, { hat: hatSelect.value }));

  const actions = el('div', 'actions');
  const goodbye = button('Say goodbye…', () => api.action('remove', pet.id), 'secondary');
  const bringBack = button('Bring back', () => api.action('bringBack', pet.id));
  bringBack.title = 'Bring this pet to the main monitor, next to the tray';
  actions.append(
    button('Feed', () => api.action('feed', pet.id)),
    button('Pet', () => api.action('cuddle', pet.id)),
    bringBack,
    goodbye,
  );

  root.append(header, where, xp.root, fullness.root, happiness.root, field('Color', swatches), field('Hat', hatSelect), actions);
  return { root, name, level, mood, where, xp, fullness, happiness, swatches, hatSelect, goodbye, hatLevel: null };
}

const WHERE = { main: 'On your main monitor', left: 'On your left monitor', right: 'On your right monitor', top: 'On your top monitor', bottom: 'On your bottom monitor' };

function updateCard(card, pet) {
  if (document.activeElement !== card.name) card.name.value = pet.name;
  card.level.textContent = `Level ${pet.level}`;
  const [icon, text] = MOODS[pet.mood] ?? MOODS.okay;
  card.mood.textContent = `${icon} ${text}`;
  card.where.textContent = WHERE[pet.where] ? `📍 ${WHERE[pet.where]}` : '';
  card.where.hidden = !WHERE[pet.where];

  if (pet.nextXp) {
    const into = pet.xp - pet.levelXp;
    const span = pet.nextXp - pet.levelXp;
    card.xp.fill.style.width = `${(into / span) * 100}%`;
    card.xp.output.textContent = `${into} / ${span} XP`;
  } else {
    card.xp.fill.style.width = '100%';
    card.xp.output.textContent = 'Max';
  }
  card.fullness.fill.style.width = `${pet.hunger}%`;
  card.fullness.output.textContent = `${pet.hunger}%`;
  card.happiness.fill.style.width = `${pet.happiness}%`;
  card.happiness.output.textContent = `${pet.happiness}%`;

  for (const swatch of card.swatches.children) {
    const selected = swatch.dataset.tint === pet.tint;
    swatch.classList.toggle('selected', selected);
    swatch.setAttribute('aria-pressed', String(selected));
  }

  if (card.hatLevel !== pet.level) {
    card.hatLevel = pet.level;
    card.hatSelect.replaceChildren(
      ...hats.map((hat) => {
        const option = el('option', '', hatLabel(hat, pet.level));
        option.value = hat.id;
        option.disabled = !hatAvailable(hat, pet.level);
        return option;
      }),
    );
  }
  if (document.activeElement !== card.hatSelect) card.hatSelect.value = pet.hatChoice;
  card.goodbye.hidden = roster.length <= 1;
}

function renderPets() {
  const container = $('pet-cards');
  const ids = new Set(roster.map((p) => p.id));
  for (const [id, card] of cards) {
    if (ids.has(id)) continue;
    card.root.remove();
    cards.delete(id);
  }
  for (const pet of roster) {
    if (!cards.has(pet.id)) cards.set(pet.id, buildCard(pet));
    const card = cards.get(pet.id);
    container.append(card.root); // keeps roster order
    updateCard(card, pet);
  }
  const add = $('add-pet');
  add.textContent = `Add a friend (${roster.length}/${maxPets})`;
  add.disabled = roster.length >= maxPets;
}

if (seasonLabel) {
  const note = $('season-note');
  note.textContent = `${SEASON_ICONS[season] ?? '✨'} It's ${seasonLabel}! Seasonal hats are available.`;
  note.hidden = false;
}
$('add-pet').addEventListener('click', () => api.action('add'));
for (const node of document.querySelectorAll('[data-action]')) {
  node.addEventListener('click', () => api.action(node.dataset.action));
}

// ---- shop and quests ----------------------------------------------------------------

function shopMessage(error) {
  return { poor: 'Not enough treats yet: finish some quests!', owned: 'You already have that.' }[error] ?? 'Something went wrong.';
}

function renderHome() {
  $('treat-count').textContent = `🍪 ${home.treats} ${home.treats === 1 ? 'treat' : 'treats'}`;

  $('quests').replaceChildren(
    ...home.quests.map((quest) => {
      const row = el('div', quest.done ? 'quest done' : 'quest');
      const bar = el('div', 'bar');
      const fill = el('div', 'fill quest-fill');
      fill.style.width = `${(quest.progress / quest.target) * 100}%`;
      bar.append(fill);
      const progress = quest.done ? 'Done ✓' : `${quest.progress.toLocaleString()} / ${quest.target.toLocaleString()}`;
      row.append(el('span', 'quest-label', quest.label), bar, el('span', 'quest-progress', progress), el('span', 'quest-reward', `+${quest.reward} 🍪`));
      return row;
    }),
  );

  $('shop').replaceChildren(
    ...home.shop.map((item) => {
      const card = el('div', 'shop-item');
      const preview = el('canvas', 'shop-preview');
      if (FURNITURE[item.id]) renderPixelArt(preview, FURNITURE[item.id], 2);
      const text = el('div', 'shop-text');
      text.append(el('strong', '', item.label), el('span', '', item.description));
      const owned = home.owned.includes(item.id);
      const placed = item.id in home.placed;
      let action;
      if (!owned) {
        action = button(`Buy · ${item.price} 🍪`, async () => {
          const error = await api.buy(item.id);
          if (error) alert(shopMessage(error));
        });
        action.disabled = home.treats < item.price;
      } else if (placed) {
        action = button('Put away', () => api.putAway(item.id), 'secondary');
      } else {
        action = button('Place', () => api.place(item.id));
      }
      card.append(preview, text, action);
      return card;
    }),
  );
}

// ---- your reminders -----------------------------------------------------------------

const WEEKDAYS = Array.from({ length: 7 }, (_, d) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: 'short' })); // Sun..Sat
let editingId = null;

function todayKey() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function describeSchedule(r) {
  switch (r.repeat) {
    case 'once': {
      const [y, m, d] = r.date.split('-').map(Number);
      return `Once, ${new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${r.time}`;
    }
    case 'daily':
      return `Every day at ${r.time}`;
    case 'weekdays':
      return `Weekdays at ${r.time}`;
    case 'weekends':
      return `Weekends at ${r.time}`;
    default:
      return `${r.days.map((d) => WEEKDAYS[d]).join(', ')} at ${r.time}`;
  }
}

function buildDayPickers() {
  $('r-days').replaceChildren(
    ...WEEKDAYS.map((name, day) => {
      const label = el('label', 'day');
      const box = el('input');
      box.type = 'checkbox';
      box.value = String(day);
      label.append(box, el('span', '', name));
      return label;
    }),
  );
}

function updateRepeatFields() {
  const repeat = $('r-repeat').value;
  $('r-date').hidden = repeat !== 'once';
  $('r-days').hidden = repeat !== 'days';
}

function resetReminderForm() {
  editingId = null;
  $('reminder-form').reset();
  $('r-date').value = todayKey();
  for (const box of $('r-days').querySelectorAll('input')) box.checked = false;
  $('reminder-form-title').textContent = 'New reminder';
  $('r-save').textContent = 'Add reminder';
  $('r-cancel').hidden = true;
  $('r-error').hidden = true;
  updateRepeatFields();
}

function editReminder(r) {
  editingId = r.id;
  $('r-text').value = r.text;
  $('r-time').value = r.time;
  $('r-repeat').value = r.repeat;
  $('r-date').value = r.date;
  for (const box of $('r-days').querySelectorAll('input')) box.checked = r.days.includes(Number(box.value));
  $('reminder-form-title').textContent = 'Edit reminder';
  $('r-save').textContent = 'Save changes';
  $('r-cancel').hidden = false;
  updateRepeatFields();
  $('r-text').focus();
}

function renderReminders() {
  const list = $('reminder-list');
  if (!reminders.length) {
    list.replaceChildren(el('p', 'muted', 'No reminders yet.'));
    return;
  }
  list.replaceChildren(
    ...reminders.map((r) => {
      const row = el('div', r.enabled ? 'reminder' : 'reminder off');
      const toggle = el('input');
      toggle.type = 'checkbox';
      toggle.checked = r.enabled;
      toggle.setAttribute('aria-label', `Turn "${r.text}" ${r.enabled ? 'off' : 'on'}`);
      toggle.addEventListener('change', () => api.toggleReminder(r.id, toggle.checked));
      const text = el('div', 'reminder-text');
      text.append(el('strong', '', r.text), el('span', '', describeSchedule(r)));
      row.append(
        toggle,
        text,
        button('Edit', () => editReminder(r), 'secondary small-button'),
        button('Delete', () => api.deleteReminder(r.id), 'secondary small-button'),
      );
      return row;
    }),
  );
}

$('r-repeat').addEventListener('change', updateRepeatFields);
$('r-cancel').addEventListener('click', resetReminderForm);
$('reminder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const days = [...$('r-days').querySelectorAll('input:checked')].map((box) => Number(box.value));
  const saved = await api.saveReminder({
    id: editingId ?? undefined,
    text: $('r-text').value,
    time: $('r-time').value,
    repeat: $('r-repeat').value,
    date: $('r-date').value,
    days,
  });
  if (saved) return resetReminderForm();
  const error = $('r-error');
  error.textContent = $('r-repeat').value === 'days' && !days.length ? 'Pick at least one day.' : 'Add some text and a time.';
  error.hidden = false;
});

// ---- stats --------------------------------------------------------------------------

function compact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function dayLabel(dateKey, { long = false } = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (!long && dateKey === stats.last7.at(-1).date) return 'Today';
  return date.toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short' });
}

function renderTiles() {
  const { today, streak } = stats;
  const tiles = [
    ['Keys today', compact(today.keys)],
    ['Active today', duration(today.activeMin)],
    ['Focus sessions today', String(today.focus)],
    ['Streak', `${streak} ${streak === 1 ? 'day' : 'days'}`],
  ];
  $('tiles').replaceChildren(
    ...tiles.map(([label, value]) => {
      const tile = el('div', 'tile');
      tile.append(el('span', 'tile-label', label), el('strong', 'tile-value', value));
      return tile;
    }),
  );
}

// 0 plus 2-4 clean steps (1, 2 or 5 × a power of ten) covering max.
function niceTicks(max) {
  if (max <= 0) return [0, 50, 100];
  const rough = max / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough);
  const ticks = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}

// Column with a 4px rounded top and a square base.
function columnPath(x, y, w, h) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const tooltip = $('tooltip');

function showTooltip(target, value, label) {
  tooltip.replaceChildren(el('strong', '', value), el('span', '', label));
  tooltip.hidden = false;
  const box = target.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.width / 2), window.innerWidth - tip.width - 8);
  tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(box.top - tip.height - 6 + window.scrollY)}px)`;
}

function renderChart() {
  const container = $('chart');
  const days = stats.last7;
  const width = Math.max(280, container.clientWidth || 440);
  const height = 190;
  const m = { top: 22, right: 8, bottom: 26, left: 40 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const max = Math.max(...days.map((d) => d.keys));
  const ticks = niceTicks(max);
  const top = ticks.at(-1);
  const y = (v) => m.top + plotH - (v / top) * plotH;
  const band = plotW / days.length;
  const barW = Math.min(24, band * 0.6);
  const today = days.at(-1);

  const chart = svg('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `Keys typed per day for the last 7 days. Today: ${today.keys.toLocaleString()}.`,
  });

  for (const tick of ticks) {
    chart.append(svg('line', { class: 'grid', x1: m.left, x2: width - m.right, y1: y(tick), y2: y(tick) }));
    const label = svg('text', { class: 'axis', x: m.left - 8, y: y(tick) + 4, 'text-anchor': 'end' });
    label.textContent = compact(tick);
    chart.append(label);
  }

  days.forEach((day, i) => {
    const cx = m.left + band * (i + 0.5);
    const bar = day.keys > 0 ? svg('path', { class: 'bar', d: columnPath(cx - barW / 2, y(day.keys), barW, Math.max(2, m.top + plotH - y(day.keys))) }) : null;
    if (bar) chart.append(bar);

    const label = svg('text', { class: 'axis', x: cx, y: height - 8, 'text-anchor': 'middle' });
    label.textContent = dayLabel(day.date);
    chart.append(label);

    // The whole column is the hover/focus target, not just the painted bar.
    const hit = svg('rect', { class: 'hit', x: m.left + band * i, y: m.top, width: band, height: plotH, tabindex: 0 });
    const value = `${day.keys.toLocaleString()} keys`;
    const when = dayLabel(day.date, { long: true });
    hit.setAttribute('aria-label', `${when}: ${value}`);
    const enter = () => {
      bar?.classList.add('active');
      showTooltip(hit, value, when);
    };
    const leave = () => {
      bar?.classList.remove('active');
      tooltip.hidden = true;
    };
    hit.addEventListener('pointerenter', enter);
    hit.addEventListener('focus', enter);
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('blur', leave);
    chart.append(hit);
  });

  // Label only today's value, on its cap.
  if (today.keys > 0) {
    const label = svg('text', { class: 'value', x: m.left + band * (days.length - 0.5), y: y(today.keys) - 6, 'text-anchor': 'middle' });
    label.textContent = compact(today.keys);
    chart.append(label);
  }
  if (max === 0) {
    const empty = svg('text', { class: 'axis', x: m.left + plotW / 2, y: m.top + plotH / 2, 'text-anchor': 'middle' });
    empty.textContent = 'No typing recorded yet';
    chart.append(empty);
  }
  container.replaceChildren(chart);

  $('chart-table').replaceChildren(
    ...days.map((day) => {
      const row = el('tr');
      row.append(
        el('th', '', dayLabel(day.date, { long: true })),
        el('td', '', day.keys.toLocaleString()),
        el('td', '', duration(day.activeMin)),
        el('td', '', String(day.focus)),
      );
      row.firstChild.scope = 'row';
      return row;
    }),
  );
}

function renderAchievements() {
  const unlocked = stats.achievements.filter((a) => a.unlockedAt).length;
  $('achievements-title').textContent = `Achievements · ${unlocked} of ${stats.achievements.length}`;
  $('achievements').replaceChildren(
    ...stats.achievements.map((a) => {
      const item = el('div', a.unlockedAt ? 'achievement' : 'achievement locked');
      const text = el('div');
      const when = a.unlockedAt ? `Unlocked ${new Date(a.unlockedAt).toLocaleDateString()}` : 'Locked';
      text.append(el('strong', '', a.title), el('span', '', a.description), el('small', '', when));
      item.append(el('span', 'achievement-icon', a.unlockedAt ? a.icon : '🔒'), text);
      return item;
    }),
  );
}

function renderStats() {
  renderTiles();
  renderChart();
  renderAchievements();
}

async function refreshStats() {
  stats = (await api.getStats()) ?? stats;
  renderStats();
}

setInterval(() => {
  if (currentTab === 'stats') refreshStats();
}, 5000);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => currentTab === 'stats' && renderChart(), 150);
});

// ---- settings -----------------------------------------------------------------------

const form = $('form');
const controls = new Map(); // key -> { item, input, output }
let values = {};

// Number in the unit shown to the user.
const shown = (item, stored) => Number((stored / (item.factor ?? 1)).toFixed(2));

function describe(item, value) {
  if (item.type === 'checkbox' || item.type === 'time') return '';
  if (item.type === 'number') return item.unit;
  const text = Number(value.toFixed(2));
  return item.unit === '×' || item.unit === '%' ? `${text}${item.unit}` : `${text} ${item.unit}`;
}

function buildForm(schema) {
  let section = null;
  for (const item of schema) {
    if (section?.dataset.name !== item.section) {
      section = el('section', 'card');
      section.dataset.name = item.section;
      section.append(el('h2', '', item.section));
      form.append(section);
    }

    const row = el('label', `row ${item.type}`);
    const input = el('input');
    input.type = item.type;
    if (item.type === 'range' || item.type === 'number') Object.assign(input, { min: item.min, max: item.max, step: item.step });
    const output = el('output');
    row.append(el('span', 'label', item.label), input, output);
    section.append(row);
    controls.set(item.key, { item, input, output });

    input.addEventListener(item.type === 'range' || item.type === 'checkbox' ? 'input' : 'change', () => {
      let value;
      if (item.type === 'checkbox') {
        value = input.checked;
      } else if (item.type === 'time') {
        if (!input.value) return;
        value = input.value;
      } else {
        const number = Math.min(item.max, Math.max(item.min, Number(input.value)));
        if (!Number.isFinite(number)) return;
        output.textContent = describe(item, number);
        value = number * (item.factor ?? 1);
      }
      values[item.key] = value;
      updateDependents();
      api.set(item.key, value);
    });
  }
}

function updateDependents() {
  for (const { item, input } of controls.values()) {
    if (!item.dependsOn) continue;
    input.disabled = !values[item.dependsOn];
    input.closest('.row').classList.toggle('disabled', input.disabled);
  }
}

function showValues(next) {
  values = next;
  for (const [key, { item, input, output }] of controls) {
    if (item.type === 'checkbox') {
      input.checked = Boolean(values[key]);
    } else if (item.type === 'time') {
      if (document.activeElement !== input) input.value = values[key];
    } else {
      const value = shown(item, values[key]);
      if (document.activeElement !== input) input.value = value;
      output.textContent = describe(item, value);
    }
  }
  updateDependents();
}

const formatHotkey = (accelerator) =>
  (accelerator || 'none').replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl').split('+').join(' + ');
$('hotkey-summon').textContent = formatHotkey(initial.hotkeys.summon);
$('hotkey-hide').textContent = formatHotkey(initial.hotkeys.toggleHide);

$('reset').addEventListener('click', () => {
  if (confirm('Reset all settings to their defaults? (Your pets and stats are kept.)')) api.reset();
});

// ---- start --------------------------------------------------------------------------

buildForm(initial.schema);
showValues(initial.values);
renderPets();
renderHome();
buildDayPickers();
resetReminderForm();
renderReminders();
renderStats();
showTab(new URLSearchParams(location.search).get('tab') ?? 'pets');

api.onShowTab(showTab);
api.onHome((next) => {
  home = next;
  renderHome();
});
api.onReminders((next) => {
  reminders = next;
  renderReminders();
});
api.onValues(showValues);
api.onRoster((next) => {
  roster = next;
  renderPets();
});
api.onStats((next) => {
  stats = next;
  if (currentTab === 'stats') renderStats();
});
