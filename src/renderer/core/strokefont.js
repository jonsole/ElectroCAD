// A small stroke (single-line) font for text that goes to the fab: silkscreen in Gerber, where
// text must be lines, not a system font. Each glyph is polylines on a grid 4 wide and 6 tall
// (capitals sit on 0..6; lowercase x-height 4, descenders to -2), drawn with a round pen. DOM-free.
//
// strokeText(text, { at, size, mirror }) -> [[point, point, …], …] in board nm (+Y down), centred on
// `at` the way the canvas centres text (middle of the capital height).

const G = {
  ' ': '',
  0: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0', 1: '1,5 2,6 2,0|1,0 3,0', 2: '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
  3: '0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1|1,3 3,3', 4: '3,0 3,6 0,2 4,2', 5: '4,6 0,6 0,3 3,3 4,2 4,1 3,0 1,0 0,1',
  6: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3', 7: '0,6 4,6 1,0', 8: '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  9: '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3',
  A: '0,0 0,4 2,6 4,4 4,0|0,3 4,3', B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0', C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1',
  D: '0,0 0,6 3,6 4,5 4,1 3,0 0,0', E: '4,6 0,6 0,0 4,0|0,3 3,3', F: '4,6 0,6 0,0|0,3 3,3', G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3',
  H: '0,0 0,6|4,0 4,6|0,3 4,3', I: '1,6 3,6|2,6 2,0|1,0 3,0', J: '3,6 3,1 2,0 1,0 0,1', K: '0,0 0,6|4,6 0,2|1,3 4,0', L: '0,6 0,0 4,0',
  M: '0,0 0,6 2,3 4,6 4,0', N: '0,0 0,6 4,0 4,6', O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0', P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
  Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2,2 4,0', R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0', S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
  T: '0,6 4,6|2,6 2,0', U: '0,6 0,1 1,0 3,0 4,1 4,6', V: '0,6 2,0 4,6', W: '0,6 1,0 2,4 3,0 4,6', X: '0,0 4,6|0,6 4,0', Y: '0,6 2,3 4,6|2,3 2,0', Z: '0,6 4,6 0,0 4,0',
  a: '0,4 3,4 4,3 4,0|4,2 1,2 0,1 1,0 4,0', b: '0,6 0,0 3,0 4,1 4,3 3,4 0,4', c: '4,4 1,4 0,3 0,1 1,0 4,0', d: '4,6 4,0 1,0 0,1 0,3 1,4 4,4',
  e: '0,2 4,2 4,3 3,4 1,4 0,3 0,1 1,0 4,0', f: '4,6 3,6 2,5 2,0|1,4 3,4', g: '4,4 4,-1 3,-2 1,-2|4,4 1,4 0,3 0,1 1,0 4,0', h: '0,6 0,0|0,4 3,4 4,3 4,0',
  i: '2,4 2,0|2,6 2,5.5', j: '2,4 2,-1 1,-2 0,-2|2,6 2,5.5', k: '0,6 0,0|4,4 0,1|1,2 4,0', l: '2,6 2,1 3,0', m: '0,4 0,0|0,3 1,4 2,3 2,0|2,3 3,4 4,3 4,0',
  n: '0,4 0,0|0,3 1,4 3,4 4,3 4,0', o: '1,0 3,0 4,1 4,3 3,4 1,4 0,3 0,1 1,0', p: '0,4 0,-2|0,4 3,4 4,3 4,1 3,0 0,0', q: '4,4 4,-2|4,4 1,4 0,3 0,1 1,0 4,0',
  r: '0,4 0,0|0,2 2,4 4,4', s: '4,4 1,4 0,3 1,2 3,2 4,1 3,0 0,0', t: '2,6 2,1 3,0 4,0|1,4 3,4', u: '0,4 0,1 1,0 3,0 4,1|4,4 4,0', v: '0,4 2,0 4,4',
  w: '0,4 1,0 2,3 3,0 4,4', x: '0,0 4,4|0,4 4,0', y: '0,4 2,0|4,4 1,-2', z: '0,4 4,4 0,0 4,0',
  '-': '1,3 3,3', '+': '2,1 2,5|0,3 4,3', '.': '2,0 2,0.3', ',': '2,0.5 1,-1', '/': '0,0 4,6', '\\': '0,6 4,0', _: '0,-1 4,-1',
  '(': '3,6 2,5 2,1 3,0', ')': '1,6 2,5 2,1 1,0', '[': '3,6 1,6 1,0 3,0', ']': '1,6 3,6 3,0 1,0', ':': '2,1 2,1.3|2,4 2,4.3',
  '%': '0,0 4,6|0,6 0,5|4,1 4,0', '*': '2,1 2,5|0,2 4,4|0,4 4,2', '#': '1,0 1,6|3,0 3,6|0,2 4,2|0,4 4,4', '=': '0,2 4,2|0,4 4,4',
  '<': '4,5 0,3 4,1', '>': '0,5 4,3 0,1', "'": '2,6 2,4', '"': '1,6 1,4|3,6 3,4', '!': '2,6 2,2|2,0 2,0.3', '?': '0,5 1,6 3,6 4,5 4,4 2,3 2,2|2,0 2,0.3',
  '~': '0,3 1,4 3,2 4,3', $: '4,5 1,5 0,4 1,3 3,3 4,2 3,1 0,1|2,6 2,0', µ: '0,4 0,-2|0,1 1,0 3,0 4,1|4,4 4,0', Ω: '0,0 1,0 0,2 0,4 1,6 3,6 4,4 4,2 3,0 4,0',
  '°': '1,6 2,6 2,5 1,5 1,6',
};
const GLYPHS = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v ? v.split('|').map((pl) => pl.split(' ').map((q) => q.split(',').map(Number))) : []]));
// Metrics (#79), measured against Eagle's own Gerbers: a text's size is the full height of a capital
// including the pen, as Eagle's is. The capital's stroke centres span 0.9 of it, the pen is 0.1 of
// it, and each character advances 0.786 of it (boxes drawn round parts of Eagle pin names line up
// only with that advance). Glyphs are drawn on a grid 4 wide and 6 tall for the capital height.
const CAP = 6;
export const CAP_RATIO = 0.9;
export const PEN_RATIO = 0.1;
export const ADVANCE_RATIO = 0.786;

/** The glyph for a character (unknown ones show as ?). */
export const glyph = (ch) => GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS['?'];

/** Width of `text` at `size` (text height), between the outer stroke centres, nm. */
export const strokeWidthOf = (text, size) => {
  const n = [...String(text)].length;
  return n ? (n - 1) * size * ADVANCE_RATIO + (4 * size * CAP_RATIO) / CAP : 0;
};

/** The pen width for text of `size`. */
export const strokePen = (size) => Math.max(1, Math.round(size * PEN_RATIO));

/** Glyph polylines for `text` from (x0, base), y up in grid units turned to y down (no rounding). */
function layout(text, size, x0, base, { mirror = false, slant = 0, mirrorAbout = null } = {}) {
  const u = (size * CAP_RATIO) / CAP, adv = size * ADVANCE_RATIO;
  const out = [];
  [...String(text)].forEach((ch, i) => {
    for (const pl of glyph(ch)) {
      out.push(pl.map(([gx, gy]) => {
        let x = x0 + i * adv + gx * u + gy * u * slant;
        if (mirror) x = 2 * mirrorAbout - x;
        return [x, base - gy * u];
      }));
    }
  });
  return out;
}

/**
 * The polylines (board nm, +Y down) of `text` centred on `at` (the middle of the capital height).
 * `size` is the text height; `mirror` writes it as seen from the back (for B.SilkS).
 */
export function strokeText(text, { at, size, mirror = false }) {
  const w = strokeWidthOf(text, size), cap = size * CAP_RATIO;
  return layout(text, size, at[0] - w / 2, at[1] + cap / 2, { mirror, mirrorAbout: at[0] })
    .map((pl) => pl.map(([x, y]) => [Math.round(x), Math.round(y)]));
}

// ---------------------------------------------------------------- the schematic's vector text (#79)

/** Width of `text` (nm, or px) at text height `size`, in the vector font. */
export const vectorWidth = (text, size) => strokeWidthOf(text, size);

/**
 * `text` laid out the way a canvas would place it, as polylines in the same units: `px` is the text
 * height (the canvas font size), `align` left|start|center|right|end, `baseline` middle|top|hanging|
 * bottom|alphabetic|ideographic, `italic` slants it. Returns { lines, pen } (pen: a line width).
 */
export function vectorLayout(text, { x, y, px, align = 'left', baseline = 'alphabetic', italic = false, bold = false }) {
  const cap = px * CAP_RATIO;
  const w = strokeWidthOf(text, px);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
  // the y of the glyphs' baseline
  const base = baseline === 'middle' ? y + cap / 2 : baseline === 'top' || baseline === 'hanging' ? y + cap : baseline === 'bottom' || baseline === 'ideographic' ? y - cap * 0.3 : y;
  return { lines: layout(text, px, x0, base, { slant: italic ? 0.2 : 0 }), pen: Math.max(0.5, px * PEN_RATIO * (bold ? 1.4 : 1)) };
}
