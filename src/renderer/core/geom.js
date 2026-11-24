// Point and transform helpers. Points are [x, y] integer nm, +Y down.

export const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const key = (p) => p[0] + ',' + p[1];

/**
 * Rotate a point about the origin by a multiple of 90° (counter-clockwise on screen,
 * which with +Y down means (x, y) -> (y, -x)), mirroring in X first if asked.
 */
export function rot90(p, rot = 0, mirror = false) {
  let [x, y] = p;
  if (mirror) x = -x;
  switch (((rot % 360) + 360) % 360) {
    case 90: return [y, -x];
    case 180: return [-x, -y];
    case 270: return [-y, x];
    default: return [x, y];
  }
}

/** Local -> world for a placed symbol. */
export const place = (p, at, rot, mirror) => add(rot90(p, rot, mirror), at);

/** World -> local for a placed symbol (the inverse of place). */
export function unplace(p, at, rot = 0, mirror = false) {
  const [x, y] = rot90(sub(p, at), (360 - (((rot % 360) + 360) % 360)) % 360);
  return [mirror ? -x : x, y];
}

/** True when p lies on segment a-b (inclusive). Exact for integer, axis-aligned or diagonal segments. */
export function onSegment(p, a, b) {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (cross !== 0) return false;
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
      && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

/** Squared distance from p to segment a-b (floats; for hit testing only). */
export function distToSegment2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}
