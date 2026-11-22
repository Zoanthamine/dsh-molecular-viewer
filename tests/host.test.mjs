import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenQueue, createRoute } from '../lib/host-core.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../public/', import.meta.url);
function response() { return { status: 0, headers: null, body: null, writeHead(code, headers) { this.status = code; this.headers = headers; }, end(body) { this.body = body; } }; }
async function dispatch(url, options = {}) {
  const res = response();
  const loaded = [];
  const route = createRoute(options.connection ?? { requestRejection: () => undefined }, options.queue ?? new OpenQueue(), root, async path => { loaded.push(path); return Buffer.from('asset'); });
  await route.handler({ method: options.method ?? 'GET', url }, res);
  return { res, loaded };
}
test('queue uses initiating session, local paths, bounded TTL and integer cursor', () => {
  let now = 1; const queue = new OpenQueue(() => now);
  const a = queue.enqueue('s1', 'C:/input/molecule.xyz'); queue.enqueue('s2', 'other.mol');
  assert.equal(queue.since('s1', 0).length, 1);
  assert.equal(queue.since('s1', a.sequence).length, 0);
  assert.equal(queue.since('s2', 0)[0].title, 'other.mol');
  for (const bad of ['https://example.com/x.xyz', 'file:///C:/x.xyz', 'javascript:x.xyz', 'bad\u0000.xyz', 'x.exe', '']) assert.throws(() => queue.enqueue('s1', bad));
  assert.throws(() => queue.enqueue('', 'x.xyz'));
  now += 15 * 60 * 1000 + 1; assert.deepEqual(queue.since('s1', 0), []);
  queue.dispose(); assert.equal(queue.entries.size, 0);
});
test('queue caps pending requests and total sessions', () => {
  const queue = new OpenQueue();
  for (let i = 0; i < 32; i++) queue.enqueue('s', `x${i}.xyz`);
  assert.throws(() => queue.enqueue('s', 'overflow.xyz'));
  for (let i = 1; i < 128; i++) queue.enqueue(`s${i}`, 'x.xyz');
  assert.throws(() => queue.enqueue('new', 'x.xyz'));
});
test('routes fail closed on host admission denial or unavailable service', async () => {
  for (const connection of [{ requestRejection: () => 'authentication' }, {}, { requestRejection: () => { throw new Error('token secret'); } }]) {
    const { res, loaded } = await dispatch('/molecular-viewer/index.html', { connection });
    assert.ok([403, 500].includes(res.status)); assert.equal(loaded.length, 0); assert.ok(!res.body.includes('secret'));
  }
});
test('only explicit static assets are readable; no dynamic file endpoint', async () => {
  for (const url of ['/molecular-viewer/../../secret', '/molecular-viewer/%2e%2e/secret', '/molecular-viewer/?file=C:/secret', '/molecular-viewer/styles.css', '/molecular-viewer/vendor/3Dmol-min.js']) {
    const { res, loaded } = await dispatch(url);
    if (url.includes('secret') && !url.includes('?file')) { assert.equal(res.status, 404); assert.equal(loaded.length, 0); }
    else { assert.equal(res.status, 200); assert.equal(loaded.length, 1); assert.ok(loaded[0].href.startsWith(root.href)); assert.ok(res.headers['Content-Security-Policy'].includes("connect-src 'none'")); }
  }
  assert.equal((await dispatch('/molecular-viewer/requests?sessionId=s&after=-1')).res.status, 400);
  assert.equal((await dispatch('/molecular-viewer/index.html', { method: 'POST' })).res.status, 405);
  const head = await dispatch('/molecular-viewer/styles.css', { method: 'HEAD' }); assert.equal(head.res.status, 200); assert.equal(head.res.body, undefined);
});
test('queue endpoint returns pointers not coordinates or file text', async () => {
  const queue = new OpenQueue(); queue.enqueue('s', 'water.xyz');
  const { res, loaded } = await dispatch('/molecular-viewer/requests?sessionId=s&after=0', { queue });
  const data = JSON.parse(res.body); assert.equal(data.requests[0].path, 'water.xyz'); assert.equal(loaded.length, 0);
  assert.ok(!('content' in data.requests[0])); assert.ok(!('atoms' in data.requests[0]));
});
test('client bundle loads through installed module-loader and registers isolated extensions', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const registered = { tabs: [], viewers: [] }; let bundle;
  const sidebar = { registerTab: descriptor => { registered.tabs.push(descriptor); return () => {}; }, registerFileViewer: descriptor => { registered.viewers.push(descriptor); return () => {}; }, hostRouteUrl: path => `http://localhost/proxy/${path}`, isTabEnabled: () => true, getSnapshot: () => ({ sessionId: undefined }), subscribeState: () => () => {} };
  const sandbox = { window: { __ModuleLoader__: { load: options => { bundle = options.factory(() => ({ createElement: () => {} })); } } }, document: { hidden: false }, setInterval: () => 1, clearInterval: () => {}, TextDecoder, console, URL };
  vm.runInNewContext(source, sandbox); assert.deepEqual(Array.from(bundle.inject), ['betterSidebar']);
  bundle.apply({ betterSidebar: sidebar, effect: callback => callback() });
  assert.equal(registered.tabs[0].id, 'molecular-viewer'); assert.equal(registered.viewers[0].fetchStrategy, 'fsRead');
  assert.equal(registered.viewers[0].detect('chemistry.out', new TextEncoder().encode('O   R   C   A')), true);
  assert.equal(registered.viewers[0].detect('unrelated.log', new TextEncoder().encode('application started')), false);
  assert.ok(!registered.viewers[0].exts.includes('log'));
});
