import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { extractCoordinates } from '../lib/extract-coordinates.mjs';
import { OpenQueue, normalizeFrameSelector } from '../lib/host-core.mjs';
const P=createRequire(import.meta.url)('../public/parsers.js');
const two='2\nsynthetic first\nO 0 0 0\nH 0 0 1\n2\nsynthetic last\nO 0 0 0\nH 0 0 2\n';
test('agent extraction exports selected coordinates, source stays immutable and summary has no coordinate arrays', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-molecule-extract-'));
 try {
  const input=join(dir,'two.xyz'), output=join(dir,'last.xyz'); await writeFile(input,two);
  const info=await extractCoordinates({input,output,frame:'last'}); const parsed=P.parse(await readFile(output,'utf8'),'last.xyz');
  assert.equal(info.status,'extracted'); assert.equal(info.rendered,false); assert.deepEqual(info.selectedFrames,[2]); assert.equal(parsed.frames[0].atoms[1].z,2); assert.equal(await readFile(input,'utf8'),two); assert.ok(!JSON.stringify(info).includes('"x":'));
  assert.equal(info.outputSha256.length,64); assert.equal(info.sourceSha256.length,64);
  await assert.rejects(()=>extractCoordinates({input,output,frame:'first'}),e=>e.code==='EEXIST'); assert.equal(P.parse(await readFile(output,'utf8'),'x.xyz').frames[0].atoms[1].z,2);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('inspection is read-only; absent explicit convergence, source-as-output and remote paths fail',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-molecule-inspect-'));
 try {
  const input=join(dir,'two.xyz'); await writeFile(input,two); const info=await extractCoordinates({input,frame:'all'}); assert.equal(info.status,'inspected'); assert.equal(info.output,undefined);
  await assert.rejects(()=>extractCoordinates({input,frame:'last-converged'}),e=>e.code==='NO_CONFIRMED_CONVERGENCE'); await assert.rejects(()=>extractCoordinates({input,output:input})); await assert.rejects(()=>extractCoordinates({input:'https://example.org/a.xyz'})); await assert.rejects(()=>extractCoordinates({input:'//server/a.xyz'}));
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('queue carries validated selector only, with no file content or rendered claim',()=>{
 const q=new OpenQueue(); const r=q.enqueue('s','a.fchk','checkpoint','last'); assert.equal(r.frame,'last'); assert.equal(r.content,undefined);
 assert.equal(normalizeFrameSelector('2'),'2'); for(const f of ['0','-1','junk','999999999999999999999']) assert.throws(()=>q.enqueue('s','a.inp','x',f));
});
