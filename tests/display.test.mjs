import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('MDL aromatic type is retained in source and displayed conservatively as one line', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function atomSpecs(frame) {');
  const end = source.indexOf('function baseStyle(color)', start);
  assert.ok(start >= 0 && end > start);
  const frame = { atoms: [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'C', x: 1.4, y: 0, z: 0 }], bonds: [{ from: 0, to: 1, order: 4 }] };
  const state = {};
  const result = vm.runInNewContext(source.slice(start, end) + '\natomSpecs(frame)', { frame, state, $: () => ({ checked: false }) });
  assert.equal(result[0].bondOrder[0], 1); assert.equal(result[1].bondOrder[0], 1);
  assert.equal(frame.bonds[0].order, 4);
  assert.ok(state.displayWarning.includes('Kekulé'));
});
