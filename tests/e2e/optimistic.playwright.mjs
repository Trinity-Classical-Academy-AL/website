import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createInquiry, db } from '@tca/school';

const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4393';
const seed=JSON.parse(readFileSync('/tmp/tca-e2e-seed.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox']});
const results=[];
const errors=[];
async function session(token,viewport) {
 const context=await browser.newContext({viewport});
 await context.addCookies([{name:'tca_family_session',value:token,url:base}]);
 const page=await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror',e=>errors.push(e.message));
 return {context,page};
}
const {context,page}=await session(seed.cookies.office);
const visible=selector=>page.locator(selector).filter({visible:true}).first();
async function settled(){await page.waitForFunction(()=>!document.querySelector('form[aria-busy="true"]'));}
async function uniqueTime(date) {
 const slots=await db()`select start_time from tour_slots where slot_date=${date}`;
 let minutes=540;while(slots.some(slot=>slot.start_time===clock(minutes)))minutes++;
 return {start:clock(minutes),end:clock(minutes+30)};
}
function clock(minutes){return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
async function goto(path){await page.goto(base+path);await page.waitForLoadState('networkidle');}
try {
 await db()`update families set roles=${['prospect']} where id=${seed.pat.id}`;
 // Measure the same five actions as the captured baseline. Mutation responses have a fixed 250 ms delay.
 async function measure(name,path,prepare,selector,check) {
  console.log('measure',name);await goto(path);await prepare();
  let documentRequests=0;
  const count=req=>{if(req.isNavigationRequest() && req.frame()===page.mainFrame())documentRequests++};page.on('request',count);
  await page.route('**/*',async route=>{if(route.request().url().startsWith(base) && ['document','fetch'].includes(route.request().resourceType())) await new Promise(r=>setTimeout(r,250));await route.continue();});
  await page.evaluate(({selector,check})=>{
   window.__perfResult=null;
   const control=[...document.querySelectorAll(selector)].find(el=>el.getClientRects().length && !el.closest('[hidden]'));
   control.addEventListener('click',()=>{const start=performance.now();const poll=()=>{if(new Function(`return (${check})()`)()){window.__perfResult=performance.now()-start}else requestAnimationFrame(poll)};requestAnimationFrame(poll)}, {once:true});
  },{selector,check:check.toString()});
  await visible(selector).click();await page.waitForFunction(()=>window.__perfResult!==null);
  const ms=await page.evaluate(()=>window.__perfResult);
  await settled();assert.equal(await page.locator('[data-interaction-toasts] .t-err').count(),0,name+' server accepted');await page.unrouteAll({behavior:'wait'});page.off('request',count);
  results.push({name,ms:Math.round(ms),documentRequests,fullReloads:documentRequests?1:0});
 }
 // Tours are added from the calendar: New opens the add sheet for today with Tour chosen.
 await measure('Open tour sheet','/admin/calendar?type=tour',async()=>{},'a[href^="/admin/calendar?type=tour&new="]',()=>[...document.querySelectorAll('.ssheet')].some(el=>el.getClientRects().length&&!el.closest('[hidden]')));
 await measure('Save tour time','/admin/calendar?type=tour&new=2027-12-21',async()=>{const time=await uniqueTime('2027-12-21');await visible('[name=date]').fill('2027-12-21');await visible('[name=start]').fill(time.start);await visible('[name=end]').fill(time.end)},'.ssheet form button.btn-p',()=>![...document.querySelectorAll('.ssheet')].some(el=>el.getClientRects().length&&!el.closest('[hidden]')));
 await measure('Save student',`/admin/families/${seed.ada.id}?sheet=student`,async()=>{await visible('[name=first]').fill('Perf');await visible('[name=last]').fill('Student after');await visible('[name=grade]').selectOption('3')},'.ssheet button.btn-p',()=>![...document.querySelectorAll('.ssheet')].some(el=>el.getClientRects().length&&!el.closest('[hidden]')));
 await measure('Publish document',`/admin/documents?doc=${seed.publicDoc}`,async()=>{},'.ssheet button[name=publish][value=yes]',()=>![...document.querySelectorAll('.ssheet')].some(el=>el.getClientRects().length&&!el.closest('[hidden]')));
 await measure('Enroll prospect',`/admin/families/${seed.pat.id}?enroll=1`,async()=>{},'.dlg button.btn-p',()=>![...document.querySelectorAll('.dlg')].some(el=>el.getClientRects().length&&!el.closest('[hidden]')));
 assert.ok(results.every(row=>row.documentRequests===0),JSON.stringify(results));

 // Server validation (HTTP 200) retains the original draft, sheet, URL, and focus.
 // The date field is a date picker now, so the server error is a time that already exists.
 const [taken]=await db()`select slot_date::text as date, start_time, end_time from tour_slots where series_id is null and slot_date > now() order by slot_date limit 1`;
 await goto('/admin/calendar?type=tour');await visible('a[href^="/admin/calendar?type=tour&new="]').click();await visible('.ssheet [name=date]').fill(taken.date);
 await visible('.ssheet [name=start]').fill(taken.start_time.slice(0,5));await visible('.ssheet [name=end]').fill(taken.end_time.slice(0,5));await visible('.ssheet form button.btn-p').click();
 await page.locator('[data-interaction-toasts]').getByText(/already exists/).waitFor();
 assert.equal(await visible('.ssheet [name=date]').inputValue(),taken.date);
 assert.equal(await visible('.ssheet [name=start]').inputValue(),taken.start_time.slice(0,5));assert.equal(await visible('.ssheet').count(),1);
 assert.match(page.url(),/new=/);

 // Forced HTTP and network errors do not navigate or replay a POST; double submit sends once.
 for(const failure of ['http','network','banner']) {
  await goto('/admin/calendar?type=tour&new=2027-12-22');
  let posts=0;
  await page.route('**/admin/calendar*',async route=>{
   if(route.request().method()!=='POST')return route.continue();posts++;await new Promise(r=>setTimeout(r,300));
   if(failure==='network')return route.abort('failed');
   return route.fulfill({status:failure==='http'?503:200,contentType:'text/html',body:`<html><head><meta name="astro-view-transitions-enabled"></head><body><p class="alert alert-err">Forced ${failure} error</p></body></html>`});
  });
  await visible('.ssheet form button.btn-p').click();
  await page.evaluate(()=>[...document.querySelectorAll('form[data-enhance]')].find(f=>f.getAttribute('aria-busy')==='true').requestSubmit());
  await page.locator('[data-interaction-toasts]').waitFor();await settled();assert.equal(posts,1);
  assert.equal(await visible('.ssheet [name=date]').inputValue(),'2027-12-22');assert.equal(await visible('.ssheet').count(),1);
  assert.equal(await visible('.ssheet form button.btn-p').isEnabled(),true);await page.unrouteAll({behavior:'wait'});
 }

 // Optimistic status changes while POST is delayed, rolls back controlled Ark state on failure.
 const email=`perf-ui-${Date.now()}@example.com`;
 await createInquiry({email,name:'UI regression',phone:'',grades:[],message:'Local fixture',source:'perf-ui',notify:false});
 // The Status menus hydrate when the browser is idle (client:idle); wait for them before clicking.
 await goto('/admin/inquiries');await page.waitForFunction(()=>!document.querySelector('astro-island[ssr]'));const row=page.locator('tr').filter({hasText:email}).filter({visible:true});
 const initial=await row.locator('[data-status]').innerText();
 let release;
 const gate=new Promise(resolve=>{release=resolve});
 await page.route('**/admin/inquiries*',async route=>{if(route.request().method()!=='POST')return route.continue();await gate;return route.fulfill({status:500,contentType:'text/html',body:'<p class="alert-err">Status rejected</p>'});});
 // Ark's native select change path, as loading-optimistic does: the popover's ids are shared with the
 // hidden phone copy of the row, so which copy's menu answers a click isn't deterministic.
 await row.locator('select[name="status"]').selectOption('contacted',{force:true});
 await row.locator('[data-status]').filter({hasText:'contacted'}).waitFor();release();await page.getByText('Status rejected',{exact:true}).waitFor();
 await page.waitForFunction(({email,initial})=>[...document.querySelectorAll('tr')].find(row=>row.textContent.includes(email)).querySelector('[data-status]').textContent===initial,{email,initial});
 await page.unrouteAll({behavior:'wait'});
 const committed=page.waitForResponse(response=>response.url().includes('/admin/inquiries') && response.request().method()==='POST');
 await row.locator('select[name="status"]').selectOption('confirmed',{force:true});await committed;await settled();
 await goto('/admin/inquiries');assert.equal(await page.locator('tr').filter({hasText:email}).filter({visible:true}).locator('[data-status]').innerText(),'confirmed');

 // Live search keeps focus/caret and tab/filter state with history replace.
 await goto('/admin/families?q=Brook');const input=visible('form.tools input[name=q]');await input.fill('Ada');
 await page.waitForURL(/q=Ada/);await page.waitForLoadState('networkidle');
 assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.equal(await input.evaluate(el=>el.selectionStart),3);
 assert.match(await visible('main').innerText(),/Ada Brook/);assert.doesNotMatch(await visible('main').innerText(),/Bea Cole/);
 await input.fill('');await page.waitForURL(url=>!url.searchParams.has('q'));await page.waitForLoadState('networkidle');

 // Instant dialog: no request and no blank frame; Escape restores the opener's focus.
 // The calendar's add sheet is rendered by the server now, so use the family page's Mark enrolled confirmation.
 await db()`update families set roles=${['prospect']} where id=${seed.pat.id}`;
 const enrollLink=`a[href="/admin/families/${seed.pat.id}?enroll=1"]`;
 await goto(`/admin/families/${seed.pat.id}`);let gets=0;
 await page.route('**/admin/families/**',async route=>{gets++;await new Promise(r=>setTimeout(r,500));return route.continue()});
 await page.evaluate(()=>{window.__blank=false;window.__frames=true;function sample(){if(!document.querySelector('main')?.textContent.trim())window.__blank=true;if(window.__frames)requestAnimationFrame(sample)};sample()});
 await visible(enrollLink).click();assert.equal(await visible('.dlg').count(),1);
 assert.equal(gets,0,'Local dialog opening makes no request');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.dlg:visible').count(),0);
 assert.equal(await visible(enrollLink).evaluate(el=>el===document.activeElement),true);
 assert.equal(await page.evaluate(()=>{window.__frames=false;return window.__blank}),false);
 // Hover prefetch may make a GET; opening/closing itself changes no document.
 await page.unrouteAll({behavior:'wait'});

 // Full local lists filter without fetching, including empty results and clearing.
 const guardian=await session(seed.cookies.ada);
 // School documents are on the Library tab now.
 await guardian.page.goto(base+'/g/documents?tab=library');await guardian.page.waitForLoadState('networkidle');
 let localRequests=0;guardian.page.on('request',req=>{if(req.url().includes('/g/documents'))localRequests++});
 const localInput=guardian.page.locator('form.tools input[name=q]').filter({visible:true});
 const allRows=await guardian.page.locator('[data-search-row]:visible').count();assert.ok(allRows>=1);
 await localInput.fill('handbook');assert.equal(await guardian.page.locator('[data-search-row]:visible').count(),1);
 await localInput.fill('no-match-xyz');assert.equal(await guardian.page.locator('[data-search-row]:visible').count(),0);
 assert.equal(await guardian.page.locator('[data-search-empty]:visible').count(),1);
 await localInput.fill('');assert.equal(await guardian.page.locator('[data-search-row]:visible').count(),allRows);
 assert.equal(localRequests,0);await guardian.context.close();
 // Server search retains named select and tab filters as well as the input node.
 // Tour bookings are in Calendar → RSVPs now, filtered by Show and Type.
 await goto('/admin/calendar/rsvps?show=past&kind=booking&q=before');
 const bookingSearch=visible('form.tools input[name=q]');await bookingSearch.fill('Ada');
 await page.waitForURL(url=>url.searchParams.get('q')==='Ada');await page.waitForLoadState('networkidle');
 const filteredURL=new URL(page.url());assert.equal(filteredURL.searchParams.get('show'),'past');assert.equal(filteredURL.searchParams.get('kind'),'booking');
 assert.equal(await bookingSearch.evaluate(el=>el===document.activeElement),true);
 // Confirmed delete snapshots both the sheet and list row and rolls back HTTP failures.
 await goto(`/admin/documents?doc=${seed.publicDoc}`);await visible('a.btn-gd').click();
 assert.equal(await visible('.dlg').count(),1);
 await page.route('**/admin/documents*',route=>route.request().method()==='POST'?route.fulfill({status:500,contentType:'text/html',body:'<p class="alert-err">Delete rejected</p>'}):route.continue());
 await visible('.dlg button.btn-d').click();await page.getByText('Delete rejected',{exact:true}).waitFor();
 assert.equal(await page.locator(`[data-row="${seed.publicDoc}"]:visible`).count(),1);assert.equal(await visible('.dlg').count(),1);
 await page.unrouteAll({behavior:'wait'});

 // Non-sheet same-page POST keeps scroll and a live search filter is preserved.
 // Prospects open on the family page now; its note form posts back to the same page.
 await goto(`/admin/families/${seed.pat.id}`);await visible('textarea[name=note]').fill('No email: local perf regression');
 await page.setViewportSize({width:1280,height:400});
 const noteButton=visible('form:has(textarea[name=note]) button');await noteButton.scrollIntoViewIfNeeded();
 const before=await visible('main').evaluate(el=>el.scrollTop);
 const noted=page.waitForResponse(response=>response.url().includes(`/admin/families/${seed.pat.id}`) && response.request().method()==='POST');
 await noteButton.evaluate(button=>button.form.requestSubmit(button));
 await noted;await settled();assert.equal(await visible('main').evaluate(el=>el.scrollTop),before);
 await page.setViewportSize({width:1280,height:720});

 // Preview scripts rebind when returning via ClientRouter.
 await goto('/admin/website');await visible('input[name=enabled]').check();await visible('input[name=text]').fill('First preview');
 assert.equal(await visible('[data-banner-node=pv-text]').innerText(),'First preview');
 await visible('a[href="/admin/calendar"]').click();await page.waitForURL(url=>url.pathname==='/admin/calendar');
 await visible('a[href="/admin/website"]').click();await page.waitForURL(url=>url.pathname==='/admin/website');
 await visible('input[name=enabled]').check();await visible('input[name=text]').fill('Returned preview');
 assert.equal(await visible('[data-banner-node=pv-text]').innerText(),'Returned preview');
 // Mobile duplicate form binding and banner previews work after router swaps.
 const mobile=await session(seed.cookies.office,{width:390,height:844});
 await mobile.page.goto(base+`/admin/families/${seed.ada.id}?sheet=student`);await mobile.page.waitForLoadState('networkidle');
 const mv=selector=>mobile.page.locator(selector).filter({visible:true}).first();
 await mv('[name=first]').fill('Mobile');await mv('[name=last]').fill('Fixture');await mv('[name=grade]').selectOption('3');await mv('.ssheet button.btn-p').click();
 await mobile.page.waitForURL(/saved=/);assert.equal(await mobile.page.locator('.ssheet:visible').count(),0);
 await mobile.page.goto(base+'/admin/website');await mobile.page.waitForLoadState('networkidle');
 await mv('input[name=enabled]').check();await mv('input[name=text]').fill('Mobile preview');assert.equal(await mv('[data-banner-node=pv-text]').innerText(),'Mobile preview');
 await mobile.context.close();

 // No-JS URLs and normal POST fallback still save and retain confirmations.
 const plain=await browser.newContext({javaScriptEnabled:false});await plain.addCookies([{name:'tca_family_session',value:seed.cookies.office,url:base}]);
 const plainPage=await plain.newPage();await plainPage.goto(base+'/admin/calendar?type=tour&new=2027-12-23');assert.equal(await plainPage.locator('.ssheet:visible').count(),1);
 const fallbackTime=await uniqueTime('2027-12-23');
 await plainPage.locator('[name=start]:visible').fill(fallbackTime.start);await plainPage.locator('[name=end]:visible').fill(fallbackTime.end);
 await plainPage.locator('[name=date]:visible').fill('2027-12-23');await plainPage.locator('.ssheet button.btn-p:visible').click();await plainPage.waitForURL(/saved=/);await plain.close();
 assert.deepEqual(errors,[],'Browser runtime errors');
 writeFileSync(process.env.PORTAL_PERF_OUTPUT || '/tmp/tca-after.json',JSON.stringify(results,null,2));
 console.log('optimistic UI flows passed');console.table(results);
} finally {
 await db()`update families set roles=${['prospect']} where id=${seed.pat.id}`;
 await context.close();await browser.close();await db().end();
}
