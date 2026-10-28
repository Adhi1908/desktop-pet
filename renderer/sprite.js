// Sprite sheet loading and drawing. One row per animation, frames left to right.

const REQUIRED = ['idle', 'walk', 'run', 'sit', 'sleep', 'excited', 'dragged', 'fall'];

export async function loadSheet(url) {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error(`Could not load sprite sheet ${url} (run "npm run sprites" for a placeholder)`);
  }
  return img;
}

export function drawFrame(ctx, sheet, sprite, anim, frame) {
  const { frameWidth: fw, frameHeight: fh } = sprite;
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(sheet, ((anim.col ?? 0) + frame) * fw, anim.row * fh, fw, fh, 0, 0, width, height);
}

// Returns the animations that actually fit inside the image. Mismatches between config.json and
// the image are the usual mistake when swapping art, so they're reported (in the terminal when
// running `npm start`). Optional animations (eat, sad, ...) that aren't configured fall back silently.
export function validateSheet(sheet, config) {
  const { sprite } = config;
  const { naturalWidth: sheetW, naturalHeight: sheetH } = sheet;
  const usable = new Set();

  for (const [name, anim] of Object.entries(sprite.animations)) {
    const right = ((anim.col ?? 0) + anim.frames) * sprite.frameWidth;
    const bottom = (anim.row + 1) * sprite.frameHeight;
    if (right <= sheetW && bottom <= sheetH) {
      usable.add(name);
    } else {
      console.warn(
        `sprite: "${name}" (row ${anim.row}, ${anim.frames} frames) needs ${right}x${bottom}px ` +
          `but ${sprite.path} is ${sheetW}x${sheetH}px`,
      );
    }
  }

  const needed = new Set([...REQUIRED, ...(config.tricks ?? []).map((t) => t.animation)]);
  for (const name of needed) {
    if (!sprite.animations[name]) console.warn(`sprite: no "${name}" animation in config.json, using a fallback`);
  }
  return usable;
}
