import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditTree } from '../scripts/audit-public.mjs';

test('public tree has curated files, no personal paths, and the validated runtime', async () => {
  const result=await auditTree();assert.ok(result.files>=30);assert.equal(result.runtimePins,4);
});
test('package has public repository identity, prebuilt DSH manifest, and portable documentation', async () => {
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,'0.2.2');assert.equal(manifest.dsh.client.inject[0],'dsh-better-sidebar');
  assert.equal(manifest.dsh.bundle.patch,'./cordis.patch.yml');assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-tools'].includes('0.2.2-rc.2'));
  assert.ok(manifest.files.includes('docs/AGENT-INTEGRATION.md'));assert.ok(!manifest.files.includes('docs/'));
});
