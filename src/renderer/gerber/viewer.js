// The Gerber tab's canvas (#28): draws fab files by parsing them back, not by drawing the Board,
// so what's on screen is what the board house gets. One Path2D per layer (and polarity run), in
// board nm; Top / Bottom view (Bottom mirrors about the board's centre and draws the bottom layers
// on top); Measure; and a comparison's differences as an overlay.
import { layerOrder, unionBox } from '../core/gerber/compare.js';

const TAU = Math.PI * 2;
const area2 = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a; };

/**
 * A layer's shapes as Path2D runs: [{ dark, path }]. Each shape's first ring is turned one way and
 * its other rings (holes) the other, so filling a run non-zero gives the union with holes kept.
 */
export function layerPaths(shapes) {
  const runs = [];
  let cur = null;
  for (const s of shapes) {
    if (!cur || cur.dark !== s.dark) { cur = { dark: s.dark, path: new Path2D() }; runs.push(cur); }
    s.rings.forEach((r, i) => {
      if (r.length < 3) return;
      const want = i === 0 ? 1 : -1, pts = Math.sign(area2(r)) === want ? r : [...r].reverse();
      cur.path.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) cur.path.lineTo(pts[k][0], pts[k][1]);
      cur.path.closePath();
    });
  }
  return runs;
}

/** Colours for fab layers, from the board's Colour theme. */
export function fabColor(C, layer) {
  if (layer === 'PTH' || layer === 'NPTH' || layer === 'Drill' || layer === 'drills') return C.drill || '#0b0c0f';
  return C[layer] || (/Cu$/.test(layer) ? C['F.Cu'] : '#9aa0a6');
}

export class GerberViewer {
  constructor() {
    this.layers = [];          // [{ name, layer, label, kind, shapes, box, runs }]
    this.hidden = new Set();   // layer file names hidden
    this.side = 'top';
    this.measure = null;       // { a, b, done }
    this.tool = 'select';
    this.diff = null;          // { image (canvas), frame, layer } shown over everything
  }

  /** Show these layers (from readFabFiles), building their paths. */
  setLayers(layers) {
    this.layers = layers.map((l) => ({ ...l, runs: layerPaths(l.shapes) }));
    this.box = unionBox(this.layers);
    for (const n of [...this.hidden]) if (!this.layers.some((l) => l.name === n)) this.hidden.delete(n);
  }

  /** Board-space x as drawn: mirrored about the board's centre when viewed from the bottom. */
  mirrorX(x) { return this.side === 'bottom' && this.box ? this.box.x0 + this.box.x1 - x : x; }

  /** A screen point -> board point, through the mirror. */
  toBoard(view, p) { const w = view.toWorld(p); return [this.mirrorX(w[0]), w[1]]; }

  draw(ctx, view, C) {
    if (!this.layers.length) return;
    ctx.save();
    // board nm -> screen, mirrored in X about the board centre for Bottom
    const m = this.side === 'bottom' && this.box ? -1 : 1, cx = this.box ? this.box.x0 + this.box.x1 : 0;
    const s = view.scale;
    const [ox, oy] = view.toScreen([0, 0]);
    ctx.transform(m * s, 0, 0, s, m === -1 ? ox + s * cx : ox, oy);
    // stack order: from the far side up to the near side, drills last (holes through everything)
    const order = [...this.layers].sort((a, b) => {
      const da = a.kind === 'drill' ? 1 : 0, db = b.kind === 'drill' ? 1 : 0;
      if (da !== db) return da - db;
      return this.side === 'top' ? layerOrder(b.layer) - layerOrder(a.layer) : layerOrder(a.layer) - layerOrder(b.layer);
    });
    for (const l of order) {
      if (this.hidden.has(l.name)) continue;
      const col = fabColor(C, l.layer);
      ctx.globalAlpha = l.kind === 'drill' ? 1 : /Mask$/.test(l.layer) ? 0.5 : /Paste$/.test(l.layer) ? 0.55 : /Cu$/.test(l.layer) ? 0.78 : 0.95;
      for (const r of l.runs) {
        // clear polarity: fill with the background (exact for one layer on its own)
        ctx.fillStyle = r.dark ? col : C.background;
        ctx.fill(r.path, 'nonzero');
      }
    }
    ctx.globalAlpha = 1;
    if (this.diff) ctx.drawImage(this.diff.image, this.diff.frame.x0, this.diff.frame.y0, this.diff.frame.w * this.diff.frame.res, this.diff.frame.h * this.diff.frame.res);
    ctx.restore();
    // Measure, in screen space (its points are board points)
    if (this.measure) {
      const sp = (p) => view.toScreen([this.mirrorX(p[0]), p[1]]);
      const [x0, y0] = sp(this.measure.a), [x1, y1] = sp(this.measure.b);
      ctx.save();
      ctx.strokeStyle = C.selection; ctx.fillStyle = C.selection; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      for (const [x, y] of [[x0, y0], [x1, y1]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill(); }
      const dx = (this.measure.b[0] - this.measure.a[0]) / 1e6, dy = (this.measure.b[1] - this.measure.a[1]) / 1e6;
      const text = `${Math.hypot(dx, dy).toFixed(3)} mm  ·  dx ${dx.toFixed(3)}  dy ${(-dy).toFixed(3)}`;
      ctx.font = '12px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 12, tx = (x0 + x1) / 2 - w / 2, ty = (y0 + y1) / 2 - 28;
      ctx.globalAlpha = 0.9; ctx.fillStyle = C.background; ctx.fillRect(tx, ty, w, 20); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.selection; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, ty + 0.5, w, 20);
      ctx.fillStyle = C.selection; ctx.textBaseline = 'middle'; ctx.fillText(text, tx + 6, ty + 10);
      ctx.restore();
    }
    // which side
    ctx.save();
    ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = C.textMuted || '#8b93a1'; ctx.textAlign = 'right';
    ctx.fillText(this.side === 'bottom' ? 'VIEWED FROM THE BOTTOM (MIRRORED)' : 'VIEWED FROM THE TOP', ctx.canvas.width / (window.devicePixelRatio || 1) - 14, 44);
    ctx.restore();
  }

  /** A comparison's difference bitmap as an image: only ours red, only theirs blue, shared faint. */
  setDiff(entry, frame) {
    if (!entry?.diff) { this.diff = null; return; }
    const c = document.createElement('canvas');
    c.width = frame.w; c.height = frame.h;
    const g = c.getContext('2d'), img = g.createImageData(frame.w, frame.h), d = img.data;
    const COL = [null, [150, 150, 160, 70], [235, 64, 64, 255], [64, 150, 255, 255]];
    for (let i = 0; i < entry.diff.length; i++) {
      const k = COL[entry.diff[i]];
      if (!k) continue;
      d[i * 4] = k[0]; d[i * 4 + 1] = k[1]; d[i * 4 + 2] = k[2]; d[i * 4 + 3] = k[3];
    }
    g.putImageData(img, 0, 0);
    this.diff = { image: c, frame, layer: entry.layer };
  }
}
