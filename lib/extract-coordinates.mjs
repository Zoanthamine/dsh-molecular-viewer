/* Authorized host CLI, not an unrestricted DSH HTTP/tool filesystem endpoint. */
import { createRequire } from 'node:module';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveQueuedPath } from './host-core.mjs';
const P = createRequire(import.meta.url)('../public/parsers.js');
const MAX_BYTES = 32 * 1024 * 1024;
async function noLinks(path, absentTarget = false) {
 let current = absentTarget ? dirname(path) : path;
 while (true) {
  const st = await lstat(current);
  if (st.isSymbolicLink()) throw new Error('Links/junctions are not accepted as coordinate IO paths');
  const next = dirname(current); if (next === current) break; current = next;
 }
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export async function extractCoordinates({ input, output, frame = 'all', format, cwd = process.cwd() }) {
 const path = resolveQueuedPath(input, cwd); await noLinks(path);
 const before = await lstat(path);
 if (!before.isFile() || before.size > MAX_BYTES) throw new Error('Source must be a regular text file at most 32 MiB; no implicit large-file bypass');
 const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
 let bytes;
 try {
  const actual = await fd.stat();
  if (!actual.isFile() || actual.size > MAX_BYTES || actual.ino !== before.ino || actual.dev !== before.dev) throw new Error('Source changed during access');
  bytes = await fd.readFile();
  const stable = await fd.stat();
  if (stable.size !== actual.size || stable.mtimeMs !== actual.mtimeMs || stable.ctimeMs !== actual.ctimeMs || bytes.length !== stable.size) throw new Error('Source changed while reading; no derived output written');
 } finally { await fd.close(); }
 if (bytes.length > MAX_BYTES) throw new Error('Source exceeded the read limit');
 const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
 const parsed = P.parse(text, basename(path), { ...(format ? { format } : {}), limits: { maxBytes: MAX_BYTES, maxAtoms: 10000, maxFrames: 500, maxTotalAtoms: 100000 } });
 const indices = P.selectFrames(parsed, frame);
 const summary = {
  status: output ? 'extracted' : 'inspected', source: path, sourceSha256: hash(bytes), format: parsed.format,
  frameCount: parsed.frames.length, selectedFrames: indices.map(i => i + 1), atomCounts: indices.map(i => parsed.frames[i].atoms.length),
  frames: parsed.frames.slice(0, 50).map((f,i) => ({ frame: i + 1, atoms: f.atoms.length, sourceUnits: f.metadata.sourceUnits, lineStart: f.metadata.lineStart, optimizationStep: f.metadata.optimizationStep, optimizationConverged: f.metadata.optimizationConverged, charge: f.metadata.charge, multiplicity: f.metadata.multiplicity })),
  summaryTruncated: parsed.frames.length > 50, warnings: parsed.warnings.slice(0, 20), warningsCount: parsed.warnings.length, rendered: false,
  lastConfirmedConvergedFrame: parsed.frames.reduce((last, f, i) => f.metadata.optimizationConverged === true ? i + 1 : last, null),
  limitations: 'Explicit coordinate/convergence evidence only; no energy ranking, minimum/TS validation or generation. XYZ loses bond orders, isotopes and per-atom properties.'
 };
 if (output !== undefined) {
  const target = resolveQueuedPath(output, cwd);
  if (target === path) throw new Error('Output cannot be the source');
  if (!/\.xyz$/i.test(target)) throw new Error('Derived output must be an explicit .xyz path');
  await noLinks(target, true);
  const xyz = P.toXYZ(parsed, frame, { sourceName: basename(path), sourceSha256: summary.sourceSha256 });
  // wx is atomic no-clobber: no existing original or derived file is overwritten.
  const out = await open(target, 'wx');
  try { await out.writeFile(xyz, 'utf8'); } finally { await out.close(); }
  summary.output = target; summary.outputSha256 = hash(Buffer.from(xyz));
 }
 return summary;
}
function argumentsOf(argv) {
 const args = {};
 for (let i=0;i<argv.length;i++) {
  const key=argv[i]; if (!['--input','--output','--frame','--format'].includes(key) || args[key.slice(2)] !== undefined || !argv[i+1] || argv[i+1].startsWith('--')) throw new Error('Usage: node extract-coordinates.mjs --input FILE [--frame all|first|last|last-converged|N] [--format FORMAT] [--output NEW.xyz]');
  args[key.slice(2)] = argv[++i];
 }
 if (!args.input) throw new Error('--input is required');
 return args;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try { console.log(JSON.stringify(await extractCoordinates(argumentsOf(process.argv.slice(2))))); }
 catch (error) { console.error(JSON.stringify({ status:'error', code:error.code || 'EXTRACTION_FAILED', message:error.message, rendered:false })); process.exitCode=1; }
}
