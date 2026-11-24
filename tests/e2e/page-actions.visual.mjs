// Full-page R1 parity at both responsive widths. Use an unchanged seeded DB for both runs.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { db, dbReady, guardianForms, listAdminForms } from '@tca/school';
import sharp from 'sharp';
const stage=process.argv[2]; assert.ok(['before','after','diff'].includes(stage));
const root=process.env.R1_SHOTS || '/home/bryant/work/tca/refactor-shots/r1';
if(stage==='diff') {
 const manifest=JSON.parse(readFileSync(join(root,'before/manifest.json'),'utf8')); const results=[];
 for(const file of manifest) {
  const a=await sharp(join(root,'before',file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const b=await sharp(join(root,'after',file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let pixels=0;
  if(a.info.width!==b.info.width||a.info.height!==b.info.height) pixels=-1;
  else for(let i=0;i<a.data.length;i+=4) if(!a.data.subarray(i,i+4).equals(b.data.subarray(i,i+4))) pixels++;
  results.push({file,pixels,before:[a.info.width,a.info.height],after:[b.info.width,b.info.height]});
 }
 writeFileSync(join(root,'diff.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify({screens:results.length,changed:results.filter(r=>r.pixels!==0)},null,2));
 process.exitCode=results.some(r=>r.pixels!==0)?1:0;
} else {
 const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4441'; assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
 const seed=JSON.parse(readFileSync('/tmp/tca-e2e-seed.json','utf8')); await dbReady();
 const assignment=(await guardianForms(seed.ada.id))[0]; const form=(await listAdminForms())[0];
 const routes=[
 ['office','admin-tours','/admin/tours'],['office','admin-tours-add','/admin/tours?sheet=add'],['office','admin-tours-requests','/admin/tours?tab=requests'],
 ['office','admin-events','/admin/events'],['office','admin-events-new','/admin/events?sheet=new'],
 ['office','admin-documents','/admin/documents'],['office','admin-documents-upload','/admin/documents?sheet=upload'],['office','admin-documents-forms','/admin/documents?tab=forms'],
 ['office','admin-staff','/admin/people'],['office','admin-staff-invite','/admin/people?sheet=invite'],
 ['office','admin-website','/admin/website'],['office','admin-website-announcements','/admin/website?tab=announcements'],
 ['office','admin-families-id',`/admin/families/${seed.ada.id}`],['office','admin-families-student',`/admin/families/${seed.ada.id}?sheet=student`],
 ['office','admin-inquiries','/admin/inquiries'],['office','admin-prospects-id',`/admin/prospects/${seed.pat.id}`],['office','admin-forms-id',`/admin/forms/${form.id}`],
 ['ada','account','/account'],['ada','account-name','/account?dialog=name'],['ada','guardian-form',`/g/forms/${assignment.id}`],
 ['pat','tour','/tour'],['pat','tour-other','/tour?other=1'],['pat','events','/events'],['ada','rsvp','/rsvp/ec99c6a0-30da-4b66-8ccb-777c05360f4b'],
 ['none','interested','/interested'],['none','interview','/interview'],
 ];
 await db().end(); mkdirSync(join(root,stage),{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox']}); const manifest=[];
 try { for(const width of [1440,390]) {
  const contexts=new Map();
  for(const [role,name,path] of routes) {
   let context=contexts.get(role); if(!context) {context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'}); if(seed.cookies[role]) await context.addCookies([{name:'tca_family_session',value:seed.cookies[role],url:base}]); contexts.set(role,context);}
   const page=await context.newPage(); const response=await page.goto(base+path,{waitUntil:'networkidle'}); assert.equal(response.status(),200,path);
   await page.evaluate(()=>document.fonts.ready); const file=`${name}-${width}.png`; await page.screenshot({path:join(root,stage,file),fullPage:true,animations:'disabled',caret:'hide'}); manifest.push(file); await page.close(); console.log(stage,file);
  }
  for(const context of contexts.values()) await context.close();
 }} finally {await browser.close();}
 writeFileSync(join(root,stage,'manifest.json'),JSON.stringify(manifest,null,2));
}
