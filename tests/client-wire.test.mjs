import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function harness(value, frame = 'all') {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const cells = [], effects = [], pending = [], listeners = new Set(), sent = [], reads = [];
  let cursor = 0, component, bundle, tree;
  const child = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const React = {
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
    useRef(initial) { const i = cursor++; return cells[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!cells[i]) cells[i] = { value: initial }; return [cells[i].value, next => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
    useEffect(fn, deps) { const i = cursor++; const prior = effects[i]; if (!prior || deps.some((dep, j) => !Object.is(dep, prior.deps[j]))) { pending.push(() => { prior?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); } }
  };
  const sidebar = {
    registerTab: d => { component = d.component; return () => {}; }, registerFileViewer: () => () => {},
    hostRouteUrl: path => 'http://localhost/proxy/' + path,
    isTabEnabled: () => true, getSnapshot: () => ({}), subscribeState: () => () => {}
  };
  const window = { __ModuleLoader__: { load: opts => { bundle = opts.factory(() => React); } }, addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) };
  const sandbox = { window, location: { href: 'http://localhost/proxy/' }, document: { hidden: false }, URL, TextEncoder, TextDecoder, AbortController, console,
    crypto: { randomUUID: () => 'request-1' }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => { reads.push({ url, options }); return { ok: true, status: 200, json: async () => ({ ok: true, value }) }; }
  };
  vm.runInNewContext(source, sandbox);
  bundle.apply({ betterSidebar: sidebar, effect: callback => callback() });
  const props = { path: 'sample.xyz', frame, scope: { sessionId: 'initiating-session', cwd: 'C:/test' } };
  function render() { cursor = 0; tree = component(props); const iframe = tree.children.find(node => node && node.tag === 'iframe'); iframe.props.ref.current = { contentWindow: child }; while (pending.length) pending.shift()(); }
  function message(data, origin = 'http://localhost', sourceWindow = child) { for (const fn of listeners) fn({ data, origin, source: sourceWindow }); }
  async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  render();
  return { render, message, settle, sent, reads, child, text: () => tree.children.filter(node => node?.tag === 'div').map(node => node.children.join(' ')).join(' '), dispose: () => effects.forEach(effect => effect?.cleanup?.()) };
}

test('client forwards only admitted scoped text after same-origin iframe handshake and matching rendered reply', async () => {
  const text = '1\npublic wire test\nC 0 0 0\n';
  const ui = await harness({ kind: 'text', content: text, size: text.length });
  try {
    ui.message({ type: 'dsh-molecule:ready', ready: true }, 'https://untrusted.example'); ui.render(); await ui.settle(); assert.equal(ui.reads.length, 0);
    ui.message({ type: 'dsh-molecule:ready', ready: true }); ui.render(); await ui.settle();
    assert.equal(ui.reads.length, 1); assert.equal(ui.reads[0].url, 'http://localhost/proxy/sidebar/api/fs.read');
    assert.deepEqual(JSON.parse(ui.reads[0].options.body), { sessionId: 'initiating-session', cwd: 'C:/test', path: 'sample.xyz' });
    assert.equal(ui.sent.length, 1); assert.equal(ui.sent[0].data.text, text); assert.equal(ui.sent[0].origin, 'http://localhost');
    ui.message({ type: 'dsh-molecule:load-result', requestId: 'request-1', ok: true, filename: 'sample.xyz', summary: { rendered: false, atomCount: 1 } }); ui.render(); assert.ok(!ui.text().includes('已打开'));
    ui.message({ type: 'dsh-molecule:load-result', requestId: 'request-1', ok: true, filename: 'sample.xyz', summary: { rendered: true, atomCount: 1 } }); ui.render(); assert.ok(ui.text().includes('已打开：sample.xyz'));
  } finally { ui.dispose(); }
});

test('client refuses actual sidebar too-large wire shape without forwarding a partial document', async () => {
  const ui = await harness({ kind: 'too-large', size: 33554433, head: 'AA==' });
  try {
    ui.message({ type: 'dsh-molecule:ready', ready: true }); ui.render(); await ui.settle(); ui.render();
    assert.equal(ui.reads.length, 1); assert.equal(ui.sent.length, 0); assert.ok(ui.text().includes('文件内容未完整提供'));
    assert.ok(!ui.text().includes('已打开：'));
  } finally { ui.dispose(); }
});

test('agent selected frame crosses the scoped parent bridge without a coordinate reply', async () => {
  const ui = await harness({ kind: 'text', content: 'test coordinate document', size: 24 }, 'last-converged');
  try {
    ui.message({ type: 'dsh-molecule:ready', ready: true }); ui.render(); await ui.settle();
    assert.equal(ui.sent[0].data.frame, 'last-converged');
    ui.message({ type: 'dsh-molecule:load-result', requestId: 'not-the-current-request', ok: true, summary: { rendered: true, atomCount: 7, selectedFrame: 2 } });
    ui.render(); assert.ok(!ui.text().includes('已打开：'));
    ui.message({ type: 'dsh-molecule:load-result', requestId: 'request-1', ok: true, filename: 'sample.xyz', summary: { rendered: true, atomCount: 7, selectedFrame: 2 } });
    ui.render(); assert.ok(ui.text().includes('已打开：sample.xyz'));
  } finally { ui.dispose(); }
});
