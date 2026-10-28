'use strict';

// Finds the visible top edges ("ledges") and sides of other windows so the pets can climb onto and
// stand on them (Windows only). Calls user32/dwmapi through koffi; if that isn't available, pets
// simply stay on the taskbar.

const { screen } = require('electron');

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CAPTION = 0x00c00000;
const WS_EX_TRANSPARENT = 0x20; // click-through overlays: never platforms, never in the way
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9; // the visible frame, without the invisible resize border
const DWMWA_CLOAKED = 14; // hidden UWP windows and windows on other virtual desktops
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', '#32768']);
const MIN_WINDOW_WIDTH = 80;
const MIN_SEGMENT = 40;

function loadApi() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  koffi.pointer('HWND', koffi.opaque());
  koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t param)');
  return {
    address: (hwnd) => Number(koffi.address(hwnd)),
    EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *proc, intptr_t param)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(HWND hwnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(HWND hwnd)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int index)'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(HWND hwnd)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(HWND hwnd, void *name, int max)'),
    getFrame: dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ RECT *value, uint32_t size)'),
    getCloaked: dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ int *value, uint32_t size)'),
  };
}

// Removes [from, to) from a list of [a, b) intervals.
function subtract(segments, from, to) {
  const out = [];
  for (const [a, b] of segments) {
    if (to <= a || from >= b) {
      out.push([a, b]);
      continue;
    }
    if (from > a) out.push([a, from]);
    if (to < b) out.push([to, b]);
  }
  return out;
}

const topInside = (w, area) => w.r - w.l >= MIN_WINDOW_WIDTH && w.t > area.y && w.t < area.y + area.height;

// Windows arrive in Z order (front first). A window's top edge is a ledge wherever no window in
// front of it covers the strip just above that edge, i.e. where a pet standing there would be seen.
// Coordinates are local to `area` (a display's work area). `left`/`top` are the window's own
// corner, used to carry pets along when the window is dragged.
function toLedges(windows, area) {
  const ledges = [];
  windows.forEach((w, i) => {
    if (!topInside(w, area)) return;
    let segments = [[Math.max(w.l, area.x), Math.min(w.r, area.x + area.width)]];
    const lineY = w.t - 2;
    for (let j = 0; j < i && segments.length; j++) {
      const front = windows[j];
      if (front.t <= lineY && front.b > lineY) segments = subtract(segments, front.l, front.r);
    }
    for (const [x1, x2] of segments) {
      if (x2 - x1 >= MIN_SEGMENT) {
        ledges.push({ id: w.id, x1: x1 - area.x, x2: x2 - area.x, y: w.t - area.y, left: w.l - area.x, top: w.t - area.y });
      }
    }
  });
  return ledges;
}

// The visible parts of each window's left and right sides, for climbing up. A pet climbs on the
// outside of the side, so it's the column just outside the window that must not be covered.
function toSides(windows, area) {
  const sides = [];
  windows.forEach((w, i) => {
    if (!topInside(w, area)) return;
    for (const edge of ['left', 'right']) {
      const x = edge === 'left' ? w.l : w.r;
      if (x <= area.x || x >= area.x + area.width) continue;
      const column = edge === 'left' ? x - 2 : x + 1;
      let segments = [[w.t, Math.min(w.b, area.y + area.height)]];
      for (let j = 0; j < i && segments.length; j++) {
        const front = windows[j];
        if (front.l <= column && front.r > column) segments = subtract(segments, front.t, front.b);
      }
      for (const [y1, y2] of segments) {
        if (y2 - y1 >= MIN_SEGMENT) {
          sides.push({ id: w.id, edge, x: x - area.x, y1: y1 - area.y, y2: y2 - area.y, left: w.l - area.x, top: w.t - area.y });
        }
      }
    }
  });
  return sides;
}

// Returns scan(excludedHwnds) -> windows in Z order as global DIP rects, or null when window
// scanning isn't possible.
function createWindowScanner() {
  if (process.platform !== 'win32') return null;
  let api;
  try {
    api = loadApi();
  } catch (err) {
    console.warn(`koffi failed to load, pets won't climb on windows: ${err.message}`);
    return null;
  }
  const classBuf = Buffer.alloc(512);

  function inspect(hwnd, excluded) {
    const id = api.address(hwnd);
    if (excluded.has(id) || !api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) return null;
    if (Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT)) return null;
    // Untitled windows are mostly invisible helpers; ones with a real title bar still count.
    if (api.GetWindowTextLengthW(hwnd) === 0 && !(Number(api.GetWindowLongPtrW(hwnd, GWL_STYLE)) & WS_CAPTION)) return null;
    const len = api.GetClassNameW(hwnd, classBuf, 256);
    if (SKIP_CLASSES.has(classBuf.toString('utf16le', 0, len * 2))) return null;
    const cloaked = [0];
    if (api.getCloaked(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return null;
    const rect = {};
    if (api.getFrame(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) !== 0) return null;
    const dip = screen.screenToDipRect(null, {
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    });
    return {
      id,
      l: Math.round(dip.x),
      t: Math.round(dip.y),
      r: Math.round(dip.x + dip.width),
      b: Math.round(dip.y + dip.height),
    };
  }

  return function scan(excluded = new Set()) {
    const windows = [];
    api.EnumWindows((hwnd) => {
      try {
        const w = inspect(hwnd, excluded);
        if (w) windows.push(w);
      } catch {
        // window vanished mid-scan
      }
      return true;
    }, 0);
    return windows;
  };
}

module.exports = { createWindowScanner, toLedges, toSides };
