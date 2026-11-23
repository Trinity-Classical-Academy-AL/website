/** Transport smoke checks for every formerly forced-reload form.
 * Email-capable operations are intercepted before they can reach the server.
 * Run serially after seed.mjs with the same env as optimistic.playwright.mjs.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {db, addTourSlot, saveEvent, saveAnnouncement, guardianForms, listAdminForms, listStudents} from '@tca/school';
const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4393';
const seed=JSON.parse(readFileSync('/tmp/tca-e2e-seed.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox']});
const context=await browser.newContext();
await context.addCookies([{name:'tca_family_session',value:seed.cookies.office,url:base}]);
const page=await context.newPage();page.setDefaultTimeout(15000);
let checked=0;
const stamp=Date.now();
try {
 const existing=await db()`select id from tour_slots where slot_date='2028-05-21' and start_time='10:00' and end_time='11:00'`;
 const slot=existing[0]?{ok:true,id:String(existing[0].id)}:await addTourSlot({date:'2028-05-21',start:'10:00',end:'11:00',capacity:12,published:true});assert.ok(slot.ok);
 const event=await saveEvent({title:`Transport event ${stamp}`,description:'Local only',startsAt:'2028-05-21T10:00:00',location:'Campus',collectRsvp:true});
 const announcement=await saveAnnouncement({title:'Transport draft',body:'Local fixture',audience:'all',emailIt:false,publish:false});assert.ok(announcement.ok);
 const request=randomUUID();
 await db()`insert into tour_holds (id,family_id,kind,status,family_name,email,other_time,proposed_date,proposed_start,proposed_end) values (${request},${seed.pat.id},'other','proposed','Local fixture',${seed.pat.email},'Morning','2028-05-21','10:00','11:00')`;
 const forms=await listAdminForms();const form=forms.find(row=>row.title==='Photo release');assert.ok(form);
 // The existing saveSchoolForm seed stores questions as a JSON string in local Postgres.
 // Normalize only this fixture so the guardian page can render; server serialization is another lane.
 await db()`update school_forms set questions=(questions #>> '{}')::jsonb where id=${form.id} and jsonb_typeof(questions)='string'`;
 const assignment=(await guardianForms(seed.ada.id)).find(row=>row.title==='Photo release');assert.ok(assignment);
 const student=(await listStudents(seed.ada.id))[0];assert.ok(student);
 async function probe(path,button,fields={},fill={},token=seed.cookies.office,file=false) {
  await context.addCookies([{name:'tca_family_session',value:token,url:base}]);
  console.log('transport',path.split('?')[0],Object.values(fields).join('/'));
  await page.goto(base+path);await page.waitForLoadState('networkidle');
  for(const [name,value]of Object.entries(fill)) {
   const input=page.locator(`[name="${name}"]`).filter({visible:true}).first();
   if(value===true)await input.check();else await input.fill(value);
  }
  if(file)await page.locator('input[type=file]').filter({visible:true}).first().setInputFiles({name:'transport.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
  let postCount=0,documentRequests=0;
  const count=req=>{if(req.isNavigationRequest()&&req.frame()===page.mainFrame())documentRequests++};page.on('request',count);
  let body;
  await page.route('**/*',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   postCount++;
   const request=new Request(route.request().url(),{method:'POST',headers:route.request().headers(),body:route.request().postDataBuffer()});
   body=await request.formData();
   return route.fulfill({status:200,contentType:'text/html',body:'<p class="alert alert-err">Intercepted transport check</p>'});
  });
  // An array clicks in order: the button, then the confirmation dialog's Yes.
  for(const target of [button].flat())await page.locator(target).filter({visible:true}).first().click();
  await page.getByText('Intercepted transport check',{exact:true}).waitFor();
  assert.equal(postCount,1,path);assert.equal(documentRequests,0,path);
  assert.ok(String(body.get('csrf')||'').length>10,'CSRF retained');
  for(const[key,value]of Object.entries(fields))assert.equal(body.get(key),value,`${path}: ${key}`);
  if(file)assert.ok(body.get('file') instanceof File && body.get('file').size>0,'Multipart file retained');
  await page.unrouteAll({behavior:'wait'});page.off('request',count);checked++;
 }
 const primary='.ssheet button.btn-p';
 // 2026-11 classroom release: tour times are calendar items, and tour requests are answered from Calendar → RSVPs.
 const yes='.confirm-ov [data-yes]';
 await probe('/admin/calendar?new=2028-05-22&type=tour',primary,{action:'save-tour'});
 await probe(`/admin/calendar?item=tour:${slot.id}`,['button[form^=delete-item]',yes],{action:'delete-tour',id:slot.id});
 await probe(`/admin/calendar/rsvps?show=reply&reply=${seed.tourRequest}`,primary,{action:'reply',id:seed.tourRequest},{date:'2028-05-23'});
 await probe(`/admin/calendar/rsvps?show=reply&reply=${seed.tourRequest}`,['button[form^=decline-request]',yes],{action:'decline',id:seed.tourRequest});
 await probe('/admin/events?sheet=new',primary);
 await probe(`/admin/events?event=${event}&confirm=1`,'.dlg button',{action:'delete',id:event});
 await probe('/admin/website','form[data-banner-form] button.btn-p');
 // Announcements have their own editor page now.
 await probe('/admin/announcements/new','button[name=publish][value=no]',{publish:'no'},{title:'Transport announcement'});
 await probe('/admin/announcements/new','button[name=publish][value=yes]',{publish:'yes'},{title:'Transport announcement'});
 await probe(`/admin/announcements/${announcement.id}`,'button[name=action][value=delete]',{action:'delete'});
 await probe(`/admin/families/${seed.ada.id}?sheet=student`,primary,{action:'student'});
 await probe(`/admin/families/${seed.ada.id}?student=${student.id}`,'button[data-submit-action=remove-student]',{action:'remove-student',id:student.id});
 await probe(`/admin/families/${seed.ada.id}?sheet=guardian`,primary,{action:'guardian'});
 // Prospects share the family page now.
 await probe(`/admin/families/${seed.pat.id}`,'form:has(textarea[name=note]) button',{action:'note'}, {note:'Transport note'});
 await probe(`/admin/families/${seed.pat.id}?enroll=1`,'.dlg button.btn-p',{action:'enroll'});
 await probe('/admin/documents?sheet=upload','button[name=publish][value=yes]',{publish:'yes'},{},seed.cookies.office,true);
 await probe(`/admin/documents?doc=${seed.publicDoc}&confirm=1`,'.dlg button',{action:'delete-doc',id:seed.publicDoc});
 // Forms need a title before they submit now.
 await probe('/admin/documents?tab=forms&sheet=form','button[name=publish][value=no]',{action:'form',publish:'no'},{title:'Transport form'});
 await probe('/admin/documents?tab=forms&sheet=form','button[name=publish][value=yes]',{action:'form',publish:'yes'},{title:'Transport form'});
 await probe(`/admin/forms/${form.id}?remind=1`,'.dlg button',{action:'remind'});
 await probe('/admin/staff?sheet=add',primary,{action:'add'}, {email:'local-only@trinityclassical.academy'});
 await probe(`/g/forms/${assignment.id}`,'button[name=publish][value=no]',{publish:'no'},{},seed.cookies.ada);
 await probe(`/g/forms/${assignment.id}`,'button[name=publish][value=yes]',{publish:'yes'},{},seed.cookies.ada);
 await probe('/tour?other=1','.ssheet button.btn-p',{action:'other'},{},seed.cookies.pat);
 await probe('/tour','form:has(input[value=book]) button.btn-p',{action:'book'},{},seed.cookies.pat);
 await probe('/tour',`form:has(input[name=id][value="${request}"]) button.btn-p`,{action:'accept',id:request},{},seed.cookies.pat);
 await probe(`/tour?cancel=${request}`,'.dlg button',{action:'cancel',id:request},{},seed.cookies.pat);
 await probe('/home',`form:has(input[name=id][value="${request}"]) button.btn-p`,{action:'accept',id:request},{},seed.cookies.pat);
 await probe('/events','button[name=action][value=save]',{action:'save'},{},seed.cookies.pat);
 // Settings/auth remain progressive: dialog POST errors preserve typed values and cookies.
 await probe('/account?dialog=name','.dlg button.btn-p',{action:'name'},{name:'Local name'},seed.cookies.pat);
 console.log(`${checked} form transport checks passed (email-capable POSTs intercepted)`);
} finally {await context.close();await browser.close();await db().end();}
