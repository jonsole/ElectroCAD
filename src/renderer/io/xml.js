// A small XML reader for the formats ElectroCAD imports (Eagle .sch/.brd/.lbr): elements with
// attributes, text and children; comments, processing instructions, DOCTYPE and CDATA are
// handled. No dependency and no DOM, so it runs the same in the browser, Electron and the tests.
//
//   parseXml(text) -> { name, attrs, children, text }   (the root element)
//   el.child(name), el.all(name), el.path('a/b/c') helpers

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});

class XmlElement {
  constructor(name, attrs) { this.name = name; this.attrs = attrs; this.children = []; this.text = ''; }
  /** The first child element called `name`. */
  child(name) { return this.children.find((c) => c.name === name) || null; }
  /** Every child element called `name`. */
  all(name) { return this.children.filter((c) => c.name === name); }
  /** Follow a path of child names ('drawing/schematic/parts'). */
  path(p) { let e = this; for (const n of p.split('/')) { e = e?.child(n); if (!e) return null; } return e; }
  attr(n, d = undefined) { return n in this.attrs ? this.attrs[n] : d; }
}

export function parseXml(text) {
  let i = 0;
  const n = text.length;
  const root = new XmlElement('#document', {});
  const stack = [root];
  const fail = (msg) => { throw new Error(`XML: ${msg} at character ${i}`); };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) { const t = text.slice(i, lt); if (t.trim()) stack[stack.length - 1].text += decode(t); }
    i = lt;
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i); if (e < 0) fail('unclosed comment'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i); if (e < 0) fail('unclosed CDATA'); stack[stack.length - 1].text += text.slice(i + 9, e); i = e + 3; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i); if (e < 0) fail('unclosed processing instruction'); i = e + 2; continue; }
    if (text.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [ ]
      let depth = 0, j = i + 2;
      for (; j < n; j++) { const c = text[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    if (text[i + 1] === '/') {
      const e = text.indexOf('>', i);
      const name = text.slice(i + 2, e).trim();
      const top = stack.pop();
      if (!top || top.name !== name) fail(`</${name}> does not close <${top?.name}>`);
      i = e + 1; continue;
    }
    // an element: name, attributes, maybe self-closing
    const m = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(i, i + 200));
    if (!m) fail('bad tag');
    const el = new XmlElement(m[1], {});
    i += m[0].length;
    const attrRe = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
    for (;;) {
      attrRe.lastIndex = i;
      const a = attrRe.exec(text);
      if (!a) break;
      el.attrs[a[1]] = decode(a[3] ?? a[4]);
      i = attrRe.lastIndex;
    }
    while (i < n && /\s/.test(text[i])) i++;
    stack[stack.length - 1].children.push(el);
    if (text.startsWith('/>', i)) { i += 2; continue; }
    if (text[i] !== '>') fail(`bad tag <${el.name}>`);
    i++;
    stack.push(el);
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1].name}> is not closed`);
  const top = root.children[0];
  if (!top) throw new Error('XML: no root element');
  return top;
}
