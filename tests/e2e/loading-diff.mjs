// Pixelmatch comparison at the lane's standard threshold, with raw changes retained.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require=createRequire(import.meta.url);
const {utils}=require(join(dirname(require.resolve('playwright-core/package.json')),'lib/coreBundle.js'));
const compare=utils.getComparator('image/png');
const root=process.env.R4_SHOTS || '/home/bryant/work/tca/refactor-shots/r4';
const allowed=new Set(['form-empty-1440.png','form-empty-390.png']);
const results=[];
for(const file of readdirSync(`${root}/before`).filter(file=>file.endsWith('.png'))) {
 const before=await sharp(readFileSync(`${root}/before/${file}`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const after=await sharp(readFileSync(`${root}/after/${file}`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const sameSize=before.info.width===after.info.width&&before.info.height===after.info.height;
 let changedPixels=0;
 if(sameSize)for(let i=0;i<before.data.length;i+=4)if(!before.data.subarray(i,i+4).equals(after.data.subarray(i,i+4)))changedPixels++;
 const mismatch=compare(readFileSync(`${root}/after/${file}`),readFileSync(`${root}/before/${file}`),{threshold:0.1,maxDiffPixels:0});
 results.push({file,sameSize,changedPixels,pixelmatchPass:!mismatch,allowedNewEmptyState:allowed.has(file)});
}
writeFileSync(`${root}/settled-pixel-diff.json`,JSON.stringify(results,null,2));
assert.ok(results.length);
assert.ok(results.every(row=>row.allowedNewEmptyState || row.sameSize&&row.pixelmatchPass),JSON.stringify(results.filter(row=>!row.allowedNewEmptyState&&(!row.sameSize||!row.pixelmatchPass))));
console.log(`${results.length-allowed.size} settled screenshots: zero pixelmatch differences (threshold 0.1). ${allowed.size} explicitly added empty-state screenshots differ.`);
