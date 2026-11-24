import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetToSvg, sheetsToPdf, printColors, printFileName } from '../src/renderer/print/schematic.js';
import { SvgContext, PdfContext, helveticaWidth, parseFont, parseColor, buildPdf } from '../src/renderer/print/vector.js';
import { sampleProject } from './fixtures/sample-project.js';
import { estimateWidth } from '../src/renderer/core/fields.js';

const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

test('SVG of a Sheet: References, Values, net labels, power symbols, markup and the title block', () => {
  const p = sampleProject();
  const [s1, s2] = p.schematic.sheets;
  const svg = sheetToSvg(p, s2, { measure: estimateWidth });
  assert.match(svg, /^<\?xml[^>]+>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="297mm" height="420mm"/, 'A3 portrait page');
  const t = texts(svg);
  for (const want of ['R1', 'D1', '330', 'LED_A', '+3V3', 'GND', 'LED indicator', 'Indicator', '2 of 2', 'Example Ltd', 'B']) assert.ok(t.includes(want), `${want} in ${JSON.stringify(t)}`);
  const svg1 = sheetToSvg(p, s1, { measure: estimateWidth });
  assert.ok(texts(svg1).includes('LED indicator: power'), 'text variables are filled in');
  assert.match(svg1, /stroke-dasharray/, 'the dashed box keeps its dashes');
  // balanced groups and no NaN
  assert.equal((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
  assert.ok(!/NaN|undefined/.test(svg));
});

test('PDF of every Sheet: one page each at its paper size, a valid cross-reference table, ASCII only', () => {
  const p = sampleProject();
  const pdf = sheetsToPdf(p, p.schematic.sheets, { measure: estimateWidth });
  assert.ok(pdf.startsWith('%PDF-1.4\n') && pdf.trimEnd().endsWith('%%EOF'));
  assert.ok(/^[\x00-\x7f]*$/.test(pdf), 'ASCII only');
  assert.equal((pdf.match(/\/Type \/Page /g) || []).length, 2);
  assert.match(pdf, /\/MediaBox \[0 0 841\.89 595\.28\]/, 'A4 landscape in points');
  assert.match(pdf, /\/MediaBox \[0 0 841\.89 1190\.55\]/, 'A3 portrait in points');
  // every xref entry points at its object
  const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.equal(pdf.slice(xrefAt, xrefAt + 4), 'xref');
  const entries = pdf.slice(xrefAt).split('\n').slice(2).filter((l) => / n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  entries.forEach((off, i) => assert.equal(pdf.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`));
  // stream lengths are right
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream');
  }
  for (const want of ['(R1) Tj', '(LED_A) Tj', '(+3V3) Tj', '(2 of 2) Tj']) assert.ok(pdf.includes(want), want);
});

test('print colours: light by default, classic paper, or black and white on white', () => {
  assert.equal(printColors().paper, '#ffffff');
  assert.equal(printColors('classic').symbolBody, '#840000');
  const mono = printColors('mono');
  assert.equal(mono.wire, '#000000');
  assert.equal(mono.paper, '#ffffff');
  assert.equal(mono.symbolFill, '#ffffff');
});

test('the vector contexts: fonts, colours, Helvetica widths, arcs as Béziers, alignment', () => {
  assert.deepEqual(parseFont('italic 600 12.5px "Segoe UI"'), { size: 12.5, bold: true, italic: true });
  assert.deepEqual(parseColor('#ff8000').map((x) => Math.round(x * 255)), [255, 128, 0, 255]);
  assert.equal(helveticaWidth('Hi', 1000), 722 + 222);
  const c = new SvgContext(100, 100);
  c.beginPath(); c.arc(50, 50, 10, 0, Math.PI * 2); c.stroke();
  assert.equal((c.out[0].match(/C/g) || []).length, 4, 'a full circle is four curves');
  c.font = '10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText('AB', 50, 50);
  const x = Number(/<text x="([\d.]+)"/.exec(c.out[1])[1]);
  assert.equal(Math.round(x * 100) / 100, 50 - helveticaWidth('AB', 10) / 2);
  const pdf = new PdfContext(1, 100);
  pdf.fillStyle = '#000'; pdf.fillText('(Ω)', 0, 0);
  assert.match(pdf.ops[0], /\(\\\(Ohm\\\)\) Tj/, 'escaped, Ω written as Ohm');
  assert.equal(buildPdf([{ ctx: pdf, widthPt: 10, heightPt: 10 }]).includes('/Count 1'), true);
});

test('export file names are safe', () => {
  assert.equal(printFileName({ name: 'Amp: v2' }, { name: 'Power/Supply' }, 'svg'), 'Amp- v2 - Power-Supply.svg');
  assert.equal(printFileName({ name: '' }, null, 'pdf'), 'Untitled.pdf');
});
