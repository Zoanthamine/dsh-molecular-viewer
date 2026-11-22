import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative, join } from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const excluded=new Set(['.git','node_modules','dist']);
const privateText=/(?:[A-Za-z]:[\\/]Users[\\/]|[A-Za-z]:[\\/]DSH[\\/]|LG136069|计算化学[\\/]|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
// Build this pattern without embedding a private example inside the audit itself.
const blockedNames=/(?:验收记录|preflight|compatibility_real_files|probe-real|提取示例|synthetic-multiframe)/;
function inspect(name,bytes){
  assert.ok(!name.startsWith('/')&&!name.split('/').includes('..')&&!name.includes('\\'),'unsafe artifact path');
  assert.ok(!blockedNames.test(name),'private artifact filename');
  assert.ok(!privateText.test(bytes.toString('utf8')),'personal path, calculation ID or credential in '+name);
  if(/\.(?:xyz|mol|sdf|pdb|log|out|inp|gjf|com|fchk|fch|png|jpg)$/i.test(name)) assert.equal(name,'fixtures/parsers-water.xyz','only synthetic fixture coordinates may be published');
}
async function visit(dir){let count=0;for(const ent of await readdir(dir,{withFileTypes:true})){
  if(excluded.has(ent.name)||ent.name.startsWith('offline-'))continue;
  const path=join(dir,ent.name);const name=relative(root,path).replaceAll('\\','/');
  assert.ok(!ent.isSymbolicLink(),'no links in public tree');
  if(ent.isDirectory()) count+=await visit(path);else if(ent.isFile()){let bytes=await readFile(path); if(name!=='scripts/audit-public.mjs')inspect(name,bytes);count++;}
}return count;}
export async function auditTree(){
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(manifest.version,'0.2.1');assert.ok(manifest.dsh.bundle.patch);
  assert.equal(manifest.repository.url,'git+https://github.com/Zoanthamine/dsh-molecular-viewer.git');
  for(const key of ['preinstall','install','postinstall','prepare'])assert.equal(manifest.scripts?.[key],undefined,'no installation lifecycle hooks');
  assert.ok(!manifest.files.includes('docs/'),'only explicit curated documents are packaged');
  const pins={'public/app.js':'37e140a345122ecf3b03a23b7c6a6d7e289a76c54e1bdd3885e5d43ae7f40615','public/parsers.js':'58ab0fd01b9dd4ace6b016631867ec3b0c6e1bdc0dc40f70a1ad09b6aaac35ef','public/styles.css':'e3724bf96a1398135023e356bcf59c28d09b16231ca3d1425e33bd9dfdbaa63c','public/vendor/3Dmol-min.js':'bcf422137a34b4e206413a8a83a67c24a1ace84e282bf3b164f6bda6aeb42a20'};
  for(const [path,hash] of Object.entries(pins))assert.equal(createHash('sha256').update(await readFile(join(root,path))).digest('hex'),hash,'validated runtime changed: '+path);
  return {files:await visit(root),runtimePins:Object.keys(pins).length};
}
export async function auditTarball(path){
  const plain=gunzipSync(await readFile(path),{maxOutputLength:16*1024*1024});let files=0;
  const allowed=new Set(['package.json','README.md','README.zh-CN.md','LICENSE','THIRD_PARTY_NOTICES.md','cordis.patch.yml','docs/README.md','docs/AGENT-INTEGRATION.md','lib/index.js','lib/client.js','lib/host-core.mjs','lib/extract-coordinates.mjs','public/index.html','public/app.js','public/parsers.js','public/styles.css','public/package.json','public/vendor/3Dmol-min.js','public/vendor/3Dmol-LICENSE.txt']);
  for(let off=0;off+512<=plain.length;){const h=plain.subarray(off,off+512);if(h.every(x=>x===0))break;
    let name=h.subarray(0,100).toString().replace(/\0.*$/s,'');const prefix=h.subarray(345,500).toString().replace(/\0.*$/s,'');if(prefix)name=prefix+'/'+name;
    const size=parseInt(h.subarray(124,136).toString().replace(/\0.*$/s,'').trim()||'0',8);assert.ok(Number.isSafeInteger(size)&&size>=0&&off+512+size<=plain.length);
    const type=String.fromCharCode(h[156]);assert.ok(type==='0'||type==='\0','archive may contain only regular files');
    assert.ok(name.startsWith('package/'));name=name.slice(8);assert.ok(allowed.has(name),'unexpected packaged file '+name);
    const bytes=plain.subarray(off+512,off+512+size);inspect(name,bytes);const original=await readFile(join(root,name));
    // pnpm normalizes the root manifest's whitespace and key order, not its values.
    if(name==='package.json')assert.deepEqual(JSON.parse(bytes.toString('utf8')),JSON.parse(original.toString('utf8')),'packaged manifest changed semantics');
    else assert.deepEqual(bytes,original,'archive differs from public source: '+name);
    files++;off+=512+Math.ceil(size/512)*512;
  }
  assert.equal(files,allowed.size,'missing or duplicate release entries');return {files,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(process.argv[2]?await auditTarball(process.argv[2]):await auditTree()));
