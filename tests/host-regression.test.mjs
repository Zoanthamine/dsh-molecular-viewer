import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolveQueuedPath, OpenQueue } from '../lib/host-core.mjs';

test('relative queued paths are fixed to authoritative cwd before later UI changes', () => {
  const cwd = resolve('fixtures');
  const result = resolveQueuedPath('structure.xyz', cwd);
  assert.equal(result, resolve(cwd, 'structure.xyz'));
  assert.notEqual(result, resolve('changed-directory', 'structure.xyz'));
  assert.equal(resolveQueuedPath(result), result);
  assert.throws(() => resolveQueuedPath('relative.xyz'));
  assert.throws(() => resolveQueuedPath('https://example.org/private.xyz', cwd));
  assert.throws(() => resolveQueuedPath('file:///private.xyz', cwd));
  assert.throws(() => resolveQueuedPath('bad\u0000.xyz', cwd));
});

test('delivered queue cursors release capacity without claiming rendering', () => {
  const queue = new OpenQueue(); let cursor = 0;
  for (let i = 0; i < 100; i++) {
    queue.enqueue('s', `frame-${i}.xyz`);
    const next = queue.since('s', cursor);
    assert.equal(next.length, 1); cursor = next[0].sequence;
    assert.ok(!('rendered' in next[0]));
  }
  assert.equal(queue.since('s', cursor).length, 0);
});

test('iframe reload resets readiness and increments load generation', async () => {
  const state = [], refs = [], messages = []; let bundle, pane;
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => { const i = state.length; state.push(initial); return [initial, value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef: initial => { const ref = { current: initial }; refs.push(ref); return ref; },
    useEffect: () => {}
  };
  const sidebar = { registerTab: d => { pane = d.component; return () => {}; }, registerFileViewer: () => () => {}, hostRouteUrl: p => `http://localhost/${p}`, isTabEnabled: () => false, getSnapshot: () => ({}), subscribeState: () => () => {} };
  const sandbox = { window: { __ModuleLoader__: { load: config => { bundle = config.factory(() => React); } } }, document: { hidden: true }, location: { href: 'http://localhost/' }, console, URL, TextDecoder, setInterval: () => 1, clearInterval: () => {}, clearTimeout: () => {} };
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox);
  bundle.apply({ betterSidebar: sidebar, effect: fn => fn() });
  const view = pane({}); const iframe = view.children.find(child => child?.type === 'iframe');
  refs[0].current = { contentWindow: { postMessage: data => messages.push(data) } };
  state[0] = true;
  iframe.props.onLoad();
  assert.equal(state[0], false); assert.equal(state[1], 1);
  assert.equal(messages[0].type, 'dsh-molecule:ping');
  iframe.props.onLoad(); assert.equal(state[1], 2);
});
