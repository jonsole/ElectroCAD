// Excellon drill reader (#28). DOM-free.
//
//   readExcellon(text) -> { units, tools: Map(code -> diameter nm), holes: [{ at, d, tool }],
//                           slots: [{ a, b, d, tool }], plated: true | false | null, attrs, warnings, box }
//
// Holes are in board nm (+Y down). Covered: METRIC / INCH (with LZ / TZ and a 000.000 format),
// M71 / M72, FMAT, KiCad's and Altium's FILE_FORMAT comments, tools defined in the header (or
// first used in the body with a size), explicit decimal points, implied decimals (inch 2.4, mm
// 3.3 by default; LZ = leading zeros kept, so digits are left-aligned), modal X / Y, G85 slots,
// routed slots (M15 / M16 with G00 / G01), and X2-style TF attributes in comments.

export function readExcellon(text) {
  const warnings = new Set();
  const attrs = {};
  const tools = new Map(), holes = [], slots = [];
  let units = null, zeros = null, intD = null, decD = null, cur = null, pos = [0, 0], incremental = false;
  let rout = null; // { tool, from, down }
  let fmtFromComment = null;
  const lines = text.split(/\r?\n/);
  const scale = () => (units === 'mm' ? 1e6 : 25.4e6);
  const num = (s) => {
    if (s.includes('.')) return Math.round(Number(s) * scale());
    let sign = 1;
    if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1; s = s.slice(1); }
    const i = intD ?? (units === 'mm' ? 3 : 2), d = decD ?? (units === 'mm' ? 3 : 4);
    // LZ: leading zeros kept (trailing dropped), so the digits start at the left; else they end at the right
    const v = zeros === 'LZ' ? Number(s.padEnd(i + d, '0')) / 10 ** d : Number(s) / 10 ** d;
    return sign * Math.round(v * scale());
  };
  const point = (l) => {
    const x = /X([+-]?[\d.]+)/.exec(l), y = /Y([+-]?[\d.]+)/.exec(l);
    let px = x ? num(x[1]) : null, py = y ? num(y[1]) : null;
    if (incremental) { px = (px ?? 0) + pos[0]; py = (py ?? 0) + pos[1]; }
    return [px ?? pos[0], py ?? pos[1]];
  };
  const setUnits = (l) => {
    units = /^(METRIC|M71)/.test(l) ? 'mm' : 'in';
    if (/,LZ/.test(l)) zeros = 'LZ'; else if (/,TZ/.test(l)) zeros = 'TZ';
    const f = /,(0+)\.(0+)/.exec(l);
    if (f) { intD = f[1].length; decD = f[2].length; }
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith(';')) {
      const ff = /FILE_FORMAT\s*=\s*(\d+):(\d+)/i.exec(l) || /FORMAT\s*=\s*\{\s*(\d+):(\d+)/i.exec(l);
      if (ff) fmtFromComment = [+ff[1], +ff[2]];
      const tf = /#@!\s*TF\.(\w+),(.*)$/.exec(l);
      if (tf) attrs[tf[1]] = tf[2].trim();
      continue;
    }
    if (l === 'M48' || l === '%' || l === 'M95' || l === 'G05' || l === 'G90' || l === 'M00' || /^FMAT/.test(l) || /^VER/.test(l) || /^ICI/.test(l) || l === 'M47') {
      if (l === 'G90') incremental = false;
      continue;
    }
    if (l === 'G91' || l === 'ICI,ON') { incremental = true; warnings.add('Incremental coordinates'); continue; }
    if (/^(METRIC|INCH|M71|M72)/.test(l)) { setUnits(l); if (fmtFromComment && intD == null) { [intD, decD] = fmtFromComment; } continue; }
    if (l === 'M30' || l === 'M02') break;
    // a tool definition: T01C0.0120 (maybe with F / S / B / H between)
    const td = /^T(\d+)(?:[A-BD-Z][\d.]*)*C([\d.]+)/.exec(l);
    if (td) {
      if (fmtFromComment && intD == null) [intD, decD] = fmtFromComment;
      tools.set(+td[1], Math.round(Number(td[2]) * scale()));
      if (!/[XY]/.test(l)) { cur = +td[1]; continue; }
    }
    const ts = /^T(\d+)$/.exec(l);
    if (ts) { cur = +ts[1]; if (!tools.has(cur) && cur !== 0) warnings.add(`Tool T${cur} has no size`); continue; }
    if (l === 'M15') { if (rout) rout.down = true; continue; }
    if (l === 'M16' || l === 'M17') { if (rout) rout.down = false; continue; }
    if (/^G00/.test(l)) { pos = point(l); rout = { from: pos, down: false }; continue; }
    if (/^G0[123]/.test(l)) {
      const p = point(l);
      if (rout?.down && cur != null) slots.push({ a: pos, b: p, d: tools.get(cur) || 0, tool: cur });
      if (/^G0[23]/.test(l)) warnings.add('Routed arcs were drawn straight');
      pos = p;
      continue;
    }
    if (/G85/.test(l)) {
      const [s1, s2] = l.split('G85');
      const a = point(s1); pos = a;
      const b = point(s2);
      slots.push({ a, b, d: tools.get(cur) || 0, tool: cur });
      pos = b;
      continue;
    }
    if (/^[XY]/.test(l)) {
      const p = point(l);
      if (cur == null) warnings.add('A hole before any tool was chosen');
      else holes.push({ at: p, d: tools.get(cur) || 0, tool: cur });
      pos = p;
      continue;
    }
    if (/^(G\d+|M\d+|R\d+)/.test(l)) {
      if (/^R\d+/.test(l)) warnings.add('Repeat codes (R) aren\'t read');
      continue;
    }
    warnings.add(`Unknown line ${l.slice(0, 16)}`);
  }
  if (!units) { units = 'in'; warnings.add('No units given: read as inches'); }
  const flip = (p) => [p[0], -p[1] || 0];
  for (const h of holes) h.at = flip(h.at);
  for (const s of slots) { s.a = flip(s.a); s.b = flip(s.b); }
  const fn = attrs.FileFunction || '';
  const plated = /NonPlated|NPTH/i.test(fn) ? false : /Plated|PTH/i.test(fn) ? true : null;
  let box = null;
  for (const h of [...holes.map((x) => [x.at, x.d]), ...slots.flatMap((s) => [[s.a, s.d], [s.b, s.d]])]) {
    const [[x, y], d] = h, r = d / 2;
    box = box ? { x0: Math.min(box.x0, x - r), y0: Math.min(box.y0, y - r), x1: Math.max(box.x1, x + r), y1: Math.max(box.y1, y + r) } : { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  }
  return { units, tools, holes, slots, plated, attrs, warnings: [...warnings], box };
}

/** Drill holes and slots as filled shapes ([{ dark: true, rings }]), as Gerber shapes are. */
export function drillShapes(x) {
  const out = [];
  const circ = (c, r) => { const n = Math.max(16, Math.min(48, Math.ceil(r / 20_000))); return Array.from({ length: n }, (_, k) => [c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)]); };
  for (const h of x.holes) out.push({ dark: true, rings: [circ(h.at, h.d / 2)] });
  for (const s of x.slots) {
    const r = s.d / 2, t = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]), pts = [];
    for (let k = 0; k <= 12; k++) { const u = t + Math.PI / 2 + (Math.PI * k) / 12; pts.push([s.a[0] + r * Math.cos(u), s.a[1] + r * Math.sin(u)]); }
    for (let k = 0; k <= 12; k++) { const u = t - Math.PI / 2 + (Math.PI * k) / 12; pts.push([s.b[0] + r * Math.cos(u), s.b[1] + r * Math.sin(u)]); }
    out.push({ dark: true, rings: [pts] });
  }
  return out;
}
