'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  ipcMain,
  screen,
  dialog,
  globalShortcut,
  powerMonitor,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Settings, SCHEMA } = require('./lib/settings');
const { Roster, MAX_PETS } = require('./lib/roster');
const { Stats, dayKey } = require('./lib/stats');
const { Economy, SHOP } = require('./lib/economy');
const { UserReminders } = require('./lib/user-reminders');
const { HATS, TINTS, SEASON_LABELS, currentSeason, effectiveHat } = require('./lib/catalog');
const { Reminders, Pomodoro } = require('./lib/reminders');
const { startKeyboardWatch } = require('./lib/keyboard');
const { createWindowScanner, toLedges, toSides } = require('./lib/windows');
const { createFullscreenCheck, inWindow } = require('./lib/system');

const APP_ROOT = app.getAppPath();
const SOUND_EXTENSIONS = ['.wav', '.mp3', '.ogg'];
const MOOD_LABELS = { happy: 'happy', okay: 'okay', sad: 'sad', hungry: 'hungry' };
const PHASE_LABELS = { focus: 'focus', short: 'short break', long: 'long break' };
const SNOOZE_MIN = 10;
// Pet events (from the renderer) that also count towards daily stats and quests.
const EVENT_STATS = {
  click: 'clicks',
  trick: 'tricks',
  fling: 'flings',
  catch: 'catches',
  tag: 'tags',
  played: 'played',
  petted: 'petted',
  tickled: 'petted',
  treat: 'treatsGiven',
  toy: 'toyPlays',
};

// One transparent, click-through pet window ("overlay") per monitor, keyed by display id.
const overlays = new Map();
const petDisplay = new Map(); // pet id -> display id of the monitor it's on
const overlayStatus = new Map(); // display id -> { sleeping, laser } as last reported
const platformsByDisplay = new Map(); // display id -> { ledges, sides }
let primaryId = null;
let settingsWin = null;
let tray = null;
let settings = null;
let roster = null;
let stats = null;
let economy = null;
let userReminders = null;
let pomodoro = null;
let soundUrls = {};
let stopKeyboard = () => {};
let paused = false;
let hidden = false; // tray / hotkey
let autoHidden = false; // a full-screen app, game or presentation is in front
let fullscreenOverride = false; // you called the pets anyway; lasts until that full-screen app goes
let dndManual = false; // tray "Do not disturb"
let ambient = { night: false, quiet: false };
let lockedAt = null;
let petsSleeping = false; // mirrored from the overlays so menu labels stay accurate
let laserOn = false; // likewise
let keyXpCarry = 0;
let newDayPending = false;
// Reminders that came due while the pets couldn't be seen; brought on a sign once they're back,
// unless the Windows notification was clicked.
const missedReminders = new Map();
const openToasts = new Set(); // keeps notifications alive (and clickable) until they close

// Hidden pets behave exactly like paused ones (no loop, no counting, no reminders).
const isPaused = () => paused || hidden || autoHidden;
const season = () => settings.config.seasons.override ?? currentSeason();

function sendTo(displayId, channel, ...args) {
  const overlay = overlays.get(displayId);
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, ...args);
}

function broadcast(channel, ...args) {
  for (const id of overlays.keys()) sendTo(id, channel, ...args);
}

function sendSettings(channel, ...args) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, ...args);
}

// Which monitor a pet is on (the main one if its monitor went away).
const displayOf = (petId) => (overlays.has(petDisplay.get(petId)) ? petDisplay.get(petId) : primaryId);
const sendToPet = (petId, channel, ...args) => sendTo(displayOf(petId), channel, ...args);
const leaderDisplay = () => (roster.pets.length ? displayOf(roster.pets[0].id) : primaryId);
const hasPetsOn = (displayId) => roster.pets.some((pet) => displayOf(pet.id) === displayId);

function cursorDisplay() {
  const id = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  return overlays.has(id) ? id : primaryId;
}

// The display id of the overlay an IPC message came from, or null.
function overlayOf(event) {
  for (const [id, overlay] of overlays) if (!overlay.isDestroyed() && overlay.webContents === event.sender) return id;
  return null;
}

function say(key, vars, petId) {
  sendTo(petId ? displayOf(petId) : leaderDisplay(), 'pet:say', { key, vars, petId });
}

function toast(message) {
  sendTo(primaryId, 'pet:toast', message);
}

function forwardConsole(webContents) {
  if (!app.isPackaged) webContents.on('console-message', (event) => console.log(`[renderer] ${event.message}`));
}

// Optional real sound files: assets/sounds/<name>.wav|mp3|ogg replaces that synthesized sound.
function findSoundFiles() {
  const dir = path.join(APP_ROOT, 'assets', 'sounds');
  const urls = {};
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return urls;
  }
  for (const file of files) {
    const { name, ext } = path.parse(file);
    if (SOUND_EXTENSIONS.includes(ext.toLowerCase())) urls[name] = pathToFileURL(path.join(dir, file)).href;
  }
  return urls;
}

function petConfig() {
  const config = settings.config;
  return {
    ...config,
    spriteUrl: pathToFileURL(path.join(APP_ROOT, config.sprite.path)).href,
    soundUrls,
    season: season(),
    ambient,
  };
}

function onSettingsChanged() {
  broadcast('pet:config', petConfig());
  sendSettings('settings:values', settings.values());
  syncOverlays(); // "Roam across all my monitors" may have changed
  refreshAmbient();
  buildTrayMenu();
}

// Night (nightcaps, earlier naps) and do-not-disturb (no bubbles, sounds or nudges).
function refreshAmbient() {
  const { smart, dnd } = settings.config;
  const next = {
    night: Boolean(smart.night) && inWindow(smart.nightStart, smart.nightEnd),
    quiet: dndManual || (Boolean(dnd.enabled) && inWindow(dnd.start, dnd.end)),
  };
  if (next.night === ambient.night && next.quiet === ambient.quiet) return;
  ambient = next;
  broadcast('pet:ambient', ambient);
  buildTrayMenu();
}

// ---------------------------------------------------------------------------
// Monitors: one overlay each, and pets moving between them
// ---------------------------------------------------------------------------

const hwndOf = (overlay) => Number(overlay.getNativeWindowHandle().readBigUInt64LE(0));
const findDisplay = (id) => screen.getAllDisplays().find((d) => d.id === id);

// The monitor next to this one on the left or right (edges touching, overlapping vertically by a
// fair stretch), if it has an overlay. Compared in physical pixels, since scaling can differ.
function neighbour(displayId, side) {
  const me = findDisplay(displayId);
  if (!me) return null;
  const a = screen.dipToScreenRect(null, me.bounds);
  for (const id of overlays.keys()) {
    if (id === displayId) continue;
    const other = findDisplay(id);
    if (!other) continue;
    const b = screen.dipToScreenRect(null, other.bounds);
    const touching = side === 'left' ? Math.abs(b.x + b.width - a.x) <= 2 : Math.abs(a.x + a.width - b.x) <= 2;
    const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (touching && overlap > 100) return other;
  }
  return null;
}

function displayInfo(displayId) {
  return {
    id: displayId,
    primary: displayId === primaryId,
    edges: { left: Boolean(neighbour(displayId, 'left')), right: Boolean(neighbour(displayId, 'right')) },
  };
}

// A point in a display's work area (DIP) <-> physical screen pixels.
function toPhysical(display, x, y) {
  const origin = screen.dipToScreenPoint({ x: display.workArea.x, y: display.workArea.y });
  return { x: origin.x + x * display.scaleFactor, y: origin.y + y * display.scaleFactor };
}

function toLocal(display, point) {
  const origin = screen.dipToScreenPoint({ x: display.workArea.x, y: display.workArea.y });
  return { x: (point.x - origin.x) / display.scaleFactor, y: (point.y - origin.y) / display.scaleFactor };
}

// Where a pet leaving `fromId` turns up: through a side edge (walking or flying), or dropped at a
// point that's on another monitor.
function arrivalFor(fromId, move) {
  const from = findDisplay(fromId);
  if (!from) return null;
  if (move.side) {
    const target = neighbour(fromId, move.side);
    if (!target) return null;
    const ratio = from.scaleFactor / target.scaleFactor;
    const feetY = move.grounded ? null : toLocal(target, toPhysical(from, 0, move.feetY)).y;
    return {
      displayId: target.id,
      data: { edge: move.side === 'left' ? 'right' : 'left', feetY, vx: move.vx * ratio, vy: move.vy * ratio, dir: move.dir, state: move.state, idleMs: move.idleMs },
    };
  }
  const point = toPhysical(from, move.x, move.y);
  const target = [...overlays.keys()]
    .map(findDisplay)
    .find((d) => {
      if (!d) return false;
      const b = screen.dipToScreenRect(null, d.workArea);
      return point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
    });
  if (!target || target.id === fromId) return null;
  const local = toLocal(target, point);
  return { displayId: target.id, data: { x: local.x, feetY: local.y, vx: 0, vy: 0, dir: move.dir, state: 'fall', idleMs: move.idleMs } };
}

function createOverlay(display) {
  const overlay = new BrowserWindow({
    ...display.workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    type: 'toolbar', // tool window: keeps it out of Alt+Tab on Windows
    focusable: false, // clicking a pet never steals focus from whatever you're typing in
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', // sound effects without a click first
    },
  });
  overlay.setBounds(display.workArea); // creation can mis-size a window on a monitor with other scaling
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.once('ready-to-show', () => {
    if (!hidden && !autoHidden) overlay.showInactive();
  });
  overlay.on('closed', () => {
    if (overlays.get(display.id) === overlay) overlays.delete(display.id);
  });
  forwardConsole(overlay.webContents);
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlays.set(display.id, overlay);
  return overlay;
}

// One overlay per monitor (or just the main one), following monitors being plugged in, removed,
// rearranged or rescaled. Pets on a monitor that went away come back to the main one.
function syncOverlays() {
  primaryId = screen.getPrimaryDisplay().id;
  const wanted = settings.config.displays.all ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
  for (const [id, overlay] of overlays) {
    if (wanted.some((d) => d.id === id)) continue;
    overlays.delete(id);
    overlayStatus.delete(id);
    platformsByDisplay.delete(id);
    overlay.destroy();
  }
  for (const display of wanted) {
    const overlay = overlays.get(display.id);
    if (overlay) overlay.setBounds(display.workArea);
    else createOverlay(display);
  }
  // Moved for good: they don't vanish again if that monitor comes back.
  for (const [petId, displayId] of petDisplay) if (!overlays.has(displayId)) petDisplay.set(petId, primaryId);
  for (const id of overlays.keys()) sendTo(id, 'pet:display', displayInfo(id));
  if (roster) broadcastRoster();
}

// ---------------------------------------------------------------------------
// Pets, stats, quests and achievements
// ---------------------------------------------------------------------------

const rosterSnapshot = () => roster.snapshot(season());
const homeSnapshot = () => economy.snapshot(stats.todayCounts());

// Every overlay gets the whole roster plus which pets are on its monitor.
function rosterFor(displayId, pets = rosterSnapshot()) {
  return { pets, here: pets.filter((p) => displayOf(p.id) === displayId).map((p) => p.id) };
}

function broadcastRoster() {
  const pets = rosterSnapshot();
  for (const id of overlays.keys()) sendTo(id, 'pet:roster', rosterFor(id, pets));
  sendSettings('settings:roster', withWhereabouts(pets));
  updateTrayTooltip();
}

// Which monitor a pet is on, for the settings window: 'main', 'left', 'right', 'top' or 'bottom'
// (of the main one). Only said when there's more than one monitor.
function withWhereabouts(pets) {
  if (overlays.size < 2) return pets;
  const main = screen.getPrimaryDisplay().bounds;
  const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  return pets.map((pet) => {
    const display = findDisplay(displayOf(pet.id));
    if (!display || display.id === primaryId) return { ...pet, where: 'main' };
    const a = centre(main);
    const b = centre(display.bounds);
    const where = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x < a.x ? 'left' : 'right') : b.y < a.y ? 'top' : 'bottom';
    return { ...pet, where };
  });
}

function broadcastHome() {
  const home = homeSnapshot();
  broadcast('pet:home', home); // only the main monitor's overlay shows furniture
  sendSettings('settings:home', home);
  buildTrayMenu();
}

function announce(achievements) {
  for (const a of achievements) {
    toast({ icon: a.icon, kicker: 'Achievement unlocked', title: a.title, description: a.description, sound: 'achievement' });
  }
  if (achievements.length) sendSettings('settings:stats', stats.snapshot());
}

function celebrate(levelUps) {
  for (const levelUp of levelUps) sendToPet(levelUp.id, 'pet:level-up', levelUp);
  if (levelUps.length) announce(stats.check());
}

function checkQuests() {
  const finished = economy.checkQuests(stats.todayCounts());
  if (!finished.length) return;
  for (const quest of finished) {
    toast({ icon: '📜', kicker: 'Quest complete', title: quest.label, description: `+${quest.reward} treats 🍪`, sound: 'coin' });
  }
  announce(stats.add('quests', finished.length));
  economy.save();
  broadcastHome();
}

function countStat(counter, amount = 1) {
  announce(stats.add(counter, amount));
  checkQuests();
}

function newDayToast() {
  toast({ icon: '🌅', kicker: 'New day', title: '+2 treats 🍪', description: '3 new quests are waiting in Shop and quests', sound: 'coin' });
}

function feed(petId) {
  for (const id of petId ? [petId] : roster.ids()) {
    const result = roster.feed(id, settings.config.needs.feedAmount, settings.config.xp.feedXp);
    if (!result) continue;
    sendToPet(id, 'pet:command', { type: result.ate ? 'eat' : 'full', petId: id });
    if (result.ate) countStat('fed');
    celebrate(result.levelUps);
  }
  broadcastRoster();
}

function cuddle(petId) {
  for (const id of petId ? [petId] : roster.ids()) {
    celebrate(roster.apply('cuddle', id) ?? []);
    sendToPet(id, 'pet:command', { type: 'cuddle', petId: id });
    countStat('petted');
  }
  broadcastRoster();
}

function addPet() {
  const pet = roster.add();
  if (!pet) return;
  petDisplay.set(pet.id, leaderDisplay()); // friends turn up where the others are
  roster.save();
  broadcastRoster();
  say('newFriend', { name: pet.name }, pet.id);
  announce(stats.check());
}

function removePet(petId) {
  const pet = roster.get(petId);
  if (!pet || roster.pets.length <= 1) return;
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Say goodbye', 'Keep'],
    defaultId: 1,
    cancelId: 1,
    title: 'Desktop Pet',
    message: `Say goodbye to ${pet.name}?`,
    detail: `${pet.name}'s level and XP will be gone for good.`,
  });
  if (choice !== 0) return;
  say('goodbye', {}, petId);
  setTimeout(() => {
    roster.remove(petId);
    petDisplay.delete(petId);
    roster.save();
    broadcastRoster();
  }, 1500);
}

function dropTreat() {
  if (!economy.spendTreat()) return;
  economy.save();
  sendTo(cursorDisplay(), 'pet:command', { type: 'treat' });
  broadcastHome();
}

// Ball games happen where the cursor is, if any pets are there; otherwise where the pets are.
const playDisplay = () => (hasPetsOn(cursorDisplay()) ? cursorDisplay() : leaderDisplay());

const ACTIONS = {
  feed,
  cuddle,
  play: () => sendTo(playDisplay(), 'pet:command', { type: 'play' }), // XP and happiness come when the game ends
  treat: dropTreat,
  laser: () => broadcast('pet:command', { type: 'laser', on: !laserOn }),
  yarn: () => sendTo(cursorDisplay(), 'pet:command', { type: 'yarn' }),
  toysAway: () => broadcast('pet:command', { type: 'toys-away' }),
  add: addPet,
  remove: removePet,
  bringBack,
};
const WHILE_PAUSED = new Set(['add', 'remove', 'bringBack']);

function runAction(name, petId) {
  if (!Object.hasOwn(ACTIONS, name)) return;
  if (isPaused() && !WHILE_PAUSED.has(name)) return;
  ACTIONS[name](typeof petId === 'string' ? petId : undefined);
}

function buyFurniture(id) {
  const error = economy.buy(id);
  if (error) return error;
  economy.save();
  broadcastHome();
  const item = SHOP.find((i) => i.id === id);
  sendTo(primaryId, 'pet:say', { key: 'newFurniture', vars: { item: item.label.toLowerCase() } });
  announce(stats.check());
  return null;
}

function putAway(id) {
  if (!economy.putAway(id)) return;
  economy.save();
  broadcastHome();
}

function startPetLife() {
  const userData = app.getPath('userData');
  roster = new Roster(path.join(userData, 'pets.json'), path.join(userData, 'pet-state.json'));
  economy = new Economy(path.join(userData, 'home.json'));
  userReminders = new UserReminders(path.join(userData, 'reminders.json'));
  stats = new Stats(path.join(userData, 'stats.json'), () => ({
    maxLevel: roster.maxLevel(),
    petCount: roster.pets.length,
    ownedCount: economy.data.owned.length,
  }));
  newDayPending = economy.rollDay(dayKey());
  economy.save();

  let last = Date.now();
  let lastSeason = season();
  setInterval(() => {
    const now = Date.now();
    if (!isPaused()) roster.decay((now - last) / 3_600_000, settings.config.needs);
    last = now;
    if (economy.rollDay(dayKey())) {
      newDayToast();
      broadcastHome();
    }
    roster.save();
    stats.save();
    economy.save();
    userReminders.save();
    if (season() !== lastSeason) {
      lastSeason = season();
      onSettingsChanged();
    }
    broadcastRoster();
  }, 60_000);
}

function onKeys(count) {
  countStat('keys', count);
  // Typing earns every pet a little XP.
  const { keysPerXp } = settings.config.xp;
  keyXpCarry += count;
  if (keyXpCarry < keysPerXp) return;
  const xp = Math.floor(keyXpCarry / keysPerXp);
  keyXpCarry -= xp * keysPerXp;
  celebrate(roster.addXpAll(xp));
  broadcastRoster();
}

function startReminders() {
  pomodoro = new Pomodoro({
    getConfig: () => settings.config,
    onChange: (phase, minutes) => {
      say(`pomodoro-${phase}`, { min: minutes });
      buildTrayMenu();
    },
    onFocusDone: () => {
      countStat('focus');
      celebrate(roster.addXpAll(settings.config.xp.focusXp));
      broadcastRoster();
    },
  });
  new Reminders({
    getConfig: () => settings.config,
    isPaused,
    isQuiet: () => ambient.quiet,
    pomodoroActive: () => pomodoro.active,
    notify: (kind) => say(kind),
    onActiveMinute: () => countStat('activeMin'),
    onBreak: () => countStat('breaks'),
  });
  // Keep the "N min left" labels current.
  setInterval(() => {
    if (pomodoro.active) buildTrayMenu();
  }, 30_000);

  // Your own reminders.
  setInterval(() => {
    const due = userReminders.due();
    if (!due.length) return;
    userReminders.save();
    for (const reminder of due) deliverReminder(reminder);
    sendSettings('settings:reminders', userReminders.list());
  }, 15_000);
}

// A pet brings it on a sign; when the pets can't be seen, Windows shows a notification instead.
function deliverReminder(reminder) {
  if (!isPaused() && overlays.size) {
    sendTo(leaderDisplay(), 'pet:reminder', reminder);
    return;
  }
  missedReminders.set(reminder.id, reminder);
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: 'Desktop Pet reminder', body: reminder.text });
  openToasts.add(notification);
  notification.on('click', () => missedReminders.delete(reminder.id)); // seen it: no sign later
  notification.on('close', () => openToasts.delete(notification));
  notification.on('failed', (_e, error) => {
    openToasts.delete(notification);
    console.warn(`Reminder notification failed: ${error}`);
  });
  notification.show();
}

// Window tops and sides the pets can climb and stand on, re-scanned a few times a second and
// split up per monitor. Only the pet overlays themselves are left out (Settings counts too).
function startPlatformWatch() {
  const scan = createWindowScanner();
  if (!scan) return;
  const last = new Map();
  setInterval(() => {
    if (isPaused()) return; // keep the last layout so paused pets don't drop
    const excluded = new Set([...overlays.values()].filter((o) => !o.isDestroyed()).map(hwndOf));
    const windows = settings.config.climbing.windows ? scan(excluded) : [];
    for (const id of overlays.keys()) {
      const display = findDisplay(id);
      if (!display) continue;
      const data = { ledges: toLedges(windows, display.workArea), sides: toSides(windows, display.workArea) };
      platformsByDisplay.set(id, data);
      const json = JSON.stringify(data);
      if (json === last.get(id)) continue;
      last.set(id, json);
      sendTo(id, 'pet:platforms', data);
    }
  }, 350);
}

// Where the mouse is, for hovering. Electron forwards mouse moves to click-through windows via a
// low-level mouse hook, which other software can swallow; asking Windows directly is a backup.
function startCursorWatch() {
  let last = { x: NaN, y: NaN };
  setInterval(() => {
    if (!overlays.size || isPaused()) return;
    const point = screen.getCursorScreenPoint();
    if (point.x === last.x && point.y === last.y) return;
    last = point;
    const display = screen.getDisplayNearestPoint(point);
    if (!overlays.has(display.id)) return;
    sendTo(display.id, 'pet:cursor', { x: point.x - display.workArea.x, y: point.y - display.workArea.y });
  }, 100);
}

// Full-screen apps, locking the PC, night and quiet hours.
function startSmartWatch() {
  const fullscreen = createFullscreenCheck();
  if (fullscreen) {
    setInterval(() => {
      const covered = settings.config.smart.hideFullscreen && fullscreen();
      if (!covered) fullscreenOverride = false;
      setAutoHidden(covered && !fullscreenOverride);
    }, 1500);
  }

  const onLock = () => {
    if (lockedAt !== null) return;
    lockedAt = Date.now();
    broadcast('pet:system', { event: 'lock' });
  };
  const onUnlock = () => {
    if (lockedAt === null) return;
    const awayMin = Math.round((Date.now() - lockedAt) / 60_000);
    lockedAt = null;
    broadcast('pet:system', { event: 'unlock', awayMin });
    refreshAmbient();
  };
  powerMonitor.on('lock-screen', onLock);
  powerMonitor.on('suspend', onLock);
  powerMonitor.on('unlock-screen', onUnlock);
  powerMonitor.on('resume', onUnlock);

  refreshAmbient();
  setInterval(refreshAmbient, 30_000);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function openSettings(tab = 'pets') {
  if (settingsWin) {
    sendSettings('settings:show-tab', tab);
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 540,
    height: 820,
    minWidth: 440,
    minHeight: 480,
    title: 'Desktop Pet',
    icon: path.join(APP_ROOT, 'assets', 'tray@2x.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18191d' : '#f3f4f6',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  forwardConsole(settingsWin.webContents);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: { tab } });
}

function applyVisibility(wasPaused) {
  const visible = !hidden && !autoHidden;
  for (const overlay of overlays.values()) {
    if (overlay.isDestroyed()) continue;
    if (visible && !overlay.isVisible()) {
      overlay.showInactive();
      overlay.setAlwaysOnTop(true, 'screen-saver');
    } else if (!visible && overlay.isVisible()) {
      overlay.hide();
    }
  }
  if (isPaused() !== wasPaused) broadcast('pet:command', { type: isPaused() ? 'pause' : 'resume' });
  if (!isPaused()) {
    for (const reminder of missedReminders.values()) sendTo(leaderDisplay(), 'pet:reminder', reminder);
    missedReminders.clear();
  }
  buildTrayMenu();
}

function setPaused(value) {
  const before = isPaused();
  paused = value;
  applyVisibility(before);
}

function setHidden(value) {
  const before = isPaused();
  hidden = value;
  applyVisibility(before);
}

function setAutoHidden(value) {
  if (value === autoHidden) return;
  const before = isPaused();
  autoHidden = value;
  applyVisibility(before);
}

// You asked for the pets: show them, even over a full-screen app (until that one closes).
function showPets() {
  if (hidden) setHidden(false);
  if (paused) setPaused(false);
  if (autoHidden) {
    fullscreenOverride = true;
    setAutoHidden(false);
  }
}

// Every pet pops out next to the mouse cursor, on whichever monitor it's on.
function summonPets() {
  showPets();
  const point = screen.getCursorScreenPoint();
  const nearest = screen.getDisplayNearestPoint(point);
  const target = overlays.has(nearest.id) ? nearest : screen.getPrimaryDisplay();
  for (const pet of roster.pets) petDisplay.set(pet.id, target.id);
  broadcastRoster();
  sendTo(target.id, 'pet:summon', { x: point.x - target.workArea.x, y: point.y - target.workArea.y });
}

// Lost a pet (on a monitor you're not looking at, hidden, up somewhere)? It comes back to the
// main monitor's taskbar next to the tray, awake. One pet, or all of them.
function bringBack(petId) {
  const ids = petId ? [petId] : roster.ids();
  showPets();
  for (const id of ids) petDisplay.set(id, primaryId);
  broadcastRoster();
  sendTo(primaryId, 'pet:summon', { home: true, petIds: ids });
}

function registerHotkeys() {
  const bind = (accelerator, handler) => {
    if (!accelerator) return;
    try {
      if (!globalShortcut.register(accelerator, handler)) {
        console.warn(`Hotkey ${accelerator} is already used by another app`);
      }
    } catch (err) {
      console.warn(`Invalid hotkey "${accelerator}": ${err.message}`);
    }
  };
  bind(settings.config.hotkeys.summon, summonPets);
  bind(settings.config.hotkeys.toggleHide, () => setHidden(!hidden));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  const fromSettings = (event) => settingsWin && event.sender === settingsWin.webContents;

  ipcMain.handle('pet:get-config', () => petConfig());
  ipcMain.handle('pet:get-display', (event) => {
    const id = overlayOf(event);
    return id === null ? null : displayInfo(id);
  });
  ipcMain.handle('pet:get-roster', (event) => rosterFor(overlayOf(event)));
  ipcMain.handle('pet:get-platforms', (event) => platformsByDisplay.get(overlayOf(event)) ?? { ledges: [], sides: [] });
  ipcMain.handle('pet:get-home', () => homeSnapshot());

  ipcMain.on('pet:set-ignore-mouse', (event, ignore) => {
    const id = overlayOf(event);
    if (id !== null) overlays.get(id).setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  ipcMain.on('pet:status', (event, status) => {
    const id = overlayOf(event);
    if (id === null) return;
    overlayStatus.set(id, status ?? {});
    // Asleep when every monitor that has pets says they're all asleep.
    const sleeping = [...overlayStatus.values()].map((s) => s.sleeping).filter((s) => s === true || s === false);
    petsSleeping = sleeping.length > 0 && sleeping.every(Boolean);
    laserOn = [...overlayStatus.values()].some((s) => s.laser);
    buildTrayMenu();
  });

  // A pet walked or was thrown off its monitor's edge, or was dropped onto another monitor.
  ipcMain.handle('pet:transfer', (event, petId, move) => {
    const from = overlayOf(event);
    if (from === null || displayOf(petId) !== from || !move) return false;
    const arrival = arrivalFor(from, move);
    if (!arrival) return false;
    petDisplay.set(petId, arrival.displayId);
    const profile = rosterSnapshot().find((p) => p.id === petId);
    sendTo(arrival.displayId, 'pet:arrive', { profile, arrival: arrival.data });
    broadcastRoster();
    return true;
  });

  ipcMain.on('pet:context-menu', (event, petId, reminderId) => {
    if (overlayOf(event) !== null) showPetMenu(petId, typeof reminderId === 'string' ? reminderId : null);
  });

  ipcMain.on('pet:furniture-menu', (event, id) => {
    if (overlayOf(event) !== null) showFurnitureMenu(id);
  });

  ipcMain.on('pet:place-furniture', (event, id, x) => {
    if (overlayOf(event) === null || !economy.place(id, x)) return;
    economy.save();
    sendSettings('settings:home', homeSnapshot());
  });

  ipcMain.on('pet:reminder-action', (event, id, action) => {
    if (overlayOf(event) === null || action !== 'snooze') return;
    userReminders.snooze(id, SNOOZE_MIN);
    userReminders.save();
  });

  ipcMain.on('pet:event', (event, type, petId) => {
    if (overlayOf(event) === null || isPaused()) return;
    const levelUps = roster.apply(type, typeof petId === 'string' ? petId : null);
    if (!levelUps) return;
    celebrate(levelUps);
    if (EVENT_STATS[type]) countStat(EVENT_STATS[type]);
    broadcastRoster();
  });

  ipcMain.handle('settings:get', (event) => {
    if (!fromSettings(event)) return null;
    return {
      schema: SCHEMA,
      values: settings.values(),
      roster: withWhereabouts(rosterSnapshot()),
      stats: stats.snapshot(),
      home: homeSnapshot(),
      reminders: userReminders.list(),
      hats: HATS,
      tints: TINTS,
      season: season(),
      seasonLabel: SEASON_LABELS[season()] ?? null,
      seasonalHat: effectiveHat('seasonal', 1, season()),
      maxPets: MAX_PETS,
      hotkeys: settings.config.hotkeys,
      sprite: settings.config.sprite,
    };
  });

  ipcMain.handle('settings:get-stats', (event) => (fromSettings(event) ? stats.snapshot() : null));

  ipcMain.on('settings:set', (event, key, value) => {
    if (fromSettings(event) && settings.set(key, value)) onSettingsChanged();
  });

  ipcMain.on('settings:reset', (event) => {
    if (!fromSettings(event)) return;
    settings.reset();
    onSettingsChanged();
  });

  ipcMain.on('settings:action', (event, name, petId) => {
    if (fromSettings(event)) runAction(name, petId);
  });

  ipcMain.on('settings:pet-update', (event, petId, patch) => {
    if (!fromSettings(event) || !roster.update(petId, patch, season())) return;
    roster.save();
    broadcastRoster();
  });

  ipcMain.handle('settings:buy', (event, id) => (fromSettings(event) ? buyFurniture(id) : 'denied'));

  ipcMain.on('settings:place', (event, id) => {
    if (!fromSettings(event) || !economy.place(id, null)) return;
    economy.save();
    broadcastHome();
  });

  ipcMain.on('settings:put-away', (event, id) => {
    if (fromSettings(event)) putAway(id);
  });

  ipcMain.handle('settings:reminder-save', (event, input) => {
    if (!fromSettings(event)) return null;
    const saved = userReminders.upsert(input);
    if (saved) userReminders.save();
    sendSettings('settings:reminders', userReminders.list());
    return saved;
  });

  ipcMain.on('settings:reminder-delete', (event, id) => {
    if (!fromSettings(event)) return;
    userReminders.remove(id);
    userReminders.save();
    sendSettings('settings:reminders', userReminders.list());
  });

  ipcMain.on('settings:reminder-toggle', (event, id, enabled) => {
    if (!fromSettings(event)) return;
    userReminders.setEnabled(id, enabled);
    userReminders.save();
    sendSettings('settings:reminders', userReminders.list());
  });
}

// ---------------------------------------------------------------------------
// Tray and menus
// ---------------------------------------------------------------------------

// Unpackaged (`npm start`) the executable is electron.exe, so the app folder has to be passed
// as an argument. Electron doesn't quote login-item args on Windows, hence the explicit quotes.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [`"${APP_ROOT}"`] };
}

function getLaunchAtLogin() {
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setLaunchAtLogin(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() });
  buildTrayMenu();
}

function sleepItem() {
  return {
    label: petsSleeping ? 'Wake up' : 'Sleep',
    click: () => broadcast('pet:command', { type: petsSleeping ? 'wake' : 'sleep' }),
  };
}

function addItem() {
  return {
    label: `Add a friend (${roster.pets.length}/${MAX_PETS})`,
    enabled: roster.pets.length < MAX_PETS,
    click: () => runAction('add'),
  };
}

function toysMenu() {
  const off = isPaused();
  return {
    label: 'Toys',
    submenu: [
      { label: 'Laser pointer', type: 'checkbox', checked: laserOn, enabled: !off, click: () => runAction('laser') },
      { label: 'Throw a ball of yarn', enabled: !off, click: () => runAction('yarn') },
      {
        label: economy.treats > 0 ? `Drop a treat (${economy.treats} 🍪 left)` : 'Drop a treat (no treats left: finish quests)',
        enabled: !off && economy.treats > 0,
        click: () => runAction('treat'),
      },
      { type: 'separator' },
      { label: 'Put the toys away', enabled: !off, click: () => runAction('toysAway') },
    ],
  };
}

function showPetMenu(petId, reminderId) {
  const pet = rosterSnapshot().find((p) => p.id === petId);
  if (!pet) return;
  const reminder = (action) => () => sendToPet(petId, 'pet:command', { type: 'reminder', id: reminderId, action });
  const reminderItems = reminderId
    ? [
        { label: 'Reminder done', click: reminder('done') },
        { label: `Snooze reminder ${SNOOZE_MIN} min`, click: reminder('snooze') },
        { type: 'separator' },
      ]
    : [];
  Menu.buildFromTemplate([
    ...reminderItems,
    { label: `${pet.name}  ·  level ${pet.level}  ·  ${MOOD_LABELS[pet.mood]}`, enabled: false },
    { label: `Fullness ${pet.hunger}%  ·  happiness ${pet.happiness}%`, enabled: false },
    { type: 'separator' },
    { label: 'Feed', enabled: !isPaused(), click: () => runAction('feed', petId) },
    { label: 'Pet', enabled: !isPaused(), click: () => runAction('cuddle', petId) },
    { label: 'Play ball', enabled: !isPaused(), click: () => runAction('play') },
    toysMenu(),
    { type: 'separator' },
    addItem(),
    { label: `Say goodbye to ${pet.name}…`, visible: roster.pets.length > 1, click: () => runAction('remove', petId) },
    { type: 'separator' },
    sleepItem(),
    { label: 'Settings…', click: () => openSettings('pets') },
  ]).popup({ window: overlays.get(displayOf(petId)) });
}

function showFurnitureMenu(id) {
  const item = SHOP.find((i) => i.id === id);
  if (!item) return;
  Menu.buildFromTemplate([
    { label: item.label, enabled: false },
    { type: 'separator' },
    { label: 'Put away', click: () => putAway(id) },
    { label: 'Shop and quests…', click: () => openSettings('home') },
  ]).popup({ window: overlays.get(primaryId) });
}

// A plain square, so the tray icon (the only way to quit) can never end up invisible.
function fallbackTrayIcon() {
  const size = 16;
  const bgra = Buffer.alloc(size * size * 4);
  for (let i = 0; i < bgra.length; i += 4) bgra.set([0x61, 0xa2, 0xf4, 0xff], i);
  return nativeImage.createFromBitmap(bgra, { width: size, height: size });
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(APP_ROOT, 'assets', 'tray.png'));
  if (icon.isEmpty()) icon = fallbackTrayIcon();
  tray = new Tray(icon);
  tray.on('click', () => tray.popUpContextMenu());
  buildTrayMenu();
}

function updateTrayTooltip() {
  if (!tray) return;
  const lines = ['Desktop Pet'];
  for (const pet of rosterSnapshot()) lines.push(`${pet.name}: ${MOOD_LABELS[pet.mood]}, level ${pet.level}`);
  if (pomodoro.active) lines.push(`Pomodoro ${PHASE_LABELS[pomodoro.phase]}: ${pomodoro.minutesLeft()} min left`);
  if (autoHidden) lines.push('Hiding while a full-screen app runs');
  tray.setToolTip(lines.join('\n').slice(0, 127)); // Windows limit
}

function buildTrayMenu() {
  if (!tray) return;
  const { hotkeys } = settings.config;
  const many = roster.pets.length > 1;
  const pomodoroItem = pomodoro.active
    ? {
        label: `Stop Pomodoro (${PHASE_LABELS[pomodoro.phase]}, ${pomodoro.minutesLeft()} min left)`,
        click: () => pomodoro.stop(),
      }
    : { label: `Start Pomodoro (${settings.config.pomodoro.focusMin} min focus)`, click: () => pomodoro.start() };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: paused ? 'Resume' : 'Pause', click: () => setPaused(!paused) },
      {
        label: hidden ? 'Show pets' : 'Hide pets',
        accelerator: hotkeys.toggleHide,
        registerAccelerator: false,
        click: () => setHidden(!hidden),
      },
      {
        label: 'Call pets to the cursor',
        accelerator: hotkeys.summon,
        registerAccelerator: false,
        click: summonPets,
      },
      {
        label: many ? 'Bring all pets back' : `Bring ${roster.pets[0]?.name ?? 'your pet'} back`,
        click: () => bringBack(),
      },
      sleepItem(),
      { type: 'separator' },
      { label: many ? 'Feed everyone' : 'Feed', enabled: !isPaused(), click: () => runAction('feed') },
      { label: many ? 'Pet everyone' : 'Pet', enabled: !isPaused(), click: () => runAction('cuddle') },
      { label: 'Play ball', enabled: !isPaused(), click: () => runAction('play') },
      toysMenu(),
      addItem(),
      { type: 'separator' },
      pomodoroItem,
      {
        label: 'Do not disturb',
        type: 'checkbox',
        checked: ambient.quiet,
        click: () => {
          dndManual = !ambient.quiet;
          refreshAmbient();
          buildTrayMenu();
        },
      },
      { type: 'separator' },
      { label: `Shop and quests (${economy.treats} 🍪)…`, click: () => openSettings('home') },
      { label: 'Reminders…', click: () => openSettings('reminders') },
      { label: 'Settings and stats…', click: () => openSettings('pets') },
      {
        label: 'Sounds',
        type: 'checkbox',
        checked: settings.config.sound.enabled,
        click: (item) => {
          settings.set('sound.enabled', item.checked);
          onSettingsChanged();
        },
      },
      {
        label: 'Launch at login',
        type: 'checkbox',
        checked: getLaunchAtLogin(),
        click: (item) => setLaunchAtLogin(item.checked),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  updateTrayTooltip();
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  console.log('Desktop Pet is already running (see the tray icon). Quit that copy first.');
  app.quit();
} else {
  Menu.setApplicationMenu(null);
  // Windows only shows notifications from an app whose ID matches a Start menu shortcut; the
  // installer creates that shortcut with the build's appId (so `npm start` notifications also work
  // once the app has been installed).
  app.setAppUserModelId('com.desktoppet.app');

  app.whenReady().then(() => {
    try {
      settings = new Settings(
        path.join(APP_ROOT, 'config.json'),
        path.join(app.getPath('userData'), 'settings.json'),
      );
    } catch (err) {
      dialog.showErrorBox('Desktop Pet', `Could not load config.json\n\n${err.message}`);
      app.exit(1);
      return;
    }
    soundUrls = findSoundFiles();
    startPetLife();
    startReminders();
    registerIpc();
    syncOverlays();
    createTray();
    registerHotkeys();
    startPlatformWatch();
    startSmartWatch();
    startCursorWatch();
    stopKeyboard = startKeyboardWatch({
      isPaused,
      onActivity: () => broadcast('pet:key-activity'),
      onRate: (perTenSec) => broadcast('pet:typing-rate', perTenSec),
      onKeys,
    });
    let displayTimer = null;
    for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
      screen.on(event, () => {
        clearTimeout(displayTimer);
        displayTimer = setTimeout(syncOverlays, 300);
      });
    }
    // Wait until the pets are on screen before showing start-of-day news.
    overlays.get(primaryId).webContents.once('did-finish-load', () =>
      setTimeout(() => {
        if (newDayPending) newDayToast();
        announce(stats.check()); // e.g. a streak that continued today
      }, 4000),
    );
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopKeyboard();
    settings?.save();
    roster?.save();
    stats?.save();
    economy?.save();
    userReminders?.save();
  });
}
