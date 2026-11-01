# Desktop Pet

Little pets that live on your Windows desktop, on every monitor. They walk along the taskbar and
the tops of your windows, climb window sides and screen edges and play with each other and their
toys. They also react to your typing, nap in their bed, level up, and bring you reminders on
little signs. Electron + plain JS, no framework.

## Download

Get `Desktop-Pet-Setup-<version>.exe` from the
[latest release](https://github.com/Adhi1908/desktop-pet/releases/latest) and run it. It installs
for your user only (no admin rights) and starts right away. Windows 10 or 11, 64-bit.

- **Check your download:** each release lists the installer's SHA-256 checksum in
  `SHA256SUMS.txt`. Compare it with `Get-FileHash .\Desktop-Pet-Setup-<version>.exe` in PowerShell.
- **Check where it was built:** releases are built by GitHub Actions from the tagged source, with
  a signed build-provenance record. With the GitHub CLI:
  `gh attestation verify Desktop-Pet-Setup-<version>.exe --repo Adhi1908/desktop-pet`.
- **Uninstall:** Windows Settings → Apps → Installed apps → Desktop Pet → Uninstall. Your pets are
  kept in `%APPDATA%\Desktop Pet\`; delete that folder too to remove everything.

## Build it yourself

```
npm install
npm start          # generates placeholder art on first run, then launches
npm run build      # -> dist\Desktop-Pet-Setup-<version>.exe
```

## What they do

| You | The pets |
| --- | --- |
| Do nothing special | Wander, sit, run; hop up onto low windows, or climb the side of a tall one and walk along its top; climb a screen edge and walk across the ceiling; visit their furniture (scratch the post, sniff the plant, sit on the cushion) |
| Move or close a window they're on | They ride along when you drag it, and fall off when it's minimized, closed or covered |
| Have more than one monitor | They walk or get thrown across to the next monitor, and you can drag one from monitor to monitor. Settings → "Roam across all my monitors" keeps them on the main one when turned off |
| Type fast / stop typing | Get excited / sit after 2 min, then nap together (in the bed if you have one). Any key wakes them |
| **Rub the cursor back and forth** over a pet | Purrs and leans in (hearts). Rub fast to **tickle** it ("Hehe! Stop it!") |
| Click / double-click / drag a pet | Heart + hop / a trick / pick it up and throw it. Drop it on a window's title bar and it stands there |
| Right-click a pet | Feed, Pet, Play ball, Toys, Add a friend, Say goodbye, Sleep, Settings |
| Tray → **Toys** | **Laser pointer** (a red dot at your cursor that they chase and pounce on), **ball of yarn** (grab it and throw it, and they bat it around), **Drop a treat** at the cursor (they race for it), Put the toys away |
| Lock the PC / come back | They curl up / greet you ("I missed you!") |
| Ctrl+Alt+P / Ctrl+Alt+H | Call every pet to the cursor / hide or show them |
| Can't find a pet | Tray → **Bring \<name\> back** (or Settings → Pets → **Bring back** for one pet): it pops up on the main monitor's taskbar next to the tray, even if the pets were hidden, paused or out of the way for a full-screen app. With more than one monitor, each pet's card says which monitor it's on. A pet that ends up out of sight by itself drops back onto the screen within a few seconds, and pets on a monitor that's unplugged move to the main one |

**Treats, quests and furniture.**
- **Earning:** you start with 10 treats 🍪 and get 2 more each new day. Every day brings 3 quests,
  such as "type 2,000 keys", "take 2 breaks", "play ball" or "finish a focus session", and each
  pays out treats.
- **Spending:** give a treat as a snack (Toys → Drop a treat) or buy furniture in **Shop and
  quests**: a food bowl (fed pets run to it), a cushion, a bed (where they nap), a scratching
  post and a plant.
- **Moving furniture:** drag it anywhere, even onto a window, and it rides along. Right-click it
  to put it away.

**Your own reminders.** Settings → Reminders: once, every day, weekdays, weekends, or chosen days,
at a set time. A pet holds up a sign with your text and a chime. Click **Done** or **Snooze 10
min**. If the pets are hidden, paused or out of the way for a full-screen app, Windows shows a
notification instead. A reminder is still delivered if the app starts up to 2 hours late, and
reminders get through do-not-disturb.

**Smart reactions.**
- **Full screen:** pets hide during full-screen apps, games and presentations, then come back.
- **Night** (23:00–06:00 by default): nightcaps, slower and sleepier pets, and naps after half
  the usual idle time.
- **Low battery** (≤ 20%, unplugged): they get tired and say so. Plugging in perks them up.
- **Do not disturb:** set quiet hours in Settings, or use the tray toggle. It turns off bubbles,
  sounds, toasts and break/water nudges.

**Friends, mood, levels, stats, seasons, Pomodoro and reminders** work as before:
- **Pets:** up to 4, each with its own needs, XP, hats and colors.
- **Stats:** keys, active time, breaks and focus are counted, never what you type, plus 22
  achievements.
- **Other:** the seasonal decorations, a Pomodoro timer in the tray, and break and water nudges.

**Saved data** lives in `%APPDATA%\Desktop Pet\`:
- `pets.json`: the pets.
- `stats.json`: stats and achievements.
- `home.json`: treats, quests and furniture.
- `reminders.json`: your reminders.
- `settings.json`: your changes from the settings window, which override `config.json`.

**Privacy.**
- **Keyboard:** monitoring (`uiohook-napi`) only counts keydowns, never which key.
- **Windows:** window scanning (`koffi`) reads only window positions, never titles or contents.
  The full-screen check asks Windows whether a full-screen app or presentation is running.
- **Paused or hidden:** nothing is counted.
- **Network:** none. The app never connects to the internet.
- **Start with Windows:** only if you turn on "Launch at login" in the tray menu.

## config.json

These are the defaults. The settings window stores its changes separately.

| Key | Meaning |
| --- | --- |
| `scale`, `fps`, `motionFps` | Size; max animation rate (12); tick rate while things move fast (set to 12 for a strict cap) |
| `speed`, `physics`, `hitboxPadding` | Movement and physics tuning |
| `sprite.*` | See "Swapping in a real sprite sheet" |
| `tricks[]`, `behavior` | Tricks; wandering durations and transition weights |
| `typing` | `highRate`, `sitAfterSec`, `sleepAfterSec` |
| `cursorPlay` | Cursor chasing (`enabled`, `chance`, `cooldownSec`, …). The laser pointer uses `pounceDistance` and `maxPounceHeight` too |
| `climbing`, `friends.playChance` | Windows/walls behavior and how often pets play tag |
| `displays.all` | Roam across all monitors (`false`: main monitor only) |
| `smart` | `hideFullscreen`, `night`, `nightStart`, `nightEnd` |
| `dnd` | `enabled`, `start`, `end` (quiet hours) |
| `seasons` | `enabled`, `override` (e.g. `"christmas"` to preview) |
| `hotkeys` | `summon`, `toggleHide` |
| `xp`, `needs`, `speech`, `reminders`, `pomodoro`, `sound` | As in the settings window |

## Swapping in a real sprite sheet

1. **Lay out the sheet.** Use a transparent PNG with every frame the same size. Put one row per
   animation, frames left to right, with the feet on the bottom edge of the frame.
   - **Required rows:** `idle, walk, run, sit, sleep, excited, dragged, fall`, plus one per trick.
   - **Optional rows:** `eat`, `sad`, `chase`, `pounce`, `jump`, `leap`, `climb`, `ceiling`, `petted`,
     `tickled`, `scratch`, `sniff`, `sign` (holding a reminder sign). Each falls back to a
     similar required one if it's missing.
2. **Make frame 0 of the sleep row the full sleeping pose.** Only that one frame is shown while
   all pets sleep.
3. **Replace the image.** Save it over `assets/pet.png`, or set `sprite.path`.
4. **Edit `config.json` → `sprite`:**
   - `frameWidth` / `frameHeight`: one frame's size in pixels.
   - `facing`: `"right"` or `"left"`.
   - `baselineOffset`: the number of empty pixel rows under the feet.
   - For each animation, set `row`, `frames` and `fps` (optional `col`, `loop: false`). Delete
     entries for optional rows you didn't draw.
5. **Place the hats.** Set `sprite.hatAnchor` to the top-centre of the head in frame pixels, plus
   a per-animation `hatAnchor` where the head moves.
6. **Point `tricks[]` at your rows** (`motion: "none"` if the art contains the whole trick).
7. **Tune the size.** Set `scale` and `hitboxPadding`.
8. **Run `npm start`** and watch for `sprite:` warnings.
9. Optional: replace `assets/tray.png`, `assets/tray@2x.png` and `build/icon.png`. Then run
   `npm run build`.

`npm run sprites -- --force` regenerates the placeholder art **and overwrites `assets/pet.png`**.

## Code signing policy

Windows releases are signed through SignPath's program for open-source projects. Free code
signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org). Releases up to 1.0.1 were published before signing
was set up and are unsigned.

- **Committers and reviewers:** [Adhi1908](https://github.com/Adhi1908)
- **Approvers:** [Adhi1908](https://github.com/Adhi1908)
- **How a release is made:** every installer is built by GitHub Actions from the tagged source
  (`.github/workflows/release.yml`), and each signing request is approved by hand in SignPath.
- **Privacy:** this program will not transfer any information to other networked systems unless
  specifically requested by the user or the person installing or operating it.

## License

[MIT](LICENSE) © 2026 Adhi1908
