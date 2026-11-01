'use strict';

// Smoke test, preloaded into the app's main process. Run it from the project folder:
//   macOS/Linux:  NODE_OPTIONS="--require ./scripts/smoke-test.js" npx electron . --user-data-dir=<empty dir>
//   PowerShell:   $env:NODE_OPTIONS = '--require ./scripts/smoke-test.js'; npx electron . --user-data-dir=<empty dir>
// Starts the app next to an ordinary window, then checks that the pet windows came up with a pet
// in them, that the window scan finds that window (in the right place) as something to stand on,
// and that nothing logged an error. Saves the main monitor's pet window as smoke-test.png and exits
// with code 1 if anything failed.

// NODE_OPTIONS also reaches plain Node processes (npx, the electron launcher): only act inside the
// app's main process.
if (process.versions.electron && process.type === 'browser') setImmediate(() => {
  const { app, BrowserWindow, screen } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  const { createWindowScanner, windowIdOf, toLedges } = require('../lib/windows');

  const errors = [];
  const failures = [];
  const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
    if (!ok) failures.push(what);
  };
  process.on('uncaughtException', (err) => errors.push(`main process: ${err.stack}`));
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(`page: ${event.message}`);
    });
    contents.on('render-process-gone', (_e, details) => errors.push(`page crashed: ${details.reason}`));
  });

  app.whenReady().then(async () => {
    const area = screen.getPrimaryDisplay().workArea;
    const target = new BrowserWindow({ x: area.x + 200, y: area.y + 250, width: 600, height: 400, title: 'Smoke test window' });
    target.loadURL('data:text/html,<body style="background:%23ddd">Something to climb on</body>');
    await new Promise((resolve) => setTimeout(resolve, 7000));
    target.moveTop(); // in front of any other app's windows, so its top edge is uncovered
    target.focus();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const overlays = BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().endsWith('/renderer/index.html'));
    const monitors = screen.getAllDisplays().length;
    check(overlays.length === monitors, `one pet window per monitor (${overlays.length} for ${monitors})`);
    const main = overlays.find((w) => {
      const b = w.getBounds();
      return Math.abs(b.x - area.x) <= 1 && Math.abs(b.y - area.y) <= 1;
    });
    check(Boolean(main), `a pet window covers the main monitor's work area ${JSON.stringify(area)}`);
    if (main) {
      check(main.isVisible(), 'it is visible');
      const pets = await main.webContents.executeJavaScript("document.querySelectorAll('#pets .pet').length");
      check(pets >= 1, `pets on screen: ${pets}`);
      const shot = await main.webContents.capturePage();
      fs.writeFileSync(path.join(process.cwd(), 'smoke-test.png'), shot.toPNG());
    }

    const scan = createWindowScanner();
    check(Boolean(scan), 'window scanning is available');
    if (scan) {
      const windows = scan(new Set(overlays.map(windowIdOf)));
      const id = windowIdOf(target);
      const found = windows.find((w) => w.id === id);
      const b = target.getBounds();
      check(Boolean(found), `the scan finds the test window (${windows.length} windows found)`);
      if (found) {
        // Windows reports the visible frame, a few pixels inside the window's bounds at the sides.
        const close = Math.abs(found.t - b.y) <= 2 && Math.abs(found.l - b.x) <= 10;
        check(close, `in the right place: scan ${JSON.stringify(found)}, window ${JSON.stringify(b)}`);
      }
      check(toLedges(windows, area).some((l) => l.id === id), 'its top edge is a ledge');
      const own = new Set(overlays.map(windowIdOf));
      check(!windows.some((w) => own.has(w.id)), 'the pet windows themselves are left out');
    }

    check(errors.length === 0, `no errors${errors.length ? `:\n      ${errors.join('\n      ')}` : ''}`);
    console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
    app.exit(failures.length ? 1 : 0);
  });
});
