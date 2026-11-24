// Screen <-> world mapping for the 2D canvases. DOM-free so it can be unit-tested.
// World units are integer nanometres (ADR-0003); screen units are CSS pixels.
// screen = world * scale + offset, with +Y down in both.
import { NM_PER_MM } from '../core/units.js';

export const MIN_SCALE = 0.5 / NM_PER_MM; // 0.5 px per mm: a 2 m wide view on a 1000 px canvas
export const MAX_SCALE = 2000 / NM_PER_MM; // 2000 px per mm: 0.5 um per pixel

export class ViewTransform {
  constructor({ scale = 4 / NM_PER_MM, ox = 0, oy = 0 } = {}) {
    this.scale = scale; // px per nm
    this.ox = ox;
    this.oy = oy;
  }

  toScreen([x, y]) { return [x * this.scale + this.ox, y * this.scale + this.oy]; }
  toWorld([sx, sy]) { return [(sx - this.ox) / this.scale, (sy - this.oy) / this.scale]; }

  /** Move the view by a screen-space delta (panning). */
  pan(dx, dy) { this.ox += dx; this.oy += dy; }

  /** Zoom by `factor` keeping the world point under screen point (sx, sy) fixed. */
  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld([sx, sy]);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    this.ox = sx - wx * this.scale;
    this.oy = sy - wy * this.scale;
  }

  /** Fit a world rectangle into a screen of width x height with a margin in px. */
  fit({ x0, y0, x1, y1 }, width, height, margin = 40) {
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const s = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    this.ox = width / 2 - ((x0 + x1) / 2) * this.scale;
    this.oy = height / 2 - ((y0 + y1) / 2) * this.scale;
  }

  toJSON() { return { scale: this.scale, ox: this.ox, oy: this.oy }; }
}

/**
 * The grid spacing to draw: the snap grid, multiplied by 2, 5 or 10 (repeatedly) until
 * the lines are at least `minPx` apart on screen. Returns { minor, major } in nm.
 */
export function gridSpacing(baseGrid, scale, minPx = 8) {
  const mults = [1, 2, 5];
  let decade = 1;
  for (let i = 0; i < 40; i++) {
    for (const m of mults) {
      const step = baseGrid * m * decade;
      if (step * scale >= minPx) return { minor: step, major: step * (m === 2 ? 5 : m === 5 ? 2 : 10) };
    }
    decade *= 10;
  }
  return { minor: baseGrid * decade, major: baseGrid * decade * 10 };
}

/** A "nice" ruler label step in nm (1, 2 or 5 x 10^n mm) giving labels at least `minPx` apart. */
export function rulerStep(scale, minPx = 56) {
  const minWorld = minPx / scale;
  let p = 10 ** Math.floor(Math.log10(minWorld / NM_PER_MM));
  for (let i = 0; i < 40; i++) {
    for (const m of [1, 2, 5]) {
      const step = m * p * NM_PER_MM;
      if (step >= minWorld) return step;
    }
    p *= 10;
  }
  return p * NM_PER_MM;
}

/** Format a world length in nm as a ruler label in mm, without float noise ("0.1", "12.5", "100"). */
export const rulerLabel = (nm) => String(+(nm / NM_PER_MM).toFixed(4));
