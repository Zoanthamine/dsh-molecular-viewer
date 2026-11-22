import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const code = app.slice(app.indexOf('  function sourceMetadata('), app.indexOf('  function updateWarnings('));
const sandbox = { MAX_LABELS: 400, safeText: (value, limit = 350) => String(value).slice(0, limit) };
vm.runInNewContext(code + '\nthis.presentation = {sourceMetadata, warningPresentation};', sandbox);
const { sourceMetadata, warningPresentation } = sandbox.presentation;
const xyz = { format: 'xyz', warnings: ['XYZ does not encode bond orders; any renderer-inferred connectivity is display-only.'] };
const frame = { bonds: [], metadata: { coordinateProvenance: 'supplied coordinates', optimizationConverged: null } };

test('ordinary XYZ has short Chinese source and no repeated primary warning', () => {
  assert.equal(sourceMetadata(frame), '文件坐标');
  const info = warningPresentation(xyz, frame);
  assert.equal(info.notices.length, 0);
  assert.equal(info.details.length, 2);
  assert.match(info.details.join(' '), /距离示意/);
  assert.match(info.details.join(' '), /不证明优化收敛/);
});
test('source details are native, keyboard-accessible and collapsed by default', () => {
  const tag = html.match(/<details\b[^>]*id="sourceDetails"[^>]*>/)[0];
  assert.ok(!/\bopen(?:\s|=|>)/.test(tag));
  const detailBody = html.match(/<details\b[^>]*id="sourceDetails"[^>]*>([\s\S]*?)<\/details>/)[1];
  assert.match(detailBody, /<summary>坐标与来源详情<\/summary>/);
  assert.match(detailBody, /id="extraMetadata"/); assert.match(detailBody, /id="warnings"/);
  assert.ok(html.indexOf('id="importantWarnings"') < html.indexOf('id="sourceDetails"'));
});
test('output/input labels are concise without inventing convergence', () => {
  assert.equal(sourceMetadata({metadata:{coordinateProvenance:'input Cartesian coordinates; not optimized'}}), '输入坐标');
  assert.equal(sourceMetadata({metadata:{coordinateProvenance:'output geometry; last output is not necessarily last converged'}}), '输出坐标');
  assert.equal(warningPresentation(xyz, frame).notices.length, 0);
  assert.match(warningPresentation(xyz, {...frame, metadata:{optimizationConverged:false}}).notices[0], /未收敛/);
});
test('degraded display, incomplete records and bridge failures stay prominent', () => {
  const info = warningPresentation({format:'pdb', warnings:['CONECT references unavailable/alternate atoms in a model; those connections were omitted.']}, frame, {displayWarning:'距离连线计算超限；仅显示坐标。',labelsTruncated:true,opaqueBridge:true});
  assert.match(info.notices.join(' '), /已略去/);
  assert.match(info.notices.join(' '), /超限/);
  assert.match(info.notices.join(' '), /400/);
  assert.match(info.notices.join(' '), /手动选择文件/);
  assert.match(info.details.join(' '), /CONECT references/);
});
test('rendering core and measurements remain unchanged while explicit loading/export compatibility evolves', async () => {
  const baseline = JSON.parse(await readFile(new URL('../fixtures/render-core.sha256.json', import.meta.url), 'utf8'));
  const ranges = [['  function coordinate(', '  function updateFileList('], ['  const sub =', '  function scheduleResize(']];
  ranges.forEach(([start,end],i) => assert.equal(createHash('sha256').update(app.slice(app.indexOf(start),app.indexOf(end))).digest('hex'), baseline[i]));
});
test('renderer dependency stays pinned; parsing is covered by format-specific tests', async () => {
  for (const [path, hash] of [['vendor/3Dmol-min.js','bcf422137a34b4e206413a8a83a67c24a1ace84e282bf3b164f6bda6aeb42a20']]) {
    const bytes = await readFile(new URL('../public/' + path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
  }
});
