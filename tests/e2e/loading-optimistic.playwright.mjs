// Serial local-only regression checks. Gates hold responses until the optimistic DOM is asserted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { db, addTourSlot, saveSeries, nextSeriesDates, listSeries, saveEvent, saveStudent, saveSchoolDocument, createInquiry } from '@tca/school';
const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4441';
const seed=JSON.parse(readFileSync('/tmp/tca-e2e-seed.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
const cleanup=[];const errors=[];
async function capture(page,name,width) {
 if(!process.env.R4_SHOTS)return;
 const dir=`${process.env.R4_SHOTS}/loading`;mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true,animations:'disabled'});
}
async function fixture(result) {assert.ok(result.ok,JSON.stringify(result));return result.id;}
async function link(page,path) {
 await page.evaluate(path=>{const a=document.createElement('a');a.href=path;document.body.append(a);a.click();a.remove();},path);
}
async function gate(page,path,method='POST',failure=false) {
 let release;const held=new Promise(resolve=>release=resolve);let requests=0;
 const handler=async route=>{
  if(route.request().method()!==method)return route.continue();requests++;await held;
  if(failure)return route.fulfill({status:500,contentType:'text/html',body:'<p class="alert-err">Forced rejection</p>'});
  return route.continue();
 };
 await page.route(`**${path}*`,handler);
 return {release,requests:()=>requests,close:async()=>{release();await page.unroute(`**${path}*`,handler);}};
}
// Exercise Ark's native select change path without depending on popover placement
// inside the mobile table's horizontal scroll container.
async function selectContacted(page,row) {
 await row.locator('select[name="status"]').selectOption('contacted',{force:true});
}
async function settled(page) {await page.waitForFunction(()=>!document.querySelector('form[aria-busy="true"]'));}
try {
 const occupied=new Set((await db()`select start_time from tour_slots union select start_time from schedule_series`).map(row=>row.start_time));
 let minute=14*60+31;const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 const time=()=>{while(occupied.has(clock(minute)))minute++;const start=clock(minute),end=clock(minute+60);occupied.add(start);minute++;return {start,end};};
 const slot=await fixture(await addTourSlot({date:'2028-09-12',...time(),capacity:12,published:true}));cleanup.push(()=>db()`delete from tour_slots where id=${slot}`);
 const series=await fixture(await saveSeries({type:'tour',weekdays:[2],...time(),startsOn:'2028-09-12',endsOn:'2028-10-12',capacity:12,capacityUnit:'people',published:true,bookingWindowDays:92}));cleanup.push(async()=>{await db()`delete from tour_slots where series_id=${series}`;await db()`delete from schedule_series where id=${series}`;});
 const rule=(await listSeries()).find(row=>row.id===series);const date=nextSeriesDates(rule,rule.startsOn)[0];
 const emptySeries=await fixture(await saveSeries({type:'tour',weekdays:[0],...time(),startsOn:'2028-09-12',endsOn:'2028-09-13',capacity:1,capacityUnit:'families',published:false}));cleanup.push(()=>db()`delete from schedule_series where id=${emptySeries}`);
 const event=await saveEvent({title:'R4 local event',description:'Local fixture',startsAt:'2028-09-12T18:00:00Z',location:'School'});cleanup.push(()=>db()`delete from events where id=${event}`);
 const student=await fixture(await saveStudent({familyId:seed.ada.id,name:'R4 Student',grade:'3',teacher:''}));cleanup.push(()=>db()`delete from students where id=${student}`);
 const unverified=randomUUID();await db()`insert into family_emails (id,family_id,email,is_primary) values (${unverified},${seed.office.id},${`r4-${unverified}@example.com`},false)`;cleanup.push(()=>db()`delete from family_emails where id=${unverified}`);
 const email=randomUUID();await db()`insert into family_emails (id,family_id,email,is_primary,verified_at) values (${email},${seed.office.id},${`r4-${email}@example.com`},false,now())`;cleanup.push(()=>db()`delete from family_emails where id=${email}`);
 const doc=await fixture(await saveSchoolDocument({title:'R4 local document',category:'Handbooks and policies',audience:'everyone',grade:'',familyId:'',publish:true,email:false,file:{bytes:new TextEncoder().encode('%PDF-1.4'),name:'r4.pdf',contentType:'application/pdf'}}));cleanup.push(()=>db()`delete from school_documents where id=${doc}`);
 const inquiryEmail=`r4-${randomUUID()}@example.com`;await createInquiry({email:inquiryEmail,name:'R4 inquiry',phone:'',grades:[],message:'Local fixture',source:'r4',notify:false});cleanup.push(()=>db()`delete from inquiries where email=${inquiryEmail}`);
 // Tours are calendar items now; their sheet deletes through a confirm, with no optimistic row to hide.
 const [occurrence]=await db()`select id from tour_slots where series_id=${series} and slot_date=${date}`;assert.ok(occurrence);
 const itemURL=id=>`/admin/calendar?m=2028-09&item=${encodeURIComponent(`tour:${id}`)}`;
 const tourDeletions=[
  ['slot',itemURL(slot),'button[form^=delete-item]',async()=>(await db()`select id from tour_slots where id=${slot}`).length===1],
  ['series',itemURL(occurrence.id),'button[form^=delete-series]',async()=>(await db()`select id from schedule_series where id=${series}`).length===1],
  ['date',itemURL(occurrence.id),'button[form^=delete-item]',async()=>(await db()`select id from tour_slots where id=${occurrence.id}`).length===1],
 ];
 const deletions=[
  ['document',`/admin/documents?doc=${doc}&confirm=1`,doc,'.dlg button.btn-d'],
  ['event',`/admin/events?event=${event}&confirm=1`,event,'.dlg button.btn-d'],
  ['student',`/admin/families/${seed.ada.id}?student=${student}`,student,'button[data-submit-action="remove-student"]'],
  ['email',`/account?dialog=remove&id=${email}`,email,'.dlg button.btn-p'],
 ];
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.addCookies([{name:'tca_family_session',value:seed.cookies.office,url:base}]);
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  const visible=selector=>page.locator(selector).filter({visible:true}).first();
  const goto=path=>page.goto(base+path,{waitUntil:'networkidle'});
  // A weekly tour with no dates in its range puts nothing on the calendar.
  await goto('/admin/calendar?type=tour&m=2028-09');assert.equal(await page.locator('a[href*="item=tour"]').filter({hasText:/./}).count()>0,true);
  assert.equal((await db()`select id from tour_slots where series_id=${emptySeries}`).length,0);await capture(page,'empty-series',width);
  for(const [name,path,button,stillThere] of tourDeletions) {
   console.log('delete',width,name);
   await goto(path);const held=await gate(page,'/admin/calendar','POST',true);
   try {
    await visible(button).click();await visible('.confirm-ov [data-yes]').click();
    await page.waitForFunction(()=>document.querySelector('form[aria-busy="true"]'));
    assert.equal(await page.locator('.portal-loading').count(),0,'POST has no navigation skeleton');
    held.release();await page.getByText('Forced rejection',{exact:true}).waitFor();await settled(page);
    assert.equal(await visible('.ssheet').count(),1,name+' sheet stays');assert.equal(await stillThere(),true,name+' kept');assert.equal(held.requests(),1);
   } finally {await held.close();}
  }
  for(const [name,originalPath,originalTarget,button] of deletions) {
   const path=name==='email'&&width===390?'/account':originalPath;
   const target=name==='email'&&width===390?unverified:originalTarget;
   console.log('delete',width,name);
   await goto(path);const routePath=new URL(base+path).pathname;const held=await gate(page,routePath,'POST',true);
   try {
    assert.equal(await page.locator(`[data-row="${target}"]`).count(),2,name+' responsive rows');
    await (name==='email'&&width===390 ? visible(`[data-row="${unverified}"] button`) : visible(button)).click();
    await page.waitForFunction(target=>[...document.querySelectorAll('[data-row]')].filter(row=>row.dataset.row===target).every(row=>row.hidden),target);
    assert.equal(await page.locator('.portal-loading').count(),0,'POST has no navigation skeleton');
    held.release();await page.getByText('Forced rejection',{exact:true}).waitFor();await settled(page);
    assert.equal(await page.locator(`[data-row="${target}"][hidden]`).count(),0,name+' rollback');assert.equal(held.requests(),1);
   } finally {await held.close();}
  }
  // Publish and unpublish retain server truth on rollback, including both responsive copies.
  for(const publish of ['no','yes']) {
   await db()`update school_documents set status=${publish==='yes'?'draft':'published'} where id=${doc}`;
   await goto(`/admin/documents?doc=${doc}`);const held=await gate(page,'/admin/documents','POST',true);
   try {
    await visible(`button[name="publish"][value="${publish}"]`).click();
    const text=publish==='yes'?'Published':'Draft';
    assert.deepEqual(await page.locator(`[data-row="${doc}"] [data-status]`).allTextContents(),[text,text]);
    held.release();await page.getByText('Forced rejection',{exact:true}).waitFor();await settled(page);
    assert.deepEqual(await page.locator(`[data-row="${doc}"] [data-status]`).allTextContents(),[publish==='yes'?'Draft':'Published',publish==='yes'?'Draft':'Published']);
   } finally {await held.close();}
  }
  await goto('/admin/inquiries');const held=await gate(page,'/admin/inquiries','POST',true);
  try {
   const row=page.locator('tr').filter({hasText:inquiryEmail}).filter({visible:true});
   await selectContacted(page,row);
   await page.waitForFunction(email=>[...document.querySelectorAll('tr')].filter(row=>row.textContent.includes(email)).every(row=>row.querySelector('[data-status]')?.textContent==='contacted'),inquiryEmail);
   held.release();await page.getByText('Forced rejection',{exact:true}).waitFor();await settled(page);
   assert.deepEqual(await page.locator('tr').filter({hasText:inquiryEmail}).locator('[data-status]').allTextContents(),['new','new']);
  } finally {await held.close();}
  // A successful contacted update is replaced with the server's committed fragment.
  await goto('/admin/inquiries');
  const inquiryRow=page.locator('tr').filter({hasText:inquiryEmail}).filter({visible:true});
  const committed=page.waitForResponse(response=>response.url().includes('/admin/inquiries')&&response.request().method()==='POST');committed.catch(()=>{});
  await selectContacted(page,inquiryRow);await committed;await settled(page);
  assert.equal((await db()`select status from inquiries where email=${inquiryEmail}`)[0].status,'contacted');
  await db()`update inquiries set status='new' where email=${inquiryEmail}`;
  // No initial SSR loader; slow page navigation has exactly the source table's cells and rows.
  // Calendar → RSVPs is a table page, like Tours was.
  await goto('/admin/calendar/rsvps');assert.equal(await page.locator('[data-skeleton]').count(),0);
  const cells=await visible('.tbox').locator('th,td').count(),rows=await visible('.tbox').locator('tr').count();
  const nav=await gate(page,'/admin/documents','GET');
  try {
   await link(page,`/admin/documents?r4=slow-${width}`);await visible('[data-skeleton]').waitFor();
   const skeleton=visible('[data-skeleton]');assert.ok(await skeleton.locator('.skeleton-shape').count()>=cells);assert.equal(await skeleton.locator('.skeleton-rule').count(),rows);
   await capture(page,'page-skeleton',width);
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await skeleton.locator('.skeleton-shape').first().evaluate(el=>getComputedStyle(el,'::after').animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
   nav.release();await page.waitForURL(/r4=slow/);await page.waitForFunction(()=>!document.querySelector('.portal-loading'));await visible('h1').getByText('Documents & forms',{exact:true}).waitFor();
  } finally {await nav.close();}
  // Sheet GETs fetch into a temporary sheet, then replace fields with the real form.
  const sheet=await gate(page,'/admin/documents','GET');
  try {
   await link(page,`/admin/documents?doc=${doc}&r4=sheet-${width}`);await visible('[data-loading-sheet] .skeleton-input').first().waitFor();
   await capture(page,'sheet-skeleton',width);
   sheet.release();await page.waitForURL(/r4=sheet/);await visible('[name=title]').waitFor();assert.equal(await page.locator('[data-loading-sheet]').count(),0);
  } finally {await sheet.close();}
  // A fast response must not mount a skeleton at all (MutationObserver catches even a flash).
  await goto('/admin/calendar/rsvps');await page.evaluate(()=>{window.r4Flashes=0;new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&(node.matches('[data-skeleton],[data-loading-sheet]')||node.querySelector('[data-skeleton],[data-loading-sheet]')))window.r4Flashes++;}).observe(document.body,{subtree:true,childList:true});});
  const fastHTML=await (await context.request.get(base+'/admin/documents')).text();
  const fastPath=`/admin/documents?r4=fast-${width}`;
  await page.route(`**${fastPath}`,route=>route.fulfill({status:200,contentType:'text/html',body:fastHTML}));
  await link(page,fastPath);await page.waitForURL(/r4=fast/);await page.waitForFunction(()=>!document.querySelector('.portal-loading'));
  assert.equal(await page.evaluate(()=>window.r4Flashes),0,'fast GET never mounts a skeleton');
  await page.unroute(`**${fastPath}`);await goto('/admin/documents');
  // Use the already-rendered confirmation's no-op ClientRouter path, a deterministic fast navigation.
  await link(page,`/admin/documents?doc=${doc}`);await page.waitForURL(new RegExp(doc));
  await page.evaluate(()=>{window.r4Flashes=0;new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.matches('[data-skeleton],[data-loading-sheet]'))window.r4Flashes++;}).observe(document.body,{subtree:true,childList:true});});await visible(`a[href$="doc=${doc}&confirm=1"]`).click();await visible('.dlg').waitFor();assert.equal(await page.evaluate(()=>window.r4Flashes),0);
  // Successful deletion revalidates from the server; use a disposable event per width.
  const success=await saveEvent({title:`R4 success ${width}`,description:'',startsAt:'2028-09-13T18:00:00Z',location:''});
  await goto(`/admin/events?event=${success}&confirm=1`);const post=await gate(page,'/admin/events');
  try {await visible('.dlg button.btn-d').click();assert.equal(await page.locator(`[data-row="${success}"][hidden]`).count(),2);post.release();await page.waitForURL(/removed=1/);assert.equal(await page.locator(`[data-row="${success}"]`).count(),0);assert.equal((await db()`select id from events where id=${success}`).length,0);} finally {await post.close();}
  await context.close();console.log(`loading/optimistic ${width}: passed`);
 }
 assert.deepEqual(errors,[]);
} finally {await browser.close();for(const remove of cleanup.reverse())await remove();await db().end();}
