/** Reusable before/after measurement. Run against the chosen checkout after seed.mjs.
 * PORTAL_PERF_OUTPUT sets the JSON artifact; all five writes avoid email.
 * A controlled 250 ms delay isolates client feedback from server latency.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {db} from '@tca/school';
import assert from 'node:assert/strict';
const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4393';
const seed=JSON.parse(readFileSync('/tmp/tca-e2e-seed.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox']});
const context=await browser.newContext();await context.addCookies([{name:'tca_family_session',value:seed.cookies.office,url:base}]);
const page=await context.newPage();page.setDefaultTimeout(15000);
const results=[];
try {
 // The clock survives full document navigations; collect the first painted frame with the visible outcome.
 await page.addInitScript(()=>{
  function sample(){
   const saved=sessionStorage.getItem('portal-perf-pending');
   if(saved){const {start,check}=JSON.parse(saved);if(new Function(`return (${check})()`)()){
    sessionStorage.setItem('portal-perf-result',String(performance.timeOrigin+performance.now()-start));sessionStorage.removeItem('portal-perf-pending');
   }}
   requestAnimationFrame(sample);
  }requestAnimationFrame(sample);
 });
 const visible=selector=>page.locator(selector).filter({visible:true}).first();
 async function measure(name,path,prepare,selector,check){
  await page.goto(base+path);await page.waitForLoadState('networkidle');await prepare();
  let documentRequests=0,fullReloads=0;
  const count=request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documentRequests++};
  const loaded=()=>{fullReloads++};page.on('request',count);page.on('load',loaded);
  await page.route('**/*',async route=>{if(route.request().url().startsWith(base)&&['document','fetch'].includes(route.request().resourceType()))await new Promise(resolve=>setTimeout(resolve,250));await route.continue()});
  await visible(selector).evaluate((control,check)=>control.addEventListener('click',()=>{
   sessionStorage.removeItem('portal-perf-result');sessionStorage.setItem('portal-perf-pending',JSON.stringify({start:performance.timeOrigin+performance.now(),check}));
  },{once:true}),check.toString());
  await visible(selector).click();await page.waitForFunction(()=>sessionStorage.getItem('portal-perf-result')!==null);
  const ms=Math.round(Number(await page.evaluate(()=>sessionStorage.getItem('portal-perf-result'))));
  await page.waitForFunction(()=>!document.querySelector('form[aria-busy="true"]'));await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.alert-err:visible, [data-interaction-toasts] .t-err').count(),0,name+' server accepted');
  await page.unrouteAll({behavior:'wait'});page.off('request',count);page.off('load',loaded);
  results.push({name,ms,documentRequests,fullReloads});
 }
 const sheetOpen=()=>[...document.querySelectorAll('.ssheet')].some(el=>el.getClientRects().length&&!el.closest('[hidden]'));
 const sheetClosed=()=>![...document.querySelectorAll('.ssheet')].some(el=>el.getClientRects().length&&!el.closest('[hidden]'));
 await measure('Open tour sheet','/admin/tours',async()=>{},'a[href="/admin/tours?sheet=add"]',sheetOpen);
 await measure('Save tour time','/admin/tours?sheet=add',async()=>{const existing=await db()`select start_time from tour_slots where slot_date='2027-12-20'`;let minutes=540;const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;while(existing.some(slot=>slot.start_time===clock(minutes)))minutes++;await visible('[name=date]').fill('12/20/2027');await visible('[name=start]').fill(clock(minutes));await visible('[name=end]').fill(clock(minutes+30))},'.ssheet button.btn-p',sheetClosed);
 await measure('Save student',`/admin/families/${seed.ada.id}?sheet=student`,async()=>{await visible('[name=first]').fill('Measured');await visible('[name=last]').fill('Fixture');await visible('[name=grade]').selectOption('3')},'.ssheet button.btn-p',sheetClosed);
 await measure('Publish document',`/admin/documents?doc=${seed.publicDoc}`,async()=>{},'.ssheet button[name=publish][value=yes]',sheetClosed);
 await measure('Enroll prospect',`/admin/prospects/${seed.pat.id}?enroll=1`,async()=>{},'.dlg button.btn-p',()=>![...document.querySelectorAll('.dlg')].some(el=>el.getClientRects().length&&!el.closest('[hidden]')));
 writeFileSync(process.env.PORTAL_PERF_OUTPUT || '/tmp/tca-interaction-measure.json',JSON.stringify(results,null,2));console.table(results);
}finally{await browser.close();await db().end()}
