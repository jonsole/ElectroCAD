// The agreed shove cases (#108, S1-S9): each run by tools/shove-gallery.mjs, which draws them for
// sign-off, must leave the board clear of clearance errors, and push (or refuse) as agreed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('every shove case is DRC clean and pushes or refuses as agreed (#108)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shove-cases-'));
  execFileSync(process.execPath, [path.resolve('tools/shove-gallery.mjs'), dir]);
  const res = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  const want = { S1: true, S2: true, S3: true, S4: true, S5: true, S6a: false, S6b: false, S6c: false, S7: true, S8: true, S9: true };
  for (const r of res) {
    assert.equal(r.clashes, 0, `${r.id}: ${r.clashes} clearance errors`);
    assert.equal(r.ok, want[r.id], `${r.id}: ${r.ok ? 'pushed' : `refused (${r.reason})`}`);
  }
  assert.equal(res.length, Object.keys(want).length);
});
