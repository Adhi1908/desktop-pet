// Shared by everything that falls and stands on things: pets, furniture and treats.
// Platforms are window ledges { id, x1, x2, y, left } in overlay coordinates.

// The highest ledge an object's bottom edge crossed on the way down this step, `null` for the
// taskbar (`floor`), or `undefined` while it's still in the air. Ledges without `height` px of
// room above them are skipped.
export function findLanding(platforms, floor, cx, prevBottom, bottom, height) {
  let best;
  for (const p of platforms) {
    if (cx < p.x1 || cx > p.x2 || p.y < prevBottom - 1 || p.y > bottom || p.y - height < 0) continue;
    if (!best || p.y < best.y) best = p;
  }
  if (best) return best;
  return bottom >= floor ? null : undefined;
}

// Carries a standing object (with x, y, w, surface) along when its window moves. Returns true if
// the ledge is gone (window closed, minimized, moved away or covered).
export function rideSurface(body, platforms) {
  const old = body.surface;
  if (!old) return false;
  const cx = body.x + body.w / 2;
  for (const p of platforms) {
    if (p.id !== old.id) continue;
    const dx = p.left - old.left;
    if (cx + dx < p.x1 || cx + dx > p.x2) continue;
    body.x += dx;
    body.y += p.y - old.y;
    body.surface = p;
    return false;
  }
  body.surface = null;
  return true;
}

export const surfaceKey = (surface) => (surface ? `${surface.id}:${surface.x1}` : 'floor');
