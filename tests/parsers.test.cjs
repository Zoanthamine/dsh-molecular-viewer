'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../public/parsers.js');
const close = (a,b,tol=1e-9) => assert.ok(Math.abs(a-b)<tol, `${a} != ${b}`);
const bad = (f, code) => assert.throws(f, e => e instanceof P.MoleculeParseError && (!code || e.code === code));
function mol(name='water', atoms=[['O',0,0,0],['H',1,0,0],['H',0,1,0]], bonds=[[1,2,1],[1,3,1]], tail='') {
  const coord = n => n.toFixed(4).padStart(10);
  return [name,'generated test','',String(atoms.length).padStart(3)+String(bonds.length).padStart(3)+'  0  0  0  0            999 V2000',
    ...atoms.map(a => a.slice(1).map(coord).join('')+' '+a[0].padEnd(3)+' 0  0  0  0  0  0'),
    ...bonds.map(b => b.map(x=>String(x).padStart(3)).join('')+'  0  0  0  0'), tail,'M  END'].filter((l,i)=>i!==4+atoms.length+bonds.length || tail).join('\n');
}
function pdb(serial,name,el,x=0,{alt='',res=1,occ=1,charge=''}={}) {
  const a = Array(80).fill(' '); const put=(offset,s)=>{ for(let i=0;i<s.length;i++)a[offset+i]=s[i]; };
  put(0,'ATOM  '); put(6,String(serial).padStart(5));put(12,name.padEnd(4));put(16,alt);put(17,'ALA');put(21,'A');put(22,String(res).padStart(4));
  put(30,x.toFixed(3).padStart(8));put(38,'0.000'.padStart(8));put(46,'0.000'.padStart(8));put(54,occ.toFixed(2).padStart(6));put(60,'0.00'.padStart(6));put(76,el.padStart(2));put(78,charge);return a.join('');
}
function orientation(type='Standard',x=0,z=8) {
  return ` ${type} orientation:\n -------------------------------------------\n Center Atomic Atomic Coordinates (Angstroms)\n Number Number Type X Y Z\n -------------------------------------------\n 1 ${z} 0 ${x} 0.0 0.0\n 2 1 0 1.0 0.0 0.0\n -------------------------------------------\n`;
}
function orca(units='ANGSTROEM',row='O 0.0 0.0 0.0') { return `CARTESIAN COORDINATES (${units})\n--------------------------------\n${units==='A.U.'?'NO LB ZA FRAG MASS X Y Z\n':''}${row}\n\n`; }
const water = fs.readFileSync(path.join(__dirname,'../fixtures/parsers-water.xyz'),'utf8');
test('XYZ multiframe fixture preserves names, Å and zero-based metadata',()=>{
  const r=P.parse(water,'water.xyz');assert.equal(r.format,'xyz');assert.equal(r.frames.length,2);assert.equal(r.frames[1].name,'water translated');close(r.frames[1].atoms[0].x,1);assert.deepEqual(r.frames[0].bonds,[]);assert.equal(r.frames[0].metadata.atomIndices,'0-based');assert.ok(r.warnings.some(w=>w.includes('bond orders')));
});
test('XYZ atomic numbers, uppercase elements, CRLF, BOM and Fortran exponents',()=>{
  const r=P.parse('\uFEFF2\r\nx\r\n17 1D-1 2d0 -3.0\r\nHE 0 0 0\r\n','x.xyz');assert.equal(r.frames[0].atoms[0].element,'Cl');close(r.frames[0].atoms[0].x,.1);assert.equal(r.frames[0].atoms[1].element,'He');
});
test('XYZ does not swallow a bad second frame',()=>bad(()=>P.parse(water+'2\nbad\nH 0 0 0\n','x.xyz')));
test('XYZ missing comment/atom, empty frame and invalid element rejected',()=>{
  for(const s of ['1','1\nx\n','0\nx\n','1\nx\nBq 0 0 0','1\nx\n119 0 0 0','1\nx\n0 0 0 0'])bad(()=>P.parse(s,'x.xyz'));
});
test('XYZ rejects NaN, Infinity, hex, missing and enormous coordinates',()=>{
  for(const x of ['NaN','Infinity','0x10','1e999','1000001'])bad(()=>P.parse(`1\nx\nC ${x} 0 0`,'x.xyz'));
});
test('XYZ extra columns warns but never executes them',()=>{
  global.__parserExecuted=0;const r=P.parse('1\nx\nH 0 0 0 global.__parserExecuted=1','x.xyz');assert.equal(global.__parserExecuted,0);assert.ok(r.warnings.some(w=>w.includes('Extra')));delete global.__parserExecuted;
});
test('nested limits match UI contract, and UTF8 byte limit is enforced',()=>{
  bad(()=>P.parse(water,'x.xyz',{limits:{maxAtoms:2}}),'LIMIT_EXCEEDED');bad(()=>P.parse(water,'x.xyz',{limits:{maxFrames:1}}),'LIMIT_EXCEEDED');bad(()=>P.parse(water,'x.xyz',{limits:{maxTotalAtoms:5}}),'LIMIT_EXCEEDED');bad(()=>P.parse('1\n汉字\nH 0 0 0','x.xyz',{limits:{maxBytes:15}}),'LIMIT_EXCEEDED');
  assert.equal(P.parse(water,'x.xyz',{limits:{maxAtoms:10000,maxFrames:500,maxTotalAtoms:6,maxBytes:10000}}).frames.length,2);
});
test('invalid and hard-ceiling options reject',()=>{
  for(const v of [0,-1,Infinity,NaN,1.5,999999999])bad(()=>P.parse(water,'x.xyz',{limits:{maxFrames:v}}),'INVALID_ARGUMENT');bad(()=>P.parse(water,'x.xyz',{limits:{unexpected:1}}),'INVALID_ARGUMENT');
});
test('SDF/MOL V2000 bonds are explicit zero-based, charge overrides are recorded',()=>{
  const r=P.parse(mol('water',undefined,undefined,'M  CHG  1   1  -1'),'water.mol');assert.equal(r.frames[0].atoms[0].charge,-1);assert.deepEqual(r.frames[0].bonds.map(b=>[b.from,b.to,b.order]),[[0,1,1],[0,2,1]]);assert.ok(r.warnings.some(w=>w.includes('may be 2D')));assert.equal(r.frames[0].metadata.planarCoordinates,true);
});
test('V2000 supports explicit double/triple/aromatic bonds and isotope/radical properties',()=>{
  for(const order of [2,3,4])assert.equal(P.parse(mol('x',[['C',0,0,0],['C',0,0,1]],[[1,2,order]]),'x.mol').frames[0].bonds[0].order,order);
  const r=P.parse(mol('x',undefined,undefined,'M  ISO  1   1  18\nM  RAD  1   1   2'),'x.mol');assert.equal(r.frames[0].atoms[0].isotope,18);assert.equal(r.frames[0].atoms[0].radicalCode,2);
});
test('SDF preserves multiple records and safe untrusted properties',()=>{
  const s=mol('one')+'\n> <__proto__>\nnot code\n\n$$$$\n'+mol('two')+'\n$$$$\n';const r=P.parse(s,'x.sdf');assert.equal(r.frames.length,2);assert.equal(r.frames[0].metadata.properties.__proto__,'not code');assert.equal(Object.getPrototypeOf(r.frames[0].metadata.properties),null);assert.equal(r.frames[1].name,'two');
});
test('SDF planar warning is cautious; nonplanar supplied coordinates not flagged',()=>{
  const r=P.parse(mol('x',[['C',0,0,1]],[]),'x.mol');assert.equal(r.frames[0].metadata.planarCoordinates,false);assert.ok(!r.warnings.some(w=>w.includes('may be 2D')));
});
test('SDF rejects V3000/query bonds, invalid indices and incomplete end/table',()=>{
  bad(()=>P.parse(mol().replace('V2000','V3000'),'x.mol'),'UNSUPPORTED_FORMAT');
  for(const bs of [[[1,2,8]],[[0,2,1]],[[1,4,1]],[[1,1,1]],[[1,2,1],[2,1,1]]])bad(()=>P.parse(mol('x',undefined,bs),'x.mol'));
  bad(()=>P.parse(mol().replace('M  END',''),'x.mol'));bad(()=>P.parse(mol().replace('  3  2',' 99  2'),'x.mol'));
});
test('SDF bad second record and empty middle record are never discarded',()=>{
  bad(()=>P.parse(mol()+'\n$$$$\nbad\n$$$$','x.sdf'));bad(()=>P.parse(mol()+'\n$$$$\n$$$$','x.sdf'));bad(()=>P.parse(mol()+'\n$$$$\n'+mol(),'x.mol'));
});
test('PDB MODEL frames, CONECT and charge fields',()=>{
  const a=pdb(1,' O  ','O',0,{charge:'1-'}),b=pdb(2,' H  ','H',1);const s=`MODEL        1\n${a}\n${b}\nENDMDL\nMODEL        2\n${a}\n${b}\nENDMDL\nCONECT    1    2    2\nCONECT    2    1\nEND\n`;const r=P.parse(s,'x.pdb');assert.equal(r.frames.length,2);assert.equal(r.frames[0].metadata.modelId,1);assert.equal(r.frames[0].atoms[0].charge,-1);assert.deepEqual(r.frames[0].bonds,[{from:0,to:1,order:2}]);
});
test('PDB model-specific CONECT must not leak into another model',()=>{
  const atoms=[pdb(1,' O  ','O'),pdb(2,' H1 ','H'),pdb(3,' H2 ','H')].join('\n');const s=`MODEL        1\n${atoms}\nCONECT    1    2\nENDMDL\nMODEL        2\n${atoms}\nCONECT    1    3\nENDMDL\n`;const r=P.parse(s,'x.pdb');assert.deepEqual(r.frames[0].bonds,[{from:0,to:1,order:1}]);assert.deepEqual(r.frames[1].bonds,[{from:0,to:2,order:1}]);
});
test('PDB fallback distinguishes alpha carbon, calcium, chlorine and digit-prefixed H',()=>{
  const s=[pdb(1,' CA ','',0),pdb(2,'CA  ','',1,{res:2}),pdb(3,'CL  ','',2,{res:3}),pdb(4,'1HG1','',3,{res:4})].join('\n');const r=P.parse(s,'x.pdb');assert.deepEqual(r.frames[0].atoms.map(a=>a.element),['C','Ca','Cl','H']);assert.ok(r.warnings.some(w=>w.includes('inferred')));
});
test('PDB altloc uses one label per residue, not independently greatest occupancy',()=>{
  const s=[pdb(1,' CA ','C',1,{alt:'A',occ:.4}),pdb(2,' CA ','C',2,{alt:'B',occ:.6}),pdb(3,' CB ','C',3,{alt:'A',occ:.6}),pdb(4,' CB ','C',4,{alt:'B',occ:.4}),pdb(5,' O  ','O',5)].join('\n');const r=P.parse(s,'x.pdb');assert.deepEqual(r.frames[0].atoms.map(a=>a.x),[1,3,5]);assert.ok(r.warnings.some(w=>w.includes('consistent label')));
});
test('PDB validates even discarded alternate coordinates; incomplete models reject',()=>{
  const a=pdb(1,' C  ','C',0,{alt:'A'}),b=pdb(2,' C  ','C',1,{alt:'B'}).slice(0,30)+'     NaN'+pdb(2,' C  ','C',1,{alt:'B'}).slice(38);bad(()=>P.parse(a+'\n'+b,'x.pdb'));
  for(const s of [`MODEL        1\n${a}`,`ENDMDL\n${a}`,`${a}\nMODEL        1\nENDMDL`,`MODEL        1\n${a}\nMODEL        2`])bad(()=>P.parse(s,'x.pdb'));
});
test('PDB element column is authoritative, invalid serial/occupancy rejected',()=>{
  assert.equal(P.parse(pdb(1,' CA ','Fe'),'x.pdb').frames[0].atoms[0].element,'Fe');bad(()=>P.parse(pdb(1,' C  ','Xx'),'x.pdb'));bad(()=>P.parse(pdb(1,' C  ','C')+'\n'+pdb(1,' O  ','O'),'x.pdb'));bad(()=>P.parse(pdb(1,' C  ','C',0,{occ:1.2}),'x.pdb'));
});
test('Gaussian Cartesian input, freeze, fragment metadata and units',()=>{
  const s='%chk=example.chk\n#p hf/sto-3g units=bohr\n\nTitle\n\n-1 2\nO 0 0 0 0\nH 1 0 0\n\n';const r=P.parse(s,'x.gjf');assert.equal(r.format,'gaussian-input');assert.equal(r.frames[0].metadata.charge,-1);assert.equal(r.frames[0].metadata.multiplicity,2);assert.equal(r.frames[0].atoms[0].freezeCode,0);close(r.frames[0].atoms[1].x,P.BOHR_TO_ANGSTROM);assert.equal(r.frames[0].metadata.optimizationConverged,null);
});
test('Gaussian input rejects internal coordinates, variables, ONIOM and Link1',()=>{
  const header='#p hf\n\nTitle\n\n0 1\n';for(const body of ['O\nH 1 r\n','C x 0 0\n','C 0 0 0 H\n','C 0 0 0\n\n--Link1--'])bad(()=>P.parse(header+body,'x.com'));
});
test('Gaussian Standard/Input orientation includes atomic-number mapping, not invented energy',()=>{
  const s=orientation('Input',0,17)+'SCF Done: E = -123\nOptimization completed.\n'+orientation('Standard',1);const r=P.parse(s,'x.log');assert.equal(r.format,'gaussian-output');assert.equal(r.frames.length,2);assert.equal(r.frames[0].atoms[0].element,'Cl');assert.equal(r.frames[0].metadata.optimizationConverged,true);assert.equal(r.frames[1].metadata.optimizationConverged,null);assert.equal(r.frames[1].metadata.isLastOutputFrame,true);assert.equal(r.frames[0].metadata.isLastOutputFrame,false);assert.equal(r.frames[0].metadata.energy,undefined);
});
test('Gaussian failed optimization is explicit false, not a minimum',()=>{
  const r=P.parse(orientation()+'Optimization stopped.\n','x.out');assert.equal(r.frames[0].metadata.optimizationConverged,false);assert.ok(r.warnings.some(w=>w.includes('not necessarily optimized')));
});
test('Gaussian corrupted/truncated later orientation and ghost centers fail whole parse',()=>{
  bad(()=>P.parse(orientation()+orientation().replace('1 8 0 0','1 8 0 NaN'),'x.out'));bad(()=>P.parse(orientation().split('\n').slice(0,-3).join('\n'),'x.log'));bad(()=>P.parse(orientation('Input',0,0),'x.log'));
});
test('ORCA Angstrom and AU full table normalize units, do not fabricate final convergence',()=>{
  const s=orca()+'THE OPTIMIZATION HAS CONVERGED\n'+orca('A.U.','0 O 8.0000 0 15.999 1D0 0 0');const r=P.parse(s,'x.out');assert.equal(r.format,'orca-output');assert.equal(r.frames.length,2);assert.equal(r.frames[0].metadata.optimizationConverged,true);assert.equal(r.frames[1].metadata.optimizationConverged,null);assert.equal(r.frames[1].metadata.sourceUnits,'bohr');close(r.frames[1].atoms[0].x,P.BOHR_TO_ANGSTROM);assert.equal(r.frames[1].metadata.isLastOutputFrame,true);
});
test('ORCA plain AU, failed optimization and corrupted rows',()=>{
  const r=P.parse(orca('A.U.','H 1 0 0')+'THE OPTIMIZATION DID NOT CONVERGE\n','x.log');close(r.frames[0].atoms[0].x,P.BOHR_TO_ANGSTROM);assert.equal(r.frames[0].metadata.optimizationConverged,false);
  for(const s of [orca('A.U.','0 O 6.0 0 15.999 1 0 0'),orca('ANGSTROEM','H 0 NaN 0'),orca('ANGSTROEM','H 0 0 0\njunk'),orca('ANGSTROEM','')])bad(()=>P.parse(s,'x.out'));
});
test('unknown/SMILES/CIF/ambiguous content rejected, format override works',()=>{
  for(const name of ['x.smi','x.cif','x.smiles'])bad(()=>P.parse('CCO',name),'UNSUPPORTED_FORMAT');bad(()=>P.parse('CCO','x.txt'),'UNSUPPORTED_FORMAT');bad(()=>P.parse(orientation()+orca(),'x.out'),'UNSUPPORTED_FORMAT');assert.equal(P.parse('1\nx\nH 0 0 0','x.txt',{format:'xyz'}).format,'xyz');
});
test('empty/binary/nontext input is rejected',()=>{
  bad(()=>P.parse('','x.xyz'),'EMPTY_INPUT');bad(()=>P.parse('1\nx\nH 0 0 0\0','x.xyz'));bad(()=>P.parse({},'x.xyz'),'INVALID_ARGUMENT');
});
test('measurement units, signed dihedral and zero distance',()=>{
  const a={x:1,y:0,z:0},b={x:0,y:0,z:0},c={x:0,y:1,z:0},d={x:0,y:1,z:1};close(P.measureDistance(a,b),1);close(P.measureDistance(a,a),0);close(P.measureAngle(a,b,c),90);close(P.measureDihedral(a,b,c,d),-90);close(P.measureDihedral(a,b,c,{...d,z:-1}),90);
});
test('measurements reject coincident arms, collinear dihedral and nonfinite values',()=>{
  const a={x:0,y:0,z:0},b={x:1,y:0,z:0},c={x:2,y:0,z:0};bad(()=>P.measureAngle(a,a,b),'DEGENERATE_GEOMETRY');bad(()=>P.measureDihedral(a,b,c,{x:3,y:1,z:0}),'DEGENERATE_GEOMETRY');bad(()=>P.measureDistance(a,{x:NaN,y:0,z:0}),'INVALID_ARGUMENT');bad(()=>P.measureDistance(a,[0,0,0]),'INVALID_ARGUMENT');
});
test('UMD browser export works without Node and never installs extra globals',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/parsers.js'),'utf8');const sandbox={TextEncoder};vm.runInNewContext(source,sandbox);assert.equal(typeof sandbox.MoleculeParsers.parse,'function');assert.equal(sandbox.MoleculeParsers.parse('1\nx\nH 0 0 0','x.xyz').frames.length,1);assert.deepEqual(Object.keys(sandbox).sort(),['MoleculeParsers','TextEncoder']);
});
