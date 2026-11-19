// Compare the full-page characterization captures without adding a pixelmatch dependency.
// Playwright bundles pixelmatch; use its comparator with pixelmatch's default 0.1 threshold.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
const require=createRequire(import.meta.url);
const {utils}=require(join(dirname(require.resolve('playwright-core/package.json')),'lib/coreBundle.js'));
const compare=utils.getComparator('image/png');
const root=process.env.R3_SHOTS || '/home/bryant/work/tca/refactor-shots/r3';
const results=[];
for(const file of readdirSync(join(root,'before')).filter(f=>f.endsWith('.png'))){
 const before=readFileSync(join(root,'before',file)),after=readFileSync(join(root,'after',file));
 const a=await sharp(before).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const b=await sharp(after).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const sameSize=a.info.width===b.info.width&&a.info.height===b.info.height;
 let rawChanged=0,maxChannelDelta=0;
 if(sameSize)for(let i=0;i<a.data.length;i+=4){
  let changed=false;
  for(let c=0;c<4;c++){const delta=Math.abs(a.data[i+c]-b.data[i+c]);if(delta)changed=true;maxChannelDelta=Math.max(maxChannelDelta,delta);}
  if(changed)rawChanged++;
 }
 const mismatch=compare(after,before,{threshold:0.1,maxDiffPixels:0});
 results.push({file,sameSize,pixelmatchPass:!mismatch,rawChanged,maxChannelDelta,...(mismatch?{error:mismatch.errorMessage}:{})});
}
writeFileSync(join(root,'pixel-diff.json'),JSON.stringify({threshold:0.1,maxDiffPixels:0,results},null,2));
console.log(JSON.stringify({pairs:results.length,pixelmatchFailures:results.filter(r=>!r.pixelmatchPass),rawChanged:results.reduce((sum,r)=>sum+r.rawChanged,0),maxChannelDelta:Math.max(...results.map(r=>r.maxChannelDelta))},null,2));
assert.ok(results.length&&results.every(r=>r.pixelmatchPass),'Screenshot parity failed');
