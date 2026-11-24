// Engineering Values (ADR-0012): parse 4k7 / 4.7k / 4700 / 100n / 0.1u / 2R2, format them for
// display (a Field style's Value format), and give BOM grouping a notation-independent key.
// The stored Value is never rewritten.

const MULT = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, R: 1, r: 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
const UNITS = ['Ω', 'ohm', 'ohms', 'F', 'H', 'V', 'A', 'W', 'Hz'];

/** Parse an engineering value. Returns { num, unit } or null when it isn't one (e.g. "LED"). */
export function parseValue(text) {
  let s = String(text ?? '').trim().replace(/\s+/g, '');
  if (!s) return null;
  let unit = '';
  for (const u of UNITS) {
    if (s.length > u.length && s.toLowerCase().endsWith(u.toLowerCase())) { unit = u.startsWith('ohm') ? 'Ω' : u; s = s.slice(0, -u.length); break; }
  }
  // RKM: the multiplier letter is the decimal point (4k7, 2R2, 1n5, R47)
  let m = /^(\d*)([pnuµμmRrkKMG])(\d+)$/.exec(s);
  if (m && (m[1] || m[2] === 'R' || m[2] === 'r')) return { num: Number(`${m[1] || '0'}.${m[3]}`) * MULT[m[2]], unit };
  // plain or suffixed: 4.7k, 100n, 4700, 10K
  m = /^(\d+(?:\.\d+)?|\.\d+)([pnuµμmRrkKMG]?)$/.exec(s);
  if (m) return { num: Number(m[1]) * (m[2] ? MULT[m[2]] : 1), unit };
  return null;
}

const PREFIXES = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p']];

function scaled(num) {
  for (const [f, p] of PREFIXES) if (Math.abs(num) >= f * 0.9999999) return [num / f, p];
  return [num / 1e-12, 'p'];
}

const clean = (x) => String(+x.toPrecision(6));

/** Format a Value: 'as-typed' (unchanged), 'rkm' (4k7, 2R2, 100n) or 'si' (4.7k, 100nF). */
export function formatValue(text, format = 'as-typed') {
  if (format === 'as-typed') return text;
  const v = parseValue(text);
  if (!v) return text;
  let [mant, prefix] = scaled(v.num);
  if (format === 'si') return clean(mant) + prefix + (v.unit && v.unit !== 'Ω' ? v.unit : v.unit === 'Ω' ? 'Ω' : '');
  // RKM / IEC 60062: the prefix letter replaces the decimal point; 'R' stands in for no prefix
  if (v.num < 1 && prefix === 'm' && (v.unit === 'Ω' || v.unit === '')) { mant = v.num; prefix = ''; } // resistor-style R47
  const letter = prefix || 'R';
  const s = clean(mant);
  if (s.includes('.')) {
    const [i, f] = s.split('.');
    return (i === '0' ? '' : i) + letter + f;
  }
  return prefix ? s + prefix : s + 'R';
}

/** A key for grouping equal Values in a BOM: 4k7, 4.7k and 4700 share one; text Values compare case-insensitively. */
export function valueKey(text) {
  const v = parseValue(text);
  return v ? `${+v.num.toPrecision(6)}${v.unit}` : String(text ?? '').trim().toLowerCase();
}
