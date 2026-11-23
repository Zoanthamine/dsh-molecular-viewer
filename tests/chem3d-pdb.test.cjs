const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../public/parsers.js');
function row(serial,element,x,{name=element,alt='',residue='',residueId=1}={}) {
  const line=Array(80).fill(' ');
  function put(start,width,value) { const text=String(value).padStart(width,' '); for(let i=0;i<width;i++)line[start+i]=text[i]; }
  put(0,6,'HETATM');put(6,5,serial);put(12,4,name.padEnd(3));put(16,1,alt);put(17,3,residue);put(22,4,residueId);
  put(30,8,Number(x).toFixed(3));put(38,8,'0.000');put(46,8,'0.000');put(76,2,element);
  return line.join('');
}
function parse(rows,connections=[]) { return P.parse([...rows,...connections,'END'].join('\n'),'synthetic.pdb'); }
test('Chem3D-style blank-altloc repeated element names are distinct atoms, not alternatives',()=>{
  const r=parse([row(1,'C',0),row(2,'C',1),row(3,'O',2),row(4,'H',3)],['CONECT    1    2','CONECT    2    3','CONECT    3    4']);
  assert.equal(r.frames[0].atoms.length,4);
  assert.deepEqual(r.frames[0].atoms.map(a=>[a.serial,a.element,a.x]),[[1,'C',0],[2,'C',1],[3,'O',2],[4,'H',3]]);
  assert.equal(r.frames[0].bonds.length,3);
  assert.ok(!r.warnings.some(w=>/duplicate atom names|unavailable\/alternate atoms/.test(w)));
});
test('Sixty synthetic repeated-name atoms retain every serial, coordinate and CONECT endpoint',()=>{
  const elements=[...Array(25).fill('C'),...Array(7).fill('O'),...Array(28).fill('H')];
  const rows=elements.map((element,i)=>row(i+1,element,i/10));
  const bonds=elements.slice(1).map((_,i)=>'CONECT'+String(i+1).padStart(5)+' '+String(i+2).padStart(4));
  const r=parse(rows,bonds).frames[0];
  assert.equal(r.atoms.length,60);assert.equal(r.bonds.length,59);
  assert.deepEqual(r.atoms.map(a=>[a.serial,a.element,a.x]),elements.map((element,i)=>[i+1,element,i/10]));
});
test('Repeated names without alternate sites also survive named residues',()=>{
  const r=parse([row(1,'C',0,{residue:'MOL'}),row(2,'C',1,{residue:'MOL'})]);
  assert.deepEqual(r.frames[0].atoms.map(a=>a.serial),[1,2]);
});
test('An unrelated alternate site must not merge shared blank repeated names',()=>{
  const r=parse([row(1,'C',1),row(2,'C',2),row(3,'N',3,{name:'N1',alt:'A'}),row(4,'N',4,{name:'N1',alt:'B'})]);
  assert.deepEqual(r.frames[0].atoms.map(a=>a.serial),[1,2,3]);
  assert.ok(r.warnings.some(w=>w.includes('one consistent label')));
});
test('Actual alternate atom sites retain consistent A selection and shared blank preference',()=>{
  const r=parse([row(1,'C',1,{name:'C1',alt:'A'}),row(2,'C',2,{name:'C1',alt:'B'}),row(3,'O',3,{name:'O1',alt:'A'}),row(4,'O',4,{name:'O1'}),row(5,'H',5)]);
  assert.deepEqual(r.frames[0].atoms.map(a=>a.serial),[1,4,5]);
});
