import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const P = createRequire(import.meta.url)('../public/parsers.js');
const gaussian = x => ` Standard orientation:\n -----\n Center Atomic Atomic Coordinates (Angstroms)\n Number Number Type X Y Z\n -----\n 1 6 0 ${x} 0 0\n -----\n`;
test('Gaussian explicit step labels only its preceding geometry; later frames do not inherit convergence', () => {
 const parsed = P.parse(gaussian(0)+' Step number 1 out of a maximum of 50\n Optimization completed.\n'+gaussian(1),'trajectory.log');
 assert.equal(parsed.frames[0].metadata.optimizationStep,1); assert.equal(parsed.frames[1].metadata.optimizationStep,undefined);
 assert.equal(parsed.frames[0].metadata.optimizationConverged,true); assert.equal(parsed.frames[1].metadata.optimizationConverged,null);
 assert.deepEqual(P.selectFrames(parsed,'last-converged'),[0]); assert.deepEqual(P.selectFrames(parsed,'last'),[1]);
});
test('ORCA cycle labels are explicit and cease after convergence, not inherited by later single-point geometry', () => {
 const block = 'CARTESIAN COORDINATES (ANGSTROEM)\n----\nC 0 0 0\n\n';
 const parsed = P.parse('O R C A\nGEOMETRY OPTIMIZATION CYCLE 2\n'+block+'THE OPTIMIZATION HAS CONVERGED\n'+block,'trajectory.out');
 assert.equal(parsed.frames[0].metadata.optimizationStep,2); assert.equal(parsed.frames[1].metadata.optimizationStep,null);
 assert.equal(parsed.frames[1].metadata.optimizationConverged,null);
});
async function playback() {
 const source = await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const code = source.slice(source.indexOf('  let trajectoryTimer'),source.indexOf('  function removeFile('));
 const listeners = {}, nodes = {}, rendered = []; let callback = null;
 const file = {frames:Object.freeze([Object.freeze({}),Object.freeze({}),Object.freeze({})])};
 const state = {model:{},busy:false,error:null,frameIndex:0};
 function node(id) { return nodes[id] ||= {value:'3',addEventListener:(type,fn)=>{listeners[id+':'+type]=fn;},getBoundingClientRect:()=>({width:500})}; }
 const document = {hidden:false,addEventListener:(type,fn)=>{listeners['document:'+type]=fn;}};
 const context={state,currentFile:()=>file,$:node,document,window:{addEventListener:(type,fn)=>{listeners['window:'+type]=fn;}},updateUI(){},status(){},renderFrame:fit=>rendered.push({index:state.frameIndex,fit}),setInterval:fn=>{callback=fn;return 1;},clearInterval:()=>{callback=null;}};
 vm.runInNewContext(code+'\nthis.api={startTrajectory,stopTrajectory,isPlaying:()=>trajectoryTimer!==null};',context);
 return {state,file,document,listeners,rendered,api:context.api,tick:()=>callback?.(),nodes};
}
test('trajectory advances bounded original frames without fitting/alignment and stops at the end',async()=>{
 const p=await playback(); p.api.startTrajectory(); assert.equal(p.api.isPlaying(),true);
 p.tick(); assert.equal(p.state.frameIndex,1); p.tick(); assert.equal(p.state.frameIndex,2); assert.equal(p.api.isPlaying(),false);
 assert.deepEqual(p.rendered,[{index:1,fit:false},{index:2,fit:false}]); assert.equal(p.file.frames.length,3);
 p.api.startTrajectory(); assert.equal(p.state.frameIndex,0); p.api.stopTrajectory(); assert.equal(p.api.isPlaying(),false);
});
test('hidden page pauses trajectory and UI events expose explicit play/pause',async()=>{
 const p=await playback(); p.listeners['trajectoryPlay:click'](); assert.equal(p.api.isPlaying(),true);
 p.document.hidden=true; p.listeners['document:visibilitychange'](); assert.equal(p.api.isPlaying(),false);
 p.document.hidden=false; p.listeners['trajectoryPlay:click'](); p.listeners['trajectoryPlay:click'](); assert.equal(p.api.isPlaying(),false);
});
