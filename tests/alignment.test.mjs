import {align,mapProgress,alignedErrors} from '../public/assets/alignment.js';
import assert from 'node:assert/strict';
const signal=(count,stretch=1)=>({frames:Array.from({length:count},(_,i)=>{const phase=i/(count-1);return {t:i*.01*stretch,rms:.1+.2*Math.sin(Math.PI*phase),f0:300+100*phase,centroid:1000+300*phase,bands:Array(32).fill(phase)};})});
const a=signal(90),b=signal(150,1.4);const result=align(a,b);assert.equal(result.correspondence.length,90);assert.ok(result.path.length>=150);assert.ok(result.normalizedCost<.15);assert.ok(Math.abs(mapProgress(result,.5)-.5)<.15);assert.ok(alignedErrors(result).length<10);
const changed=signal(90);for(let i=40;i<55;i++)changed.frames[i].f0*=1.8;const errors=alignedErrors(align(a,changed));assert.ok(errors.some(e=>e.kind==='pitch'&&e.at>.35&&e.at<.7));console.log('DTW alignment tests passed');
