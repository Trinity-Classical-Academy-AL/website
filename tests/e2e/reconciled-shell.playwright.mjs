// Regression checks for the shared shell + optimistic interaction ownership.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4393';
const seed=JSON.parse(readFileSync(process.env.PERF_SEED || '/tmp/tca-e2e-seed.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
const errors=[];
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:700}});
  try {
   await context.addCookies([{name:'tca_family_session',value:seed.cookies.office,url:base}]);
   const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
   // Start each navigation after the page's islands hydrate. Swapping a page unmounts its islands, and
   // React reports a recoverable error when one is unmounted mid-hydration (seen on slow CI runners).
   // Astro drops [ssr] when it starts hydrating; React marks each element it has hydrated with a fiber key.
   const hydrated=()=>page.waitForFunction(()=>[...document.querySelectorAll('astro-island')].every(island=>!island.hasAttribute('ssr')
    && (!island.firstElementChild || Object.keys(island.firstElementChild).some(key=>key.startsWith('__reactFiber')))));
   await page.goto(base+'/admin/documents',{waitUntil:'networkidle'});await hydrated();
   await page.evaluate(()=>{
    window.reconcileSidebar=document.querySelector('[data-portal-sidebar]');
    const pad=()=>document.querySelectorAll('main > .awrap').forEach(node=>node.style.minHeight='2600px');
    document.addEventListener('astro:after-swap',pad);pad();
    window.reconcileScroll=()=>innerWidth>=760?document.querySelector('.portal-main').scrollTop:scrollY;
    window.reconcileSetScroll=y=>innerWidth>=760?document.querySelector('.portal-main').scrollTop=y:scrollTo(0,y);
   });
   const setScroll=async y=>{await page.evaluate(y=>window.reconcileSetScroll(y),y);await page.waitForFunction(y=>window.reconcileScroll()===y,y)};
   const checkScroll=async y=>{await page.waitForFunction(y=>window.reconcileScroll()===y,y)};
   // Real links exercise ClientRouter, with no Playwright auto-scroll before clicking.
   const link=async path=>page.evaluate(async path=>{
    const loaded=new Promise(resolve=>document.addEventListener('astro:page-load',()=>resolve(),{once:true}));
    const anchor=document.createElement('a');anchor.href=path;document.body.append(anchor);anchor.click();anchor.remove();await loaded;
   },path).then(hydrated);
   await setScroll(340);
   await link(`/admin/documents?doc=${seed.publicDoc}`);await checkScroll(340);
   await link('/admin/documents');await checkScroll(340);
   await page.evaluate(async()=>{
    const loaded=new Promise(resolve=>document.addEventListener('astro:page-load',()=>resolve(),{once:true}));
    [...document.querySelectorAll('.ptabs a[href="/admin/documents?tab=forms"]')].find(node=>node.getClientRects().length).click();await loaded;
   });await hydrated();await checkScroll(340);
   await setScroll(470);
   await page.goBack();await page.waitForURL(base+'/admin/documents');await hydrated();await checkScroll(340);
   await page.goForward();await page.waitForURL(/tab=forms/);await hydrated();await checkScroll(470);
   await link('/admin/families');await checkScroll(0);
   await page.goBack();await page.waitForURL(/tab=forms/);await hydrated();await checkScroll(470);
   assert.ok(await page.evaluate(()=>window.reconcileSidebar===document.querySelector('[data-portal-sidebar]')));
   assert.equal(await page.locator('.side .nav a[aria-current=page]').getAttribute('href'),'/admin/documents');
   // Live server search uses replace navigation and retains the mobile window too.
   await link('/admin/families');
   const search=page.locator('form.tools input[name=q]:visible');await search.fill('Ada');
   await setScroll(290);
   await page.waitForURL(/q=Ada/);await page.waitForLoadState('networkidle');await hydrated();await checkScroll(290);
   assert.ok(await search.evaluate(node=>node===document.activeElement));
   // Real same-path POST/redirect, deliberately without email-capable operations.
   // 2026-11 classroom release: prospects share the family page, and a note posts back to that same page.
   await link(`/admin/families/${seed.pat.id}`);
   await page.locator('textarea[name=note]:visible').fill('Reconciled shell scroll regression');
   await setScroll(380);
   const noted=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes(`/admin/families/${seed.pat.id}`));
   await page.locator('form:has(textarea[name=note]) button:visible').first().evaluate(button=>button.form.requestSubmit(button));
   await noted;await page.waitForLoadState('networkidle');await page.waitForFunction(()=>!document.querySelector('form[aria-busy=true]'));await hydrated();await checkScroll(380);
   // A blocked POST exposes duplicate busy handlers synchronously and spinner timing.
   // 2026-11 classroom release: tour times are added from the calendar's add sheet.
   await link('/admin/calendar?new=2027-12-24&type=tour');
   await page.locator('.ssheet input[name=date]:visible').fill('2027-12-24');
   let release;const gate=new Promise(resolve=>release=resolve);let posts=0;
   await page.route('**/admin/calendar*',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    posts++;await gate;await route.fulfill({status:503,contentType:'text/html',body:'<p class="alert-err">Busy rollback probe</p>'});
   });
   const button=page.locator('.ssheet button.btn-p:visible');
   try {
    const immediate=await button.evaluate(button=>{
     const label=button.innerHTML;const start=performance.now();
     window.reconcileSpinner=null;
     new MutationObserver((_,observer)=>{if(button.querySelector('.spin')){window.reconcileSpinner=performance.now()-start;observer.disconnect()}}).observe(button,{childList:true,subtree:true});
     button.form.requestSubmit(button);
     return {unchanged:button.innerHTML===label,spinners:button.querySelectorAll('.spin').length,busy:button.form.getAttribute('aria-busy')};
    });
    assert.deepEqual(immediate,{unchanged:true,spinners:0,busy:'true'});
    await page.waitForFunction(()=>window.reconcileSpinner!==null);
    assert.ok(await page.evaluate(()=>window.reconcileSpinner>=140));
    const busyButton=page.locator('form[aria-busy=true] button.btn-p');
    assert.equal(await busyButton.locator('.spin').count(),1);
    await busyButton.evaluate(button=>button.form.requestSubmit());
   } finally {release()}
   await page.getByText('Busy rollback probe',{exact:true}).waitFor();
   assert.equal(posts,1);assert.ok(await button.isEnabled());assert.equal(await button.locator('.spin').count(),0);
   await page.unrouteAll({behavior:'wait'});
   // Native ClientRouter POSTs defer disabling until serialization. A former
   // bubble-phase shell handler used to replace their label synchronously.
   const html=await page.content();
   let releaseNative;const nativeGate=new Promise(resolve=>releaseNative=resolve);let nativePosts=0;let nativeSubmitter;
   await page.route('**/admin/calendar*',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    nativePosts++;
    const request=new Request(route.request().url(),{method:'POST',headers:route.request().headers(),body:route.request().postDataBuffer()});
    nativeSubmitter=(await request.formData()).get('publish');
    await nativeGate;await route.fulfill({status:200,contentType:'text/html',body:html});
   });
   try {
    const immediate=await page.evaluate(()=>{
     const form=document.createElement('form');form.id='native-busy-probe';form.method='post';form.action=location.href;
     const button=document.createElement('button');button.className='btn btn-p';button.dataset.busy='Saving…';button.name='publish';button.value='yes';button.textContent='Save native';form.append(button);document.body.append(form);
     form.requestSubmit(button);return {label:button.textContent,disabled:button.disabled,spinners:button.querySelectorAll('.spin').length};
    });
    assert.deepEqual(immediate,{label:'Save native',disabled:false,spinners:0});
    await page.locator('#native-busy-probe .spin').waitFor();
    assert.equal(await page.locator('#native-busy-probe .spin').count(),1);
   } finally {releaseNative()}
   await page.waitForFunction(()=>!document.querySelector('#native-busy-probe'));
   assert.equal(nativePosts,1);assert.equal(nativeSubmitter,'yes');
   await page.waitForFunction(()=>!document.querySelector('form[aria-busy=true]'));
   await page.unrouteAll({behavior:'wait'});
   console.log(`Reconciled shell passed: ${width}px; query/POST scroll, history, persisted sidebar, delayed single spinner`);
  } finally {await context.close()}
 }
 assert.deepEqual(errors,[]);
} finally {await browser.close()}
