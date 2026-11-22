import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { OpenQueue, resolveQueuedPath } from '../lib/host-core.mjs';

test('host tool uses installed DSH value-schema shape and authoritative live cwd', async () => {
  let tool;
  const cwd = resolve('live-cwd');
  const ctx = { effect: fn => fn(), get: name => name === 'workingDirectory' ? { get: () => cwd } : undefined,
    webServer: { register: () => () => {} }, tools: { register: t => { tool = t; return () => {}; } } };
  const source = (await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replace(/^export /gm, '').replace("new URL('../public/', import.meta.url)", "new URL('file:///public/')");
  vm.runInNewContext(source + '\napply(ctx);', { ctx, URL, OpenQueue, resolveQueuedPath, createRoute: () => ({}), defineTool: t => t });
  assert.ok(!Object.hasOwn(tool.output.schema, 'required'));
  assert.equal(tool.output.schema.additionalProperties, false);
  for (const field of Object.values(tool.output.schema.properties)) assert.equal(field.required, true);
  const result = await tool.execute({ path: 'sample.xyz' }, { signal: new AbortController().signal, agent: { session: { id: 's', header: { cwd: resolve('obsolete-cwd') } } } });
  assert.equal(result.path, resolve(cwd, 'sample.xyz')); assert.equal(result.status, 'queued'); assert.equal(result.rendered, false);
  assert.ok(!Object.hasOwn(result, 'content'));
});
