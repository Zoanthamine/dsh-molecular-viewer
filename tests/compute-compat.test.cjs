const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/parsers.js');
const fchk = 'Synthetic checkpoint\nSP RHF STO-3G\nNumber of atoms                            I                2\nCharge                                     I                0\nMultiplicity                               I                1\nAtomic numbers                             I   N=           2\n 8 1\nCurrent cartesian coordinates              R   N=           6\n 0.0 0.0 0.0 0.0 0.0 2.0\n';
const inp = '! HF def2-SVP\n* xyz 0 1\nO 0 0 0\nH 0 0 1.0\n*\n';
test('ORCA star Cartesian input keeps identity, charge and units without convergence', () => {
 const p=P.parse(inp,'water.inp'); assert.equal(p.format,'orca-input'); assert.equal(p.frames[0].atoms.length,2); assert.equal(p.frames[0].metadata.charge,0); assert.equal(p.frames[0].metadata.optimizationConverged,null);
});
test('ORCA !Bohrs and compact *xyz converts known length', () => {
 const p=P.parse(inp.replace('! HF def2-SVP','!Bohrs').replace('* xyz','*xyz'),'b.inp'); assert.equal(p.frames[0].atoms[1].z,P.BOHR_TO_ANGSTROM);
});
test('ORCA %coords explicit units, symbols and freeze marker', () => {
 const s='%coords\nCTyp xyz\nCharge -1\nMult 2\nUnits Bohrs\ncoords\nO(1) 0 0 0\nH 0 0 2$\nend\nend\n'; const f=P.parse(s,'x.inp').frames[0]; assert.equal(f.atoms[1].z,2*P.BOHR_TO_ANGSTROM); assert.deepEqual(f.atoms[1].frozenAxes,['z']); assert.equal(f.atoms[0].fragment,1); assert.equal(f.metadata.multiplicity,2);
});
test('ORCA external input is explicit, does not read another file', () => { assert.throws(()=>P.parse('* xyzfile 0 1 other.xyz','a.inp'),e=>e.code==='EXTERNAL_COORDINATES_REQUIRED'); });
test('ORCA incomplete/ambiguous/internal input refuses silently invented geometry', () => {
 for(const s of [inp.replace(/\*\n$/,''),inp+'$new_job\n', '!Bohrs Angs\n'+inp, '* int 0 1\nO\n*', '%coords\nCTyp xyz\nCharge 0\nMult 1\ncoords\nH 0 0 0\nend']) assert.throws(()=>P.parse(s,'x.inp'),e=>e.name==='MoleculeParseError');
});
test('FCHK fields and 3N Bohr coordinates are validated', () => {
 const p=P.parse(fchk,'x.fchk'), f=p.frames[0]; assert.equal(p.format,'gaussian-fchk'); assert.deepEqual(f.atoms.map(a=>a.element),['O','H']); assert.equal(f.atoms[1].z,2*P.BOHR_TO_ANGSTROM); assert.equal(f.metadata.optimizationConverged,null); assert.equal(f.metadata.multiplicity,1);
 assert.equal(P.parse(fchk,'x.fch').frames.length,1);
});
test('FCHK rejects missing, extra, inconsistent, nonfinite and ghost data', () => {
 for(const s of [fchk.replace(' 8 1',' 8 0'),fchk.replace(' 8 1',' 8'),fchk.replace(' 8 1',' 8 1 1'),fchk.replace('N=           6','N=           3'),fchk.replace('2.0','NaN'),fchk.replace('Number of atoms                            I                2','Number of atoms                            I                3'),fchk+'Atomic numbers                             I   N=           2\n8 1\n']) assert.throws(()=>P.parse(s,'x.fchk'),e=>e.name==='MoleculeParseError');
});
test('Actual binary GIF and checkpoint are not Cartesian sources', () => { assert.throws(()=>P.parse('GIF89a image','x.gif'),e=>e.code==='UNSUPPORTED_FORMAT'); assert.throws(()=>P.parse('binary\x00','x.chk')); });
test('Frame selector distinguishes explicit convergence from last output', () => {
 const p={frames:[{metadata:{optimizationConverged:true}},{metadata:{optimizationConverged:false}},{metadata:{optimizationConverged:null}}]}; assert.deepEqual(P.selectFrames(p,'last'),[2]); assert.deepEqual(P.selectFrames(p,'last-converged'),[0]); assert.deepEqual(P.selectFrames(p,'2'),[1]); assert.deepEqual(P.selectFrames(p,'all'),[0,1,2]);
 for(const s of ['0','-1','4','garbage']) assert.throws(()=>P.selectFrames(p,s)); assert.throws(()=>P.selectFrames(P.parse(fchk,'x.fchk'),'last-converged'),e=>e.code==='NO_CONFIRMED_CONVERGENCE');
});
test('XYZ export keeps coordinates and atom order with explicit lossy-topology provenance', () => {
 const p=P.parse(fchk,'x.fchk'); const xyz=P.toXYZ(p,'1',{sourceName:'x.fchk'}); const result=P.parse(xyz,'derived.xyz'); assert.deepEqual(result.frames[0].atoms,p.frames[0].atoms); const m=JSON.parse(xyz.split('\n')[1]); assert.equal(m.sourceFrame,1); assert.equal(m.sourceUnits,'bohr'); assert.equal(m.optimizationConverged,null); assert.match(m.connectivity,/does not preserve bond orders/);
});
