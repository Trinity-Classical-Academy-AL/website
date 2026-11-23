import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {db,dbReady} from '@tca/school';
const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4441';
const seed=JSON.parse(readFileSync('/tmp/tca-e2e-seed.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
const ids=[];let contexts=[];
const shot=async(page,name,width)=>{if(process.env.PB_SHOTS){mkdirSync(process.env.PB_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.PB_SHOTS}/${name}-${width}.png`,fullPage:true,animations:'disabled'});}};
try {
 await dbReady();
 for(const [type,prior,family,days]of [['interview',false,false,0],['visit',false,false,20],['newsletter',false,false,0],['teaching',true,false,200],['other',false,true,1],['inquiry',false,false,1]]){
 const id=randomUUID();ids.push(id);await db()`insert into inquiries(id,name,email,contact_type,source,created_at,prior_year,already_family)values(${id},${'PB '+type},${'pb-'+type+'@example.com'},${type},${type==='interview'?'formaloo_interview':type},${new Date(Date.now()-days*86400000).toISOString()},${prior},${family})`;}
 for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await context.addCookies([{name:'tca_family_session',value:seed.cookies.office,url:base}]);
 const page=await context.newPage();page.on('pageerror',e=>console.error('PB browser error:',e.message));page.setDefaultTimeout(12000);const go=path=>page.goto(base+path,{waitUntil:'networkidle'});const rows=()=>page.locator('tr[data-row]:visible');const sheet=()=>page.locator('.ssheet:visible');
 await db()`update inquiries set status='new',contacted_at=null,contacted_by=null where id in ${db()(ids)}`;
 // Incoming contacts are the Prospects tab of Families now. Each email-only inquiry is its own family row,
 // keyed by its id; old /admin/prospects links (filters and ?contact=) redirect there.
 const row=id=>page.locator(`tr[data-row="${id}"]:visible`);
 await go('/admin/prospects');assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/admin/families?tab=prospects');assert.equal(await page.getByRole('tab',{name:'Prospects',exact:true}).getAttribute('aria-selected'),'true');await row(ids[0]).waitFor();assert.equal(await row(ids[3]).count(),0);await shot(page,'incoming',width);
 await page.locator('button.fsel:visible',{hasText:'Last activity'}).click();await page.locator('.fsel-item:visible',{hasText:'All time'}).click();await row(ids[3]).waitFor();await shot(page,'prior-year',width);
 await go('/admin/prospects?filter=overdue');await row(ids[1]).waitFor();assert.equal(await row(ids[0]).count(),0);await shot(page,'overdue',width);
 await go('/admin/families?tab=prospects&stage=updates');await row(ids[2]).waitFor();assert.equal(await row(ids[0]).count(),0);assert.ok((await rows().allTextContents()).every(t=>t.includes('Updates list')));await shot(page,'type-filter',width);
 await go('/admin/families?tab=prospects');await row(ids[0]).locator('strong').first().click();await sheet().waitFor();await shot(page,'contact-sheet',width);
 let release;const held=new Promise(r=>release=r);await page.route('**/admin/families*',async route=>{if(route.request().method()==='POST'){await held;}await route.continue();});
 await sheet().getByRole('button',{name:'Mark contacted',exact:true}).click();assert.equal(await row(ids[0]).locator('[data-status]').textContent(),'Contacted');assert.match(await row(ids[0]).locator('[data-contacted]').textContent(),/Office|@/);assert.equal(await page.locator('.ssheet:visible').count(),0);release();await page.waitForFunction(()=>!document.querySelector('form[aria-busy="true"]'));await page.unroute('**/admin/families*');await go('/admin/families?tab=prospects');assert.equal((await db()`select status from inquiries where id=${ids[0]}`)[0].status,'contacted');
 await row(ids[1]).locator('strong').first().click();const email=sheet().getByRole('link',{name:'pb-visit@example.com',exact:true});assert.equal(await email.getAttribute('href'),'mailto:pb-visit@example.com');
 // Suppress only the OS mail app in automation; the page's contact handler still executes.
 await email.evaluate(el=>el.addEventListener('click',e=>e.preventDefault(),{once:true}));const emailStarted=page.waitForRequest(r=>r.url().includes('/admin/families')&&r.method()==='POST');await email.click();await emailStarted;for(let attempt=0;attempt<50;attempt++){if((await db()`select status from inquiries where id=${ids[1]}`)[0].status==='contacted')break;await new Promise(r=>setTimeout(r,100));}await go('/admin/families?tab=prospects');assert.equal((await db()`select status from inquiries where id=${ids[1]}`)[0].status,'contacted');assert.ok((await db()`select * from inquiry_activity where inquiry_id=${ids[1]} and kind='emailed'`).length);
 await row(ids[0]).locator('strong').first().click();await sheet().getByRole('textbox',{name:'Add a note',exact:true}).fill('PB follow up');await sheet().getByRole('button',{name:'Add note',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('form[aria-busy="true"]'));await go(`/admin/prospects?contact=${ids[0]}`);await sheet().getByText('PB follow up',{exact:true}).first().waitFor();await page.keyboard.press('Escape');await page.waitForURL(url=>!url.searchParams.has('family'));await page.locator('.ov:visible').waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.has('family'),false);
 await go('/admin/prospects?q=absolutely-no-matches-pb');await page.getByText('No families match',{exact:true}).filter({visible:true}).waitFor();await shot(page,'empty',width);
 await go('/admin/families');assert.ok(await page.locator('a[href^="mailto:"]:visible').count());await shot(page,'families-email',width);
 await go('/admin/families/'+seed.ada.id);assert.equal(await page.getByRole('link',{name:seed.ada.email,exact:true}).filter({visible:true}).first().getAttribute('href'),'mailto:'+seed.ada.email);await shot(page,'family-email',width);
 // Staff & access lists each person's sign-in email as text now, not a mail link.
 await go('/admin/staff');assert.ok(await page.locator('td:visible').filter({hasText:/^\S+@\S+$/}).count());await shot(page,'staff-email',width);
 await context.addCookies([{name:'tca_family_session',value:seed.cookies.ada,url:base}]);await go('/admin/prospects');assert.match(page.url(),/no-access/);
 await context.close();contexts=[];console.log(`Incoming ${width}: passed`);
 }
} finally {for(const c of contexts)await c.close();await browser.close();if(ids.length)await db()`delete from inquiries where id in ${db()(ids)}`;await db().end();}
