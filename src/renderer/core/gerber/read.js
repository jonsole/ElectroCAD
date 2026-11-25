// Gerber RS-274X reader (#28): turns a Gerber file back into what it draws, so the Gerber tab shows
// exactly what the board house receives, and generated files can be compared with others. DOM-free.
//
//   readGerber(text) -> { units, objects, apertures, attrs, warnings, box }
//
// objects (nm, board orientation: +Y down, as ElectroCAD keeps everything; ADR-0003):
//   { kind: 'flash',  ap, at, dark }
//   { kind: 'stroke', ap, a, b, dark }                   a straight draw with aperture ap
//   { kind: 'arc',    ap, a, b, c, cw, dark }             a circular draw: centre c, clockwise on paper
//   { kind: 'region', pts, dark }                       one closed contour (G36/G37), arcs flattened
// ap: { code, type: 'C'|'R'|'O'|'P'|'M', params (nm or plain numbers), prims? (a macro's
//   primitives, evaluated) }. dark: the Load polarity (LPD / LPC) at the time.
//
// Covered: FS (leading / trailing zero omission, absolute), MO / G70 / G71, AD (C, R, O, P, holes,
// macros), AM (primitives 0, 1, 4, 5, 6, 7, 20, 21 with $ variables and arithmetic), LP, D01-D03,
// G01-G03, G74 / G75, G36 / G37, G54 legacy aperture selection, SR step and repeat, OF offsets,
// G04 comments, X2 attributes (TF / TA / TO / TD, kept from TF). Incremental coordinates and image
// transforms (LM / LR / LS / MI / IP NEG) are rare: they're noted in warnings.

const SCALE = { mm: 1e6, in: 25.4e6 };

/** Evaluate a macro expression: numbers, $n variables, + - x X / and parentheses. */
function evalExpr(src, vars) {
  const s = String(src).replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    if (peek() === '$') { i++; let d = ''; while (/\d/.test(peek() || '')) d += s[i++]; return vars[+d] ?? 0; }
    if (peek() === '(') { i++; const v = add(); if (peek() === ')') i++; return v; }
    if (peek() === '-') { i++; return -num(); }
    if (peek() === '+') { i++; return num(); }
    let d = '';
    while (/[\d.]/.test(peek() || '')) d += s[i++];
    return d ? Number(d) : 0;
  };
  const mul = () => { let v = num(); for (;;) { const c = peek(); if (c === 'x' || c === 'X') { i++; v *= num(); } else if (c === '/') { i++; const d = num(); v = d ? v / d : 0; } else return v; } };
  const add = () => { let v = mul(); for (;;) { const c = peek(); if (c === '+') { i++; v += mul(); } else if (c === '-') { i++; v -= mul(); } else return v; } };
  return add();
}

/** Split a Gerber file into its statements: [{ ext: true, text }] for %…% blocks, else words. */
function statements(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '%') {
      const e = text.indexOf('%', i + 1);
      const body = text.slice(i + 1, e < 0 ? n : e);
      // an extended block may hold several *-terminated commands (AM holds its primitives)
      out.push({ ext: true, text: body.replace(/[\r\n]/g, '') });
      i = e < 0 ? n : e + 1;
    } else if (c === '\r' || c === '\n' || c === ' ' || c === '\t') i++;
    else {
      const e = text.indexOf('*', i);
      const w = text.slice(i, e < 0 ? n : e).replace(/[\r\n\s]/g, '');
      if (w) out.push({ ext: false, text: w });
      i = e < 0 ? n : e + 1;
    }
  }
  return out;
}

/**
 * Read a Gerber file. Never throws on content it doesn't know: what it skips is in `warnings`.
 */
export function readGerber(text) {
  const warnings = new Set();
  const attrs = {};
  const apertures = new Map(), macros = new Map();
  const objects = [];
  let units = null, fmt = { int: 2, dec: 4, omit: 'L', abs: true }, fmtSeen = false;
  let dark = true, interp = 'G01', quadrant = 'multi', region = null, cur = null;
  let pos = [0, 0], ofs = [0, 0];
  let sr = null; // step and repeat: { x, y, i, j, start }
  let lastD = 'D02';

  const toNm = (v) => Math.round(v * SCALE[units || 'in']);
  const coord = (s) => {
    if (s.includes('.')) return toNm(Number(s));
    let sign = 1;
    if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1; s = s.slice(1); }
    const total = fmt.int + fmt.dec;
    // leading zeros omitted: the digits are right-aligned; trailing omitted: left-aligned
    const digits = fmt.omit === 'T' ? s.padEnd(total, '0') : s.padStart(total, '0');
    return sign * toNm(Number(digits) / 10 ** fmt.dec);
  };
  const P = (x, y) => [x + ofs[0], y + ofs[1]];

  const arcCentre = (a, b, i, j, cw) => {
    if (quadrant === 'multi') return [a[0] + i, a[1] + j];
    // single quadrant: I and J are unsigned; the centre is the candidate with matching radii and a sweep of at most 90°
    let best = null;
    for (const [si, sj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = [a[0] + si * i, a[1] + sj * j];
      const ra = Math.hypot(a[0] - c[0], a[1] - c[1]), rb = Math.hypot(b[0] - c[0], b[1] - c[1]);
      const sweep = sweepOf(a, b, c, cw);
      const err = Math.abs(ra - rb) + (sweep > Math.PI / 2 + 1e-6 ? 1e12 : 0);
      if (!best || err < best.err) best = { c, err };
    }
    return best.c;
  };

  const emit = (o) => objects.push(o);

  const draw = (w) => {
    // a coordinate word: [G01|G02|G03] [X] [Y] [I] [J] [D01|D02|D03]
    const g = /^G0?([123])/.exec(w);
    if (g) { interp = `G0${g[1]}`; w = w.replace(/^G0?[123]/, ''); }
    const get = (k) => { const m = new RegExp(`${k}([+-]?[\\d.]+)`).exec(w); return m ? m[1] : null; };
    const xs = get('X'), ys = get('Y'), is = get('I'), js = get('J');
    const dm = /D0?([123])$/.exec(w);
    const d = dm ? `D0${dm[1]}` : lastD === 'D03' ? 'D03' : (xs !== null || ys !== null ? 'D01' : null);
    if (!d) return;
    if (dm) lastD = d;
    if (!fmt.abs) warnings.add('Incremental coordinates were read as absolute');
    const target = P(xs !== null ? coord(xs) : pos[0] - ofs[0], ys !== null ? coord(ys) : pos[1] - ofs[1]);
    if (d === 'D02') {
      if (region && region.cur.length > 1) region.list.push(region.cur);
      if (region) region.cur = [target];
      pos = target;
      return;
    }
    if (d === 'D03') {
      if (region) { warnings.add('A flash inside a region was ignored'); pos = target; return; }
      if (!cur) { warnings.add('A flash before any aperture was chosen was ignored'); pos = target; return; }
      emit({ kind: 'flash', ap: cur, at: target, dark });
      pos = target;
      return;
    }
    // D01
    if (interp === 'G01') {
      if (region) region.cur.push(target);
      else if (cur) emit({ kind: 'stroke', ap: cur, a: pos, b: target, dark });
      else warnings.add('A draw before any aperture was chosen was ignored');
    } else {
      const cw = interp === 'G02';
      const c = arcCentre(pos, target, is !== null ? coord(is) : 0, js !== null ? coord(js) : 0, cw);
      if (region) region.cur.push(...arcPoints(pos, target, c, cw).slice(1));
      else if (cur) emit({ kind: 'arc', ap: cur, a: pos, b: target, c, cw, dark });
    }
    pos = target;
  };

  const defineAperture = (body) => {
    const m = /^ADD(\d+)([A-Za-z_$.][\w.$-]*)(?:,(.*))?$/.exec(body);
    if (!m) { warnings.add(`An aperture definition wasn't understood (${body.slice(0, 30)})`); return; }
    const code = +m[1], name = m[2], raw = (m[3] || '').split('X').filter((v) => v !== '').map(Number);
    let ap;
    if (name === 'C') ap = { type: 'C', d: toNm(raw[0] || 0), hole: raw[1] ? toNm(raw[1]) : 0 };
    else if (name === 'R' || name === 'O') ap = { type: name, w: toNm(raw[0] || 0), h: toNm(raw[1] || 0), hole: raw[2] ? toNm(raw[2]) : 0 };
    else if (name === 'P') ap = { type: 'P', d: toNm(raw[0] || 0), n: Math.max(3, Math.round(raw[1] || 3)), rot: raw[2] || 0, hole: raw[3] ? toNm(raw[3]) : 0 };
    else if (macros.has(name)) ap = { type: 'M', name, prims: evalMacro(macros.get(name), raw, toNm, warnings) };
    else { warnings.add(`Aperture ${name} isn't defined`); ap = { type: 'C', d: 0, hole: 0 }; }
    ap.code = code;
    apertures.set(code, ap);
  };

  for (const st of statements(text)) {
    if (st.ext) {
      const body = st.text;
      const cmd = body.slice(0, 2);
      if (cmd === 'FS') {
        const m = /^FS([LTD]?)([AI])X(\d)(\d)Y(\d)(\d)/.exec(body);
        if (m) { fmt = { int: +m[3], dec: +m[4], omit: m[1] === 'T' ? 'T' : 'L', abs: m[2] === 'A' }; fmtSeen = true; }
        else warnings.add('The format statement wasn\'t understood');
      } else if (cmd === 'MO') units = body.startsWith('MOMM') ? 'mm' : 'in';
      else if (cmd === 'AD') { for (const part of body.split('*').filter(Boolean)) defineAperture(part); }
      else if (cmd === 'AM') {
        const parts = body.split('*');
        macros.set(parts[0].slice(2), parts.slice(1).filter((p) => p.trim()));
      } else if (cmd === 'LP') dark = !body.startsWith('LPC');
      else if (cmd === 'OF') {
        const a = /A([+-]?[\d.]+)/.exec(body), b = /B([+-]?[\d.]+)/.exec(body);
        ofs = [a ? toNm(+a[1]) : 0, b ? toNm(+b[1]) : 0];
      } else if (cmd === 'SR') {
        if (sr) repeat(objects, sr, warnings);
        const g = (k, d) => { const m = new RegExp(`${k}([+-]?[\\d.]+)`).exec(body); return m ? +m[1] : d; };
        const x = g('X', 1), y = g('Y', 1);
        sr = x > 1 || y > 1 ? { x, y, i: toNm(g('I', 0)), j: toNm(g('J', 0)), start: objects.length } : null;
      } else if (cmd === 'TF') {
        const [k, ...v] = body.slice(2).replace(/\*$/, '').split(',');
        attrs[k.replace(/^\./, '')] = v.join(',');
      } else if (cmd === 'TA' || cmd === 'TO' || cmd === 'TD') { /* object attributes: not needed to draw */ }
      else if (cmd === 'IP') { if (body.startsWith('IPNEG')) warnings.add('Negative image polarity (IPNEG) isn\'t applied'); }
      else if (cmd === 'IN' || cmd === 'LN' || cmd === 'IJ' || cmd === 'IO' || cmd === 'AS' || cmd === 'SF' || cmd === 'MI' || cmd === 'IR' || cmd === 'KO' || cmd === 'RO' || cmd === 'PF') {
        if (/^(MI|SF|IR|AS)/.test(body) && !/^(MIA0B0|SFA1B1|IR0|ASAXBY)/.test(body)) warnings.add(`The ${cmd} image transform isn't applied`);
      } else if (cmd === 'LM' || cmd === 'LR' || cmd === 'LS') {
        if (!/^(LMN|LR0|LS1)\b/.test(body)) warnings.add(`The ${cmd} aperture transform isn't applied`);
      } else if (cmd === 'AB') warnings.add('Block apertures (AB) aren\'t drawn');
      continue;
    }
    let w = st.text;
    if (w.startsWith('G04') || w.startsWith('G4 ')) continue;
    if (w === 'M02' || w === 'M00' || w === 'M01' || w === 'M2') break;
    // a word may chain codes: G54D10, G70, G90, G75, G36…
    for (;;) {
      const m = /^G(\d+)/.exec(w);
      if (!m) break;
      const g = +m[1];
      if (g <= 3 && /[XYIJD]/.test(w.slice(m[0].length))) break; // G01X…: the draw handles it
      w = w.slice(m[0].length);
      if (g === 1 || g === 2 || g === 3) interp = `G0${g}`;
      else if (g === 74) quadrant = 'single';
      else if (g === 75) quadrant = 'multi';
      else if (g === 36) region = { list: [], cur: [pos] };
      else if (g === 37) {
        if (region) {
          if (region.cur.length > 1) region.list.push(region.cur);
          for (const pts of region.list) if (pts.length > 2) emit({ kind: 'region', pts, dark });
        }
        region = null;
      } else if (g === 70) units = 'in';
      else if (g === 71) units = 'mm';
      else if (g === 90) fmt.abs = true;
      else if (g === 91) fmt.abs = false;
      else if (g === 54 || g === 55) { /* select / prepare: the D code follows */ }
    }
    if (!w) continue;
    const dsel = /^D(\d+)$/.exec(w);
    if (dsel && +dsel[1] >= 10) { cur = apertures.get(+dsel[1]) || null; if (!cur) warnings.add(`Aperture D${dsel[1]} is used but not defined`); continue; }
    if (/^[XYIJD]/.test(w) || /^G0?[123]/.test(w)) { draw(w); continue; }
    if (/^M\d+$/.test(w)) continue;
    warnings.add(`Unknown statement ${w.slice(0, 12)}`);
  }
  if (sr) repeat(objects, sr, warnings);
  if (!units) warnings.add('No units given: read as inches');
  if (!fmtSeen) warnings.add('No format statement: read as 2.4, leading zeros omitted');

  // to board orientation (+Y down)
  const flip = (p) => [p[0], -p[1] || 0];
  for (const o of objects) {
    if (o.at) o.at = flip(o.at);
    if (o.a) { o.a = flip(o.a); o.b = flip(o.b); }
    if (o.c) { o.c = flip(o.c); }
    if (o.pts) o.pts = o.pts.map(flip);
  }
  for (const ap of apertures.values()) if (ap.prims) for (const p of ap.prims) p.rings = p.rings.map((r) => r.map(flip));
  return { units: units || 'in', objects, apertures, attrs, warnings: [...warnings], box: objectsBox(objects) };
}

/** Step and repeat: copy what the block drew, x by y times. */
function repeat(objects, sr, warnings) {
  const block = objects.slice(sr.start);
  for (let ix = 0; ix < sr.x; ix++) for (let iy = 0; iy < sr.y; iy++) {
    if (!ix && !iy) continue;
    const dx = ix * sr.i, dy = iy * sr.j, mv = (p) => [p[0] + dx, p[1] + dy];
    for (const o of block) objects.push({ ...o, ...(o.at ? { at: mv(o.at) } : {}), ...(o.a ? { a: mv(o.a), b: mv(o.b) } : {}), ...(o.c ? { c: mv(o.c) } : {}), ...(o.pts ? { pts: o.pts.map(mv) } : {}) });
  }
  if (objects.length > 2_000_000) warnings.add('Step and repeat made a very large image');
}

/** The sweep (radians, 0..2π] from a to b about c, clockwise or not (in Gerber's Y-up frame). */
function sweepOf(a, b, c, cw) {
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  let s = cw ? a0 - a1 : a1 - a0;
  while (s <= 0) s += 2 * Math.PI;
  if (Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1) s = 2 * Math.PI; // a full circle
  return s;
}

/** Points along an arc from a to b about c (in whatever frame they're given), every ~5°. */
export function arcPoints(a, b, c, cw, stepDeg = 5) {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const s = sweepOf(a, b, c, cw), a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const n = Math.max(2, Math.ceil((s * 180) / Math.PI / stepDeg));
  const out = [];
  for (let k = 0; k <= n; k++) {
    if (k === n) { out.push(b); break; }
    const t = a0 + (cw ? -1 : 1) * (s * k) / n;
    out.push([Math.round(c[0] + r * Math.cos(t)), Math.round(c[1] + r * Math.sin(t))]);
  }
  return out;
}

// ---------------------------------------------------------------- aperture macros

const rotPt = ([x, y], deg) => { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return [x * c - y * s, x * s + y * c]; };
const circle = (cx, cy, r, n = 0) => { const k = n || Math.max(12, Math.min(64, Math.ceil(r / 20_000))); return Array.from({ length: k }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / k), cy + r * Math.sin((2 * Math.PI * i) / k)]); };

/**
 * A macro's primitives, with the aperture's parameters: [{ on, rings }] in nm, Gerber frame (Y up)
 * about the flash point. `rings`: an outline and its holes (even-odd).
 */
function evalMacro(body, params, toNm, warnings) {
  const vars = []; params.forEach((v, i) => { vars[i + 1] = v; });
  const prims = [];
  const R = (pts, rot) => pts.map((p) => rotPt(p, rot)).map(([x, y]) => [Math.round(x), Math.round(y)]);
  for (const stmt of body) {
    const s = stmt.trim();
    if (!s || s[0] === '0') continue; // a comment
    const vm = /^\$(\d+)=(.*)$/.exec(s);
    if (vm) { vars[+vm[1]] = evalExpr(vm[2], vars); continue; }
    const f = s.split(',').map((x) => evalExpr(x, vars));
    const code = f[0], on = f[1] !== 0;
    const L = (v) => toNm(v);
    switch (code) {
      case 1: { // circle: exposure, diameter, x, y[, rotation]
        const rot = f[5] || 0;
        prims.push({ on, rings: [R(circle(L(f[3]), L(f[4]), L(f[2]) / 2), rot)] });
        break;
      }
      case 20: case 2: { // vector line: exposure, width, x1, y1, x2, y2, rotation
        const [w, x1, y1, x2, y2, rot] = [L(f[2]), L(f[3]), L(f[4]), L(f[5]), L(f[6]), f[7] || 0];
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
        prims.push({ on, rings: [R([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], rot)] });
        break;
      }
      case 21: { // centre line: exposure, width, height, cx, cy, rotation
        const [w, h, cx, cy, rot] = [L(f[2]), L(f[3]), L(f[4]), L(f[5]), f[6] || 0];
        prims.push({ on, rings: [R([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], rot)] });
        break;
      }
      case 22: { // lower-left line (deprecated): exposure, width, height, x, y, rotation
        const [w, h, x, y, rot] = [L(f[2]), L(f[3]), L(f[4]), L(f[5]), f[6] || 0];
        prims.push({ on, rings: [R([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], rot)] });
        break;
      }
      case 4: { // outline: exposure, n, x0, y0, … xn, yn, rotation
        const n = Math.round(f[2]);
        const pts = [];
        for (let k = 0; k <= n; k++) pts.push([L(f[3 + 2 * k]), L(f[4 + 2 * k])]);
        prims.push({ on, rings: [R(pts, f[5 + 2 * n] || 0)] });
        break;
      }
      case 5: { // polygon: exposure, vertices, cx, cy, diameter, rotation
        const n = Math.max(3, Math.round(f[2])), cx = L(f[3]), cy = L(f[4]), r = L(f[5]) / 2, rot = f[6] || 0;
        prims.push({ on, rings: [R(Array.from({ length: n }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]), rot)] });
        break;
      }
      case 6: { // moiré (deprecated): drawn as its outer ring and crosshair
        const [cx, cy, od, th, gap, n, cw, cl, rot] = [L(f[1]), L(f[2]), L(f[3]), L(f[4]), L(f[5]), Math.round(f[6]), L(f[7]), L(f[8]), f[9] || 0];
        for (let k = 0; k < n; k++) {
          const ro = od / 2 - k * (th + gap), ri = ro - th;
          if (ro <= 0) break;
          prims.push({ on: true, rings: [R(circle(cx, cy, ro), rot), ...(ri > 0 ? [R(circle(cx, cy, ri), rot)] : [])] });
        }
        prims.push({ on: true, rings: [R([[cx - cl / 2, cy - cw / 2], [cx + cl / 2, cy - cw / 2], [cx + cl / 2, cy + cw / 2], [cx - cl / 2, cy + cw / 2]], rot)] });
        prims.push({ on: true, rings: [R([[cx - cw / 2, cy - cl / 2], [cx + cw / 2, cy - cl / 2], [cx + cw / 2, cy + cl / 2], [cx - cw / 2, cy + cl / 2]], rot)] });
        break;
      }
      case 7: { // thermal: cx, cy, outer d, inner d, gap, rotation: a ring cut by a cross
        const [cx, cy, od, id, gap, rot] = [L(f[1]), L(f[2]), L(f[3]), L(f[4]), L(f[5]), f[6] || 0];
        const ro = od / 2, ri = id / 2, g = gap / 2;
        for (let q = 0; q < 4; q++) {
          // a quarter ring between the gap arms, as a polygon
          const a0 = (q * Math.PI) / 2, pts = [];
          const s0 = Math.asin(Math.min(1, g / ro)), s1 = Math.asin(Math.min(1, g / Math.max(ri, 1)));
          for (let k = 0; k <= 8; k++) { const t = a0 + s0 + ((Math.PI / 2 - 2 * s0) * k) / 8; pts.push([cx + ro * Math.cos(t), cy + ro * Math.sin(t)]); }
          for (let k = 8; k >= 0; k--) { const t = a0 + s1 + ((Math.PI / 2 - 2 * s1) * k) / 8; pts.push([cx + ri * Math.cos(t), cy + ri * Math.sin(t)]); }
          prims.push({ on: true, rings: [R(pts, rot)] });
        }
        break;
      }
      default: warnings.add(`Macro primitive ${code} isn't drawn`);
    }
  }
  return prims;
}

// ---------------------------------------------------------------- shapes as polygons

/**
 * An aperture's shape about (0, 0), in board orientation: [{ on, rings }]. Circles become 32-gons
 * at least (more for big ones), so drawing and comparing see the same geometry.
 */
export function apertureShape(ap) {
  if (ap._shape) return ap._shape;
  let s;
  const hole = (h) => (h > 0 ? [circle(0, 0, h / 2, 24)] : []);
  if (ap.type === 'C') s = [{ on: true, rings: [circle(0, 0, ap.d / 2, Math.max(16, Math.min(64, Math.ceil(ap.d / 25_000)))), ...hole(ap.hole)] }];
  else if (ap.type === 'R') s = [{ on: true, rings: [[[-ap.w / 2, -ap.h / 2], [ap.w / 2, -ap.h / 2], [ap.w / 2, ap.h / 2], [-ap.w / 2, ap.h / 2]], ...hole(ap.hole)] }];
  else if (ap.type === 'O') {
    const r = Math.min(ap.w, ap.h) / 2, dx = ap.w / 2 - r, dy = ap.h / 2 - r, pts = [];
    const n = 12;
    const arc = (cx, cy, t0) => { for (let k = 0; k <= n; k++) { const t = t0 + (Math.PI * k) / n; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } };
    if (ap.w >= ap.h) { arc(dx, 0, -Math.PI / 2); arc(-dx, 0, Math.PI / 2); } else { arc(0, dy, 0); arc(0, -dy, Math.PI); }
    s = [{ on: true, rings: [pts, ...hole(ap.hole)] }];
  } else if (ap.type === 'P') {
    const t0 = (-(ap.rot || 0) * Math.PI) / 180; // board orientation: Y down, so the turn reverses
    s = [{ on: true, rings: [Array.from({ length: ap.n }, (_, k) => [(ap.d / 2) * Math.cos(t0 - (2 * Math.PI * k) / ap.n), (ap.d / 2) * Math.sin(t0 - (2 * Math.PI * k) / ap.n)]), ...hole(ap.hole)] }];
  } else s = ap.prims || [];
  ap._shape = s;
  return s;
}

const hull = (pts) => {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
};

/** A straight draw with an aperture: the aperture swept from a to b (convex apertures). */
function sweep(ap, a, b) {
  const shape = apertureShape(ap);
  const outer = shape[0]?.rings[0];
  if (!outer) return [];
  if (ap.type === 'C') {
    // a capsule
    const r = ap.d / 2, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1) return [outer.map(([x, y]) => [x + a[0], y + a[1]])];
    const t = Math.atan2(dy, dx), n = Math.max(8, Math.min(32, Math.ceil(r / 25_000)));
    const pts = [];
    for (let k = 0; k <= n; k++) { const u = t + Math.PI / 2 + (Math.PI * k) / n; pts.push([a[0] + r * Math.cos(u), a[1] + r * Math.sin(u)]); }
    for (let k = 0; k <= n; k++) { const u = t - Math.PI / 2 + (Math.PI * k) / n; pts.push([b[0] + r * Math.cos(u), b[1] + r * Math.sin(u)]); }
    return [pts];
  }
  return [hull([...outer.map(([x, y]) => [x + a[0], y + a[1]]), ...outer.map(([x, y]) => [x + b[0], y + b[1]])])];
}

/**
 * Everything a Gerber draws, as filled shapes in drawing order: [{ dark, rings }] (board nm; each
 * item's rings fill even-odd; dark false erases what is under it). minStroke: draw round strokes
 * at least this wide (for comparing outlines).
 */
export function gerberShapes(g, { minStroke = 0 } = {}) {
  const out = [];
  // a thin outline (Eagle draws it with a zero-width aperture) drawn at least minStroke wide
  const thick = new Map();
  const apOf = (ap) => {
    if (!minStroke || ap.type !== 'C' || ap.d >= minStroke) return ap;
    if (!thick.has(ap)) thick.set(ap, { type: 'C', d: minStroke, hole: 0, code: ap.code });
    return thick.get(ap);
  };
  for (const o0 of g.objects) {
    const o = o0.kind === 'stroke' || o0.kind === 'arc' ? { ...o0, ap: apOf(o0.ap) } : o0;
    if (o.kind === 'region') { out.push({ dark: o.dark, rings: [o.pts] }); continue; }
    if (o.kind === 'flash') {
      for (const p of apertureShape(o.ap)) out.push({ dark: p.on ? o.dark : !o.dark, rings: p.rings.map((r) => r.map(([x, y]) => [x + o.at[0], y + o.at[1]])) });
      continue;
    }
    if (o.kind === 'stroke') { out.push({ dark: o.dark, rings: sweep(o.ap, o.a, o.b) }); continue; }
    if (o.kind === 'arc') {
      // flattened: each piece a straight draw (the frame is already Y down, so clockwise flips)
      const pts = arcPoints(o.a, o.b, o.c, !o.cw);
      for (let k = 1; k < pts.length; k++) out.push({ dark: o.dark, rings: sweep(o.ap, pts[k - 1], pts[k]) });
    }
  }
  return out;
}

/** The box round a list of objects (nm), or null. */
export function objectsBox(objects) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p, r = 0) => { if (p[0] - r < x0) x0 = p[0] - r; if (p[1] - r < y0) y0 = p[1] - r; if (p[0] + r > x1) x1 = p[0] + r; if (p[1] + r > y1) y1 = p[1] + r; };
  const size = (ap) => (ap ? (ap.type === 'C' ? ap.d / 2 : ap.type === 'P' ? ap.d / 2 : Math.max(ap.w || 0, ap.h || 0) / 2) : 0);
  for (const o of objects) {
    if (o.at) add(o.at, size(o.ap));
    if (o.a) { add(o.a, size(o.ap)); add(o.b, size(o.ap)); }
    if (o.kind === 'arc') { const r = Math.hypot(o.a[0] - o.c[0], o.a[1] - o.c[1]); add(o.c, r + size(o.ap)); }
    if (o.pts) for (const p of o.pts) add(p);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
