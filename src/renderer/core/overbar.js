// Overbar markup (#63): `~{…}` draws a line over the text inside, as KiCad writes it: `~{RESET}`,
// `IS/~{RD}`. An unclosed `~{` runs to the end; a `~` not followed by `{` is itself. A Pin named just
// `~` has no name (unchanged). Used in pin names, labels (so Net names) and fields; the text is
// drawn without the markup and measured without it. DOM-free.

/** The text as runs: [{ text, over }], over: true for an overbarred run. */
export function overbarRuns(text) {
  const s = String(text ?? '');
  const runs = [];
  const push = (t, over) => { if (!t) return; const last = runs[runs.length - 1]; if (last && last.over === over) last.text += t; else runs.push({ text: t, over }); };
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('~{', i);
    if (open < 0) { push(s.slice(i), false); break; }
    push(s.slice(i, open), false);
    const close = s.indexOf('}', open + 2);
    if (close < 0) { push(s.slice(open + 2), true); break; }
    push(s.slice(open + 2, close), true);
    i = close + 1;
  }
  return runs;
}

/** Does the text have overbar markup? */
export const hasOverbar = (text) => String(text ?? '').includes('~{');

/** The text as it reads, without the markup. */
export const plainText = (text) => (hasOverbar(text) ? overbarRuns(text).map((r) => r.text).join('') : String(text ?? ''));

/**
 * Eagle's overbar (`!`) as markup: a `!` turns the bar on and the next turns it off; a comma (a
 * list of names, a bus) ends it too. `!RESET` -> `~{RESET}`, `IS/!RD` -> `IS/~{RD}`,
 * `!A!/B` -> `~{A}/B`, `!X,!Y` -> `~{X},~{Y}`. A `!` with nothing after it is dropped.
 */
export function eagleOverbar(name) {
  const s = String(name ?? '');
  if (!s.includes('!')) return s;
  let out = '', over = '', on = false;
  const end = () => { if (on && over) out += `~{${over}}`; over = ''; on = false; };
  for (const ch of s) {
    if (ch === '!') { if (on) end(); else on = true; }
    else if (ch === ',' && on) { end(); out += ch; }
    else if (on) over += ch;
    else out += ch;
  }
  end();
  return out;
}
