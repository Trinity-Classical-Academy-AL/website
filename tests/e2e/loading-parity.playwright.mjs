// Repeatable settled-page capture; compare with component-diff.mjs using R3_SHOTS.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { db, listSeries, listTourSlotSummary, listStudents, listAdminForms } from '@tca/school';
const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4441';
const seed=JSON.parse(readFileSync('/tmp/tca-e2e-seed.json','utf8'));
const phase=process.env.R4_CAPTURE || 'after';
const root=process.env.R4_SHOTS || '/home/bryant/work/tca/refactor-shots/r4';
const slot=(await listTourSlotSummary()).find(row=>!row.seriesId);
const rule=(await listSeries())[0];
const student=(await listStudents(seed.ada.id))[0];
const form=(await listAdminForms()).find(row=>row.title==='Photo release');
const family=`/admin/families/${seed.ada.id}`;
const cases=[
 ['admin','/admin'],['tours','/admin/tours'],['requests','/admin/tours?tab=requests'],['bookings','/admin/tours?tab=bookings'],
 ['add-time','/admin/tours?sheet=add'],['edit-time',`/admin/tours?slot=${slot.id}`],['delete-time',`/admin/tours?slot=${slot.id}&confirm=${slot.id}`],
 ...(rule?[['series',`/admin/tours?rule=${rule.id}`]]:[]),
 ['events','/admin/events'],['event-sheet','/admin/events?sheet=new'],['documents','/admin/documents'],['forms','/admin/documents?tab=forms'],
 ['document-sheet',`/admin/documents?doc=${seed.publicDoc}`],['form-tracker',`/admin/forms/${form.id}`],['form-empty',`/admin/forms/${form.id}?status=submitted`],
 ['families','/admin/families'],['family',family],['student-sheet',`${family}?student=${student.id}`],['staff','/admin/people'],
 ['website','/admin/website'],['announcements','/admin/website?tab=announcements'],['inquiries','/admin/inquiries'],['prospects','/admin/prospects'],['prospect',`/admin/prospects/${seed.pat.id}`],
 ['account','/account'],['home','/home','pat'],['tour','/tour','pat'],['public-events','/events','pat'],
 ['guardian','/g','ada'],['g-students','/g/students','ada'],['g-calendar','/g/calendar','ada'],['g-announcements','/g/announcements','ada'],
 ['g-documents','/g/documents','ada'],['g-forms','/g/forms','ada'],['g-done','/g/forms?tab=done','ada'],
];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--force-color-profile=srgb']});
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();
  for(const [name,path,role='office'] of cases) {
   await context.clearCookies();await context.addCookies([{name:'tca_family_session',value:seed.cookies[role],url:base}]);
   const response=await page.goto(base+path,{waitUntil:'networkidle'});assert.equal(response.status(),200,path);
   await page.evaluate(()=>document.fonts.ready);
   mkdirSync(`${root}/${phase}`,{recursive:true});
   await page.screenshot({path:`${root}/${phase}/${name}-${width}.png`,fullPage:true,animations:'disabled'});
  }
  await context.close();
 }
 console.log(`${phase}: ${cases.length*2} settled-page captures`);
} finally {await browser.close();await db().end();}
