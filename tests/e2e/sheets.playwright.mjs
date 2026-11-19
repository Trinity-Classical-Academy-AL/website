import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { db, listSeries, listTourSlotSummary } from '@tca/school';
const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4323';
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
const rule = (await listSeries())[0], slot = (await listTourSlotSummary()).find(s => !s.seriesId);
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox']});
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.addCookies([{name:'tca_family_session',value:seed.cookies.office,url:base}]);
  const page=await context.newPage(); page.setDefaultTimeout(7000);
  const sheet=()=>page.locator('.ssheet:visible');
  const closed=async(path='/admin/tours')=>{
   await page.waitForURL(base+path);
   await page.locator('.ov:visible').waitFor({state:'hidden'});
   // Both responsive copies must agree, including the copy CSS currently conceals.
   assert.equal(await page.locator('.ov:not([hidden])').count(),0);
  };
  const openAdd=async()=>{
   await page.goto(base+'/admin/tours',{waitUntil:'networkidle'});
   await page.getByRole('link',{name:'Add time',exact:true}).click();
   await sheet().waitFor(); await page.waitForURL(base+'/admin/tours?sheet=add');
  };
  await openAdd(); await sheet().getByRole('link',{name:'Close',exact:true}).click(); await closed();
  await openAdd(); await sheet().getByRole('link',{name:'Cancel',exact:true}).click(); await closed();
  for(const query of [`slot=${slot.id}`,`rule=${rule.id}`]) {
   await page.goto(base+'/admin/tours',{waitUntil:'networkidle'});
   await page.locator(`a[href="/admin/tours?${query}"]:visible`).click(); await sheet().waitFor();
   await sheet().getByRole('link',{name:'Close',exact:true}).click(); await closed();
  }
  await page.locator(`a[href="/admin/tours?slot=${slot.id}"]:visible`).click(); await sheet().waitFor();
  await page.goBack(); await closed();
  await page.goForward(); await sheet().waitFor(); assert.equal(new URL(page.url()).searchParams.get('slot'),slot.id);
  await page.keyboard.press('Escape'); await closed();
  await openAdd();
  // Exercise history for an instant-rendered Add sheet too.
  await page.goBack(); await closed(); await page.goForward(); await sheet().waitFor();
  await page.keyboard.press('Escape'); await closed();
  await openAdd();
  // Mobile sheets occupy the full viewport, so dispatch the backdrop event directly there.
  if(width === 390) await page.locator('.ov-side:visible').dispatchEvent('click');
  else await page.locator('.ov-side:visible').click({position:{x:2,y:2}});
  await closed();
  // Shared primitive on a second page, including an edit + nested confirmation.
  await page.goto(base+'/admin/events',{waitUntil:'networkidle'});
  await page.getByRole('link',{name:'New event',exact:true}).first().click(); await sheet().waitFor();
  await sheet().getByRole('link',{name:'Close',exact:true}).click(); await closed('/admin/events');
  await page.goto(base+`/admin/documents?doc=${seed.publicDoc}`,{waitUntil:'networkidle'}); await sheet().waitFor();
  await sheet().getByLabel('Title',{exact:true}).fill('Keep this unsaved draft');
  await sheet().getByRole('link',{name:'Delete',exact:true}).click();
  const confirm=page.getByRole('alertdialog'); await confirm.waitFor();
  await page.keyboard.press('Escape'); await confirm.waitFor({state:'hidden'}); await sheet().waitFor();
  await page.waitForURL(url=>!url.searchParams.has('confirm'));
  assert.equal(new URL(page.url()).searchParams.has('confirm'),false);
  assert.equal(await sheet().getByLabel('Title',{exact:true}).inputValue(),'Keep this unsaved draft');
  await sheet().getByRole('link',{name:'Cancel',exact:true}).click(); await closed('/admin/documents');
  await context.addCookies([{name:'tca_family_session',value:seed.cookies.pat,url:base}]);
  await page.goto(base+'/tour?other=1',{waitUntil:'networkidle'}); await sheet().waitFor();
  await sheet().getByRole('link',{name:'Close',exact:true}).click(); await closed('/tour');
  await page.locator('form:visible [name=slotId]').first().waitFor({state:'visible'});
  await context.close(); console.log(`sheet URL, X, Cancel, Escape, backdrop and history checks passed at ${width}`);
 }
} finally {await browser.close(); await db().end();}
