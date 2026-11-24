// The 2D canvas shared by the Schematic, Board, Gerber and Library workspaces:
// pan (middle or right drag), zoom about the cursor (wheel), grid, rulers and a
// coordinate pill. Drawing follows DabbleCAD's Laser workspace (rulers, colours).
// World coordinates are integer nm, +Y down (ADR-0003). Each workspace owns one
// Canvas2D, so pan/zoom is kept per workspace.
import { h } from '../ui/dom.js';
import { ViewTransform, gridSpacing, rulerStep, rulerLabel } from './transform.js';
import { toMm } from '../core/units.js';

export const RULER = 22;

// Ruler colours are app chrome, so they follow the UI theme (as in the Laser workspace).
// Everything inside the canvas comes from the workspace's Colour theme (core/themes.js, #51).
const CHROME = {
  dark: { ruler: '#1e2128', text: '#9aa5b6', line: '#2f3542' },
  light: { ruler: '#f3f6fa', text: '#445063', line: '#d3dbe6' },
};
export const chromeColors = () => CHROME[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];

export class Canvas2D {
  /**
   * @param {object} opts
   * @param {number} opts.grid     snap grid in nm
   * @param {{x0,y0,x1,y1}} [opts.frame]  optional paper/sheet rectangle in nm (drawn like the laser bed)
   * @param {(ctx, view, colors) => void} [opts.draw]  draws the workspace content in screen space
   */
  constructor({ grid, frame = null, draw = null, home = null, colors }) {
    this.getColors = colors; // () => resolved Colour theme tokens
    this.grid = grid;
    this.frame = frame;
    this.drawContent = draw;
    this.home = home || frame || { x0: -50e6, y0: -40e6, x1: 50e6, y1: 40e6 };
    this.view = new ViewTransform();
    this.cursor = null; // last world position under the pointer
    this.w = 0; this.h = 0; this.dpr = 1;
    this.fitted = false;

    this.canvas = h('canvas', { class: 'ws-canvas', tabindex: '0' });
    this.coords = h('div', { class: 'coord-pill' });
    this.el = h('div', { class: 'canvas-wrap' }, this.canvas, this.coords);
    this.ctx = this.canvas.getContext('2d');
    this._wire();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
  }

  _wire() {
    const c = this.canvas;
    let pan = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus({ preventScroll: true });
      if (e.button === 1 || e.button === 2) {
        pan = { x: e.clientX, y: e.clientY, id: e.pointerId, button: e.button, moved: 0 };
        c.setPointerCapture(e.pointerId);
        c.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (pan && e.pointerId === pan.id) {
        pan.moved += Math.abs(e.clientX - pan.x) + Math.abs(e.clientY - pan.y);
        this.view.pan(e.clientX - pan.x, e.clientY - pan.y);
        pan.x = e.clientX; pan.y = e.clientY;
      }
      this.setCursor(this.local(e));
    });
    const end = (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      // a right-click that didn't pan opens the workspace's context menu (as in DabbleCAD)
      const menu = e.type === 'pointerup' && pan.button === 2 && pan.moved < 5 && this.onContextMenu;
      pan = null; c.style.cursor = '';
      if (menu) this.onContextMenu(e);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.cursor = null; this.coords.textContent = ''; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = this.local(e);
      // trackpads send small deltas; mice send ~100 per notch
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this.view.zoomAt(sx, sy, factor);
      this.setCursor([sx, sy]);
    }, { passive: false });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Home') { this.fitHome(); e.preventDefault(); }
    });
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Update the coordinate pill for a screen point (also used by smoke tests). */
  setCursor([sx, sy]) {
    this.cursor = this.view.toWorld([sx, sy]);
    const [x, y] = this.cursor;
    this.coords.textContent = `X ${toMm(x).toFixed(2)}   Y ${toMm(y).toFixed(2)} mm`;
    this.invalidate();
  }

  fitHome() {
    if (!this.w) return;
    this.view.fit(this.home, this.w - RULER, this.h - RULER, 30);
    this.view.pan(RULER, RULER);
    this.invalidate();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return; // hidden workspace; keep its view as it was
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (!this.fitted) { this.fitted = true; this.fitHome(); }
    this.draw();
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }


  draw() {
    const ctx = this.ctx, v = this.view, C = this.getColors();
    if (!this.w) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.background;
    ctx.fillRect(0, 0, this.w, this.h);

    if (this.frame) {
      const [x0, y0] = v.toScreen([this.frame.x0, this.frame.y0]);
      const [x1, y1] = v.toScreen([this.frame.x1, this.frame.y1]);
      ctx.fillStyle = C.paper;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    this._drawGrid(ctx, C);
    if (this.frame) {
      const [x0, y0] = v.toScreen([this.frame.x0, this.frame.y0]);
      const [x1, y1] = v.toScreen([this.frame.x1, this.frame.y1]);
      ctx.strokeStyle = C.sheetEdge; ctx.lineWidth = 1.2;
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, x1 - x0, y1 - y0);
    } else {
      // origin cross
      const [ox, oy] = v.toScreen([0, 0]);
      ctx.strokeStyle = C.origin; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox - 8, oy + 0.5); ctx.lineTo(ox + 8, oy + 0.5); ctx.moveTo(ox + 0.5, oy - 8); ctx.lineTo(ox + 0.5, oy + 8); ctx.stroke();
    }
    if (this.drawContent) this.drawContent(ctx, v, C);
    this._drawRulers(ctx, C, chromeColors());
  }

  _drawGrid(ctx, C) {
    const v = this.view;
    const { minor, major } = gridSpacing(this.grid, v.scale, 7);
    const [wx0, wy0] = v.toWorld([RULER, RULER]);
    const [wx1, wy1] = v.toWorld([this.w, this.h]);
    let x0 = wx0, y0 = wy0, x1 = wx1, y1 = wy1;
    if (this.frame) { // only inside the sheet, like the laser bed
      x0 = Math.max(x0, this.frame.x0); y0 = Math.max(y0, this.frame.y0);
      x1 = Math.min(x1, this.frame.x1); y1 = Math.min(y1, this.frame.y1);
      if (x1 <= x0 || y1 <= y0) return;
    }
    const [sx0, sy0] = v.toScreen([x0, y0]), [sx1, sy1] = v.toScreen([x1, y1]);
    ctx.lineWidth = 1;
    const isMajor = (val) => Math.abs(Math.round(val / major) * major - val) < minor / 2;
    for (let pass = 0; pass < 2; pass++) { // minor lines first, major on top
      ctx.strokeStyle = pass ? C.gridMajor : C.gridMinor;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) {
        if (isMajor(x) !== !!pass) continue;
        const sx = Math.round(v.toScreen([x, 0])[0]) + 0.5;
        ctx.moveTo(sx, sy0); ctx.lineTo(sx, sy1);
      }
      for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) {
        if (isMajor(y) !== !!pass) continue;
        const sy = Math.round(v.toScreen([0, y])[1]) + 0.5;
        ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy);
      }
      ctx.stroke();
    }
  }

  _drawRulers(ctx, C, K) {
    const v = this.view;
    ctx.fillStyle = K.ruler;
    ctx.fillRect(0, 0, this.w, RULER); ctx.fillRect(0, 0, RULER, this.h);
    ctx.strokeStyle = K.line; ctx.fillStyle = K.text; ctx.font = '10px "Segoe UI", system-ui, sans-serif'; ctx.lineWidth = 1;
    const step = rulerStep(v.scale);
    const [wx0, wy0] = v.toWorld([RULER, RULER]);
    const [wx1, wy1] = v.toWorld([this.w, this.h]);
    ctx.beginPath();
    for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) {
      const sx = Math.round(v.toScreen([x, 0])[0]) + 0.5;
      ctx.moveTo(sx, RULER - 7); ctx.lineTo(sx, RULER);
      ctx.fillText(rulerLabel(x), sx + 2, 10);
    }
    for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) {
      const sy = Math.round(v.toScreen([0, y])[1]) + 0.5;
      ctx.moveTo(RULER - 7, sy); ctx.lineTo(RULER, sy);
      ctx.save(); ctx.translate(10, sy - 2); ctx.rotate(-Math.PI / 2); ctx.fillText(rulerLabel(y), 0, 0); ctx.restore();
    }
    ctx.stroke();
    // cursor marks on the rulers
    if (this.cursor) {
      const [cx, cy] = v.toScreen(this.cursor);
      ctx.strokeStyle = C.selection; ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, 0); ctx.lineTo(Math.round(cx) + 0.5, RULER);
      ctx.moveTo(0, Math.round(cy) + 0.5); ctx.lineTo(RULER, Math.round(cy) + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = K.ruler; ctx.fillRect(0, 0, RULER, RULER);
    ctx.strokeStyle = K.line;
    ctx.beginPath(); ctx.moveTo(0, RULER + 0.5); ctx.lineTo(this.w, RULER + 0.5); ctx.moveTo(RULER + 0.5, 0); ctx.lineTo(RULER + 0.5, this.h); ctx.stroke();
  }
}
