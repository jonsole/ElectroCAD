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
const ADVANCE = 6; // grid units per character (4 wide + 2 between)
const CAP = 6;

/** The glyph for a character (unknown ones show as ?). */
export const glyph = (ch) => GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS['?'];

/** Width of `text` at `size` (capital height), nm. */
export const strokeWidthOf = (text, size) => (Math.max(0, [...String(text)].length * ADVANCE - 2) * size) / CAP;

/** The pen width for text of `size` (capital height). */
export const strokePen = (size) => Math.max(1, Math.round(size * 0.15));

/**
 * The polylines (board nm, +Y down) of `text` centred on `at`, `size` = capital height. `mirror`
 * writes it as seen from the back (for B.SilkS).
 */
export function strokeText(text, { at, size, mirror = false }) {
  const u = size / CAP;
  const chars = [...String(text)];
  const w = Math.max(0, chars.length * ADVANCE - 2);
  const out = [];
  chars.forEach((ch, i) => {
    for (const pl of glyph(ch)) {
      out.push(pl.map(([gx, gy]) => {
        let x = (i * ADVANCE + gx - w / 2) * u;
        if (mirror) x = -x;
        return [Math.round(at[0] + x), Math.round(at[1] - (gy - CAP / 2) * u)];
      }));
    }
  });
  return out;
}
