// Characterization harness: record before extraction, then compare the same seeded routes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { db, listSeries, listTourSlotSummary, listEvents, listStudents, listAdminForms, formTracker } from '@tca/school';
const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4323';
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
const phase = process.env.R3_CAPTURE || 'after';
const root = process.env.R3_SHOTS || '/home/bryant/work/tca/refactor-shots/r3';
const rule = (await listSeries())[0], slot = (await listTourSlotSummary()).find(s => !s.seriesId);
const event = (await listEvents())[0], student = (await listStudents(seed.ada.id))[0];
const family = `/admin/families/${seed.ada.id}`;
const form = (await listAdminForms()).find(row => row.title === 'Photo release');
const submission = form ? (await formTracker(form.id)).rows[0] : undefined;
// Stable local-only fixtures make this harness repeatable after the normal e2e seed.
await db()`update form_assignments set status='submitted', answers=${db().json({permission:'Yes'})}, signature_name='Ada Brook', submitted_at='2026-11-19T10:00:00Z', signed_at='2026-11-19T10:00:00Z' where id=${submission.id}`;
await db()`insert into inquiries (id, name, email, source, message) values ('33333333-3333-4333-8333-333333333333', 'Characterization family', 'fixture@example.com', 'interested', 'A local characterization inquiry.') on conflict do nothing`;
const inquiry = {id:'33333333-3333-4333-8333-333333333333'};
const cases = [
 ['overview','/admin'], ['form-tracker',`/admin/forms/${form.id}`], ['form-reminder',`/admin/forms/${form.id}?remind=1`],
 ['form-submission',`/admin/forms/${form.id}?submission=${submission.id}`], ['inquiry',`/admin/inquiries?inquiry=${inquiry.id}`],
 ['signed-out-tour','/tour','signedout'], ['tours','/admin/tours'], ['add-time','/admin/tours?sheet=add'], ['edit-time',`/admin/tours?slot=${slot.id}`],
 ['series',`/admin/tours?rule=${rule.id}`], ['delete-time',`/admin/tours?slot=${slot.id}&confirm=${slot.id}`],
 ['delete-series',`/admin/tours?rule=${rule.id}&confirm=${rule.id}`],
 ['requests','/admin/tours?tab=requests'], ['reply',`/admin/tours?tab=requests&reply=${seed.tourRequest}`], ['bookings','/admin/tours?tab=bookings'],
 ['events','/admin/events'], ['new-event','/admin/events?sheet=new'], ['edit-event',`/admin/events?event=${event.id}`], ['delete-event',`/admin/events?event=${event.id}&confirm=1`],
 ['documents','/admin/documents'], ['new-document','/admin/documents?sheet=upload'], ['edit-document',`/admin/documents?doc=${seed.publicDoc}`], ['delete-document',`/admin/documents?doc=${seed.publicDoc}&confirm=1`], ['forms','/admin/documents?tab=forms'], ['new-form','/admin/documents?tab=forms&sheet=form'],
 ['website','/admin/website'], ['announcements','/admin/website?tab=announcements'], ['new-announcement','/admin/website?tab=announcements&sheet=new'],
 ['families','/admin/families'], ['family',family], ['add-student',family+'?sheet=student'], ['edit-student',family+`?student=${student.id}`], ['add-guardian',family+'?sheet=guardian'],
 ['staff','/admin/staff'], ['invite-staff','/admin/staff?sheet=invite'], ['account','/account'], ['account-name','/account?dialog=name'], ['account-password','/account?dialog=password'], ['account-add','/account?dialog=add'],
 ['tour','/tour','pat'], ['other-time','/tour?other=1','pat'],
 // Additional sheets migrated to the shared primitive.
 ['inquiries','/admin/inquiries'], ['prospects','/admin/prospects'], ['prospect',`/admin/prospects/${seed.pat.id}`], ['enroll',`/admin/prospects/${seed.pat.id}?enroll=1`],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args:['--no-sandbox','--disable-gpu','--force-color-profile=srgb'] });
try {
 for (const width of [1440,390]) {
  const context = await browser.newContext({viewport:{width,height:width===1440?1000:844}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();
  for (const [name,path,role='office'] of cases.filter(([name])=>!process.env.R3_ONLY || process.env.R3_ONLY.split(',').includes(name))) {
   await context.clearCookies();
   if(role !== 'signedout') await context.addCookies([{name:'tca_family_session',value:seed.cookies[role],url:base}]);
   const response=await page.goto(base+path,{waitUntil:'networkidle'}); assert.equal(response.status(),200,path);
   await page.evaluate(()=>document.fonts.ready);
   const dom=await page.evaluate(()=>{
    function node(el) {
     if(el.nodeType===3) return el.textContent.replace(/\s+/g,' ').trim() || null;
     if(el.nodeType!==1 || ['SCRIPT','ASTRO-ISLAND','ASTRO-SLOT'].includes(el.tagName)) {
      if(el.tagName==='ASTRO-ISLAND'||el.tagName==='ASTRO-SLOT') return [...el.childNodes].map(node).filter(Boolean);
      return null;
     }
     const attributes=[...el.attributes].map(a=>[a.name,a.value]);
     const reset=attributes.find(([key,value])=>key==='class'&&value.split(' ').includes('field-reset'));
     if(reset){reset[1]=reset[1].split(' ').filter(v=>v!=='field-reset').join(' ');attributes.push(['style','border:0;padding:0;margin:0']);}
     const attrs=attributes.map(([name,value])=>({name,value})).filter(a=>!a.name.startsWith('data-astro')&&!a.name.startsWith('data-instant-dialog')&&!a.name.startsWith('data-dialog')&&!['tabindex'].includes(a.name)).map(a=>[a.name,el.name==='csrf'&&a.name==='value'?'CSRF':a.value]).sort();
     const computed=el.tagName==='FIELDSET'?Object.fromEntries(['borderTopWidth','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','minWidth'].map(key=>[key,getComputedStyle(el)[key]])):null;
     return [el.tagName.toLowerCase(),attrs,[...el.childNodes].map(node).filter(Boolean),...(computed?[computed]:[])];
    }
    return [...document.querySelectorAll('.shell-d .awrap, .shell-d .ov')].filter(el=>!el.parentElement.closest('.ov')).map(node);
   });
   const dir=`${root}/${phase}`; mkdirSync(dir,{recursive:true});
   writeFileSync(`${dir}/${name}-${width}.json`,JSON.stringify(dom,null,2));
   await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true,animations:'disabled'});
   if(phase!=='before') assert.deepEqual(dom,JSON.parse(readFileSync(`${root}/before/${name}-${width}.json`)),`${name} DOM at ${width}`);
  }
  await context.close();
 }
 console.log(`component characterization ${phase}: ${cases.filter(([name])=>!process.env.R3_ONLY || process.env.R3_ONLY.split(',').includes(name)).length*2} routes/viewports passed`);
} finally {await browser.close(); await db().end();}
