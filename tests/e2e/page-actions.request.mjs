// Run against tests/e2e/preview.mjs after seed.mjs. These are existing wire contracts,
// including legacy action names, missing removal toasts, and HTTP-200 errors.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { db, dbReady, guardianForms, listAdminForms, getBannerDocument, writeSetting } from '@tca/school';
const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4441';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
await dbReady();
const expired = 'That request expired. Try again.';
const uuid = '[0-9a-f-]{36}';
const cleanup = [];
after(async () => { for (const fn of cleanup.reverse()) await fn(); await db().end(); });
function client(role = 'office') {
 const jar = new Map([['tca_family_session', seed.cookies[role]]]);
 return async (path, data, headers = {}) => {
  const response = await fetch(base + path, { method: data ? 'POST' : 'GET', redirect: 'manual', headers: { cookie: [...jar].map(([k,v])=>`${k}=${v}`).join('; '), ...headers }, ...(data ? {body: data instanceof FormData ? data : new URLSearchParams(data)} : {}) });
  for (const cookie of response.headers.getSetCookie()) { const [key,value] = cookie.split(';')[0].split('='); jar.set(key,value); }
  const html = await response.text(); const doc = parseHTML(html.includes('<html') ? html : `<html><body>${html}</body></html>`).document;
  return { status: response.status, location: response.headers.get('location'), html, doc, text: doc.body.textContent.replace(/\s+/g,' ').trim(), csrf: doc.querySelector('[name="csrf"]')?.value || jar.get('tca_csrf') };
 };
}
async function redirect(c, path, data, pattern, toast = '') {
 const result = await c(path, data);
 assert.equal(result.status, 302, result.html.slice(0, 300));
 if (pattern instanceof RegExp) assert.match(result.location, pattern); else assert.equal(result.location, pattern);
 const landing = await c(result.location); assert.equal(landing.status, 200);
 if (toast) assert.ok(landing.text.includes(toast), `missing ${toast}`);
 return result.location;
}
async function rejected(c, path, data, message = expired, field = '') {
 const result = await c(path, data); assert.equal(result.status, 200); assert.ok(result.text.includes(message), `missing ${message}`);
 if (field) assert.ok([...result.doc.querySelectorAll('.errm')].some(node => node.textContent.includes(field)));
 return result;
}

test('tours: CSRF, field errors/draft/tab, save toast, confirmation and hard delete', async () => {
 const c = client(); const {csrf} = await c('/admin/tours');
 await rejected(c, '/admin/tours', {action:'slot', tab:'times'});
 const bad = await rejected(c, '/admin/tours', {csrf, action:'slot', date:'bad', start:'11:00 AM', end:'10:00 AM', capacity:'0'}, 'Fix 3 fields to save.', 'End must be after start.');
 assert.equal(bad.doc.querySelector('input[name="date"]').value, 'bad');
 const loc = await redirect(c, '/admin/tours', {csrf, action:'slot', date:'05/23/2028', start:'9:00 AM', end:'10:00 AM', capacity:'1', published:'on'}, new RegExp(`^/admin/tours\\?saved=${uuid}$`), 'Time saved.');
 const id = new URL(loc,base).searchParams.get('saved');
 const confirm = await c(`/admin/tours?slot=${id}&confirm=${id}`); assert.ok(confirm.doc.querySelector('[role="alertdialog"] form [name="action"][value="delete"]'));
 await redirect(c, '/admin/tours', {csrf, action:'delete', id}, '/admin/tours?removed=1', 'Time deleted.');
 assert.equal((await db()`select id from tour_slots where id=${id}`).length,0);
});
test('events: plural validation copy, save toast and deletion with no toast', async () => {
 const c = client(); const {csrf} = await c('/admin/events');
 await rejected(c,'/admin/events',{title:'ignored'});
 await rejected(c,'/admin/events',{csrf, date:'05/23/2028'},'Fix 1 fields to save.','Add a title.');
 const loc = await redirect(c,'/admin/events',{csrf,title:'R1 event',date:'05/23/2028',rsvp:'on',website:'on'},new RegExp(`^/admin/events\\?saved=${uuid}$`),'R1 event saved and shown on the website.');
 const id = new URL(loc,base).searchParams.get('saved');
 const confirm = await c(`/admin/events?event=${id}&confirm=1`); assert.ok(confirm.doc.querySelector('[role="alertdialog"] [name="action"][value="delete"]'));
 await redirect(c,'/admin/events',{csrf,action:'delete',id},'/admin/events?removed=1');
 assert.equal((await db()`select id from events where id=${id}`).length,0);
});
test('documents: validation, multipart save, saved toast, legacy delete-doc action', async () => {
 const c=client(); const {csrf}=await c('/admin/documents?sheet=upload');
 await rejected(c,'/admin/documents?sheet=upload',{title:'ignored'});
 await rejected(c,'/admin/documents?sheet=upload',{csrf},'Add a title.');
 const data=new FormData(); for(const [k,v] of Object.entries({csrf,title:'R1 document',audience:'everyone',publish:'yes'})) data.set(k,v);
 data.set('file',new File(['%PDF-1.4\n%%EOF'],'r1.pdf',{type:'application/pdf'}));
 const loc=await redirect(c,'/admin/documents',data,new RegExp(`^/admin/documents\\?saved=${uuid}$`),'Document published.');
 const id=new URL(loc,base).searchParams.get('saved');
 const confirm=await c(`/admin/documents?doc=${id}&confirm=1`); assert.ok(confirm.doc.querySelector('[role="alertdialog"] [value="delete-doc"]'));
 await redirect(c,'/admin/documents',{csrf,action:'delete-doc',id},'/admin/documents?removed=1');
 assert.equal((await db()`select id from school_documents where id=${id}`).length,0);
});
test('families: student/guardian validation, save toast, remove-student redirect', async () => {
 const c=client(); const path=`/admin/families/${seed.ada.id}`; const {csrf}=await c(path+'?sheet=student');
 await rejected(c,path,{action:'student'});
 await rejected(c,path,{csrf,action:'student'},'Enter a first and last name.');
 await rejected(c,path+'?sheet=guardian',{csrf,action:'guardian',email:'bad'},'Enter an email address like name@example.com.');
 const loc=await redirect(c,path,{csrf,action:'student',first:'R1',last:'Student',grade:'3'},new RegExp(`^${path}\\?saved=${uuid}$`),'Student saved.');
 const id=new URL(loc,base).searchParams.get('saved');
 await redirect(c,path,{csrf,action:'remove-student',id},path);
 assert.equal((await db()`select id from students where id=${id}`).length,0);
});
test('staff: invite validation/toast; remove keeps account and has no toast', async () => {
 const c=client(); const {csrf}=await c('/admin/staff');
 await rejected(c,'/admin/staff',{});
 await rejected(c,'/admin/staff',{csrf,email:'bad'},'Enter an email address like name@example.com.');
 const email=`r1-${randomUUID()}@trinityclassical.academy`;
 cleanup.push(()=>db()`delete from families where email=${email}`);
 await redirect(c,'/admin/staff',{csrf,email},`/admin/staff?invited=${encodeURIComponent(email)}`,`Invite sent to ${email}.`);
 const id=randomUUID(); await db()`insert into families(id,name,email,password_hash,roles) values(${id},'R1 Staff',${`r1-${id}@example.com`},'',${['admin']})`;
 cleanup.push(()=>db()`delete from families where id=${id}`);
 const confirm=await c(`/admin/staff?remove=${id}`); assert.ok(confirm.doc.querySelector('[name="action"][value="remove"]'));
 await redirect(c,'/admin/staff',{csrf,action:'remove',id},'/admin/staff');
 assert.deepEqual((await db()`select roles from families where id=${id}`)[0].roles,['prospect']);
});
test('website: banner field errors/draft, save state/toast, draft announcement deletion', async () => {
 const c=client(); const {csrf}=await c('/admin/website'); const prior=await getBannerDocument();
 cleanup.push(()=>prior ? writeSetting('banner',prior) : db()`delete from settings where key='banner'`);
 await rejected(c,'/admin/website',{});
 await rejected(c,'/admin/website',{csrf,enabled:'on',text:'x'.repeat(121),clickAction:'url',url:'https://example.com'},'Fix 1 field before saving. The live banner hasn’t changed.');
 await redirect(c,'/admin/website',{csrf,enabled:'on',text:'R1 banner',clickAction:'url',url:'https://example.com'},'/admin/website?saved=1&state=live','Banner saved. Live on the website now.');
 await rejected(c,'/admin/website?tab=announcements',{csrf,action:'announcement'},'Add a title.');
 const loc=await redirect(c,'/admin/website?tab=announcements',{csrf,action:'announcement',title:'R1 draft',body:'Draft body',publish:'no'},new RegExp(`^/admin/website\\?tab=announcements&saved=${uuid}&mailed=0$`));
 const id=new URL(loc,base).searchParams.get('saved');
 await redirect(c,'/admin/website?tab=announcements',{csrf,action:'delete-announcement',id},'/admin/website?tab=announcements&removed=1');
 assert.equal((await db()`select id from announcements where id=${id}`).length,0);
});
test('account: errors redirect with exact dialog/copy; name save; confirmed email removal', async () => {
 const c=client('ada'); const {csrf}=await c('/account');
 await redirect(c,'/account',{action:'name'},'/account?error=That+request+expired.+Try+again.',expired);
 await redirect(c,'/account',{csrf,action:'name',name:''},'/account?dialog=name&error=Enter+your+name.','Enter your name.');
 cleanup.push(()=>db()`update families set name=${seed.ada.name},first_name='',last_name='' where id=${seed.ada.id}`);
 await redirect(c,'/account',{csrf,action:'name',name:'R1 Name'},'/account?notice=Name+saved.','Name saved.');
 const id=randomUUID(); const email=`r1-${id}@example.com`;
 await db()`insert into family_emails(id,family_id,email,is_primary,verified_at) values(${id},${seed.ada.id},${email},false,now())`;
 cleanup.push(()=>db()`delete from family_emails where id=${id}`);
 const confirm=await c(`/account?dialog=remove&id=${id}`); assert.ok(confirm.doc.querySelector('[name="confirm"][value="yes"]'));
 await redirect(c,'/account',{csrf,action:'remove',id,confirm:'yes'},'/account?notice=Email+removed.','Email removed.');
});
test('remaining admin pages: inquiries, prospects and form tracker contracts', async () => {
 const c=client(); const {csrf}=await c('/admin/inquiries');
 await rejected(c,'/admin/inquiries',{});
 await redirect(c,'/admin/inquiries',{csrf,action:'status',status:'invalid'},'/admin/inquiries');
 const path=`/admin/prospects/${seed.pat.id}`;
 await rejected(c,path,{});
 const enrolled=await c(path+'?enrolled=1');assert.ok(enrolled.text.includes('is enrolled. Add students from Families.'));
 await redirect(c,path,{csrf,action:'note',note:'R1 note'},path+'?noted=1','Note saved.');
 cleanup.push(()=>db()`update families set staff_note='' where id=${seed.pat.id}`);
 const form=(await listAdminForms()).find(f=>f.title==='Photo release'); assert.ok(form);
 const tracker=`/admin/forms/${form.id}`;
 const ignored=await c(tracker,{action:'remind'}); assert.equal(ignored.status,200); assert.ok(!ignored.text.includes(expired));
 const result=await c(tracker,{csrf,action:'remind'}); assert.equal(result.status,302); assert.match(result.location,new RegExp(`^${tracker}\\?(reminded=\\d+|limited=1)$`));
});
test('guardian form: draft saved on validation, draft redirect/toast', async () => {
 const c=client('ada'); const form=(await guardianForms(seed.ada.id)).find(f=>f.title==='Photo release'); const path=`/g/forms/${form.id}`; const {csrf}=await c(path);
 await rejected(c,path,{});
 await rejected(c,path,{csrf,publish:'yes'},'Fix 3 things before you submit. Your answers are saved as a draft.');
 await redirect(c,path,{csrf,publish:'no'},path+'?draft=1','Draft saved. You can finish later.');
 cleanup.push(()=>db()`update form_assignments set status='missing',answers='{}'::jsonb,signature_name='' where id=${form.id}`);
});
test('family tour and events: validation, cancellation and unchanged redirects', async () => {
 const c=client('pat'); const {csrf}=await c('/tour');
 await rejected(c,'/tour',{});
 await rejected(c,'/tour',{csrf},'Choose a time to continue.');
 await redirect(c,'/tour',{csrf,action:'other',days:'Tue'},'/tour?requested=1','Request sent.');
 const [hold]=await db()`select id from tour_holds where family_id=${seed.pat.id} and other_time like '%Tue%' order by created_at desc limit 1`; assert.ok(hold);
 await redirect(c,'/tour',{csrf,action:'cancel',id:hold.id},'/tour?cancelled=1','Tour cancelled.');
 cleanup.push(()=>db()`delete from tour_holds where id=${hold.id}`);
 await rejected(c,'/events',{});
 await rejected(c,'/events',{csrf,eventId:randomUUID()},'That event is not open.');
 const eventId=randomUUID(); await db()`insert into events(id,title,starts_at,collect_rsvp) values(${eventId},'R1 family event','2030-05-23T15:00:00Z',true)`;
 cleanup.push(()=>db()`delete from events where id=${eventId}`);
 await rejected(c,'/events',{csrf,eventId,headCount:'0'},'Choose between 1 and 20 people.');
 await redirect(c,'/events',{csrf,eventId,headCount:'2',action:'save'},'/events');
 assert.equal((await db()`select head_count from rsvps where event_id=${eventId} and family_id=${seed.pat.id}`)[0].head_count,2);
 await redirect(c,'/events',{csrf,eventId,action:'cancel'},'/events');
 assert.equal((await db()`select id from rsvps where event_id=${eventId}`).length,0);
});
test('public interested/interview: CSRF, validation and success stays HTTP 200', async () => {
 const c=client(); const {csrf}=await c('/interested');
 for(const path of ['/interested','/interview']) {
  await rejected(c,path,{});
  const bad=await c(path,{csrf}); assert.equal(bad.status,200);
  assert.ok(bad.text.includes(path==='/interested'?'Enter an email address like name@example.com.':'Add your first and last name, email, phone, enrollment year, and a name for each child.'));
  const done=await c(path,{csrf,website:'bot'}); assert.equal(done.status,200); assert.match(done.text,/Thank|sent|received/i);
  const email=`r1-${randomUUID()}@example.com`;
  cleanup.push(()=>db()`delete from inquiries where email=${email}`);
  const saved=await c(path,{csrf,email,name:'R1 Family',firstName:'R1',lastName:'Family',phone:'2055550101',year:'2027','child.0.name':'R1 Child'});
  assert.equal(saved.status,200);assert.match(saved.text,/Received|We received your request/);
  assert.equal((await db()`select id from inquiries where email=${email}`).length,1);
 }
});
test('public RSVP: JSON/HTML statuses, drafts, exact 303 return, no new guest rows', async () => {
 const id='ec99c6a0-30da-4b66-8ccb-777c05360f4b'; const path=`/rsvp/${id}`; const c=client('ada'); const {csrf}=await c(path);
 const guestsBefore=(await db()`select count(*)::int as n from event_guest_rsvps where event_id=${id}`)[0].n;
 const expiredResponse=await c(path,{}, {accept:'application/json'}); assert.equal(expiredResponse.status,403); assert.deepEqual(JSON.parse(expiredResponse.html),{ok:false,error:expired});
 const invalid=await c(path,{csrf,headCount:'0',note:'keep'}, {accept:'application/json'}); assert.equal(invalid.status,422); assert.deepEqual(JSON.parse(invalid.html),{ok:false,error:'Choose between 1 and 20 people.'});
 const json=await c(path,{csrf,headCount:'3',note:' note '},{accept:'application/json'});assert.equal(json.status,200);assert.deepEqual(JSON.parse(json.html),{ok:true,headCount:3,note:'note'});
 const saved=await c(path,{csrf,headCount:'2',note:' note '}); assert.equal(saved.status,303); assert.equal(saved.location,base+path);
 cleanup.push(()=>db()`delete from rsvps where event_id=${id} and family_id=${seed.ada.id}`);
 assert.equal((await db()`select count(*)::int as n from event_guest_rsvps where event_id=${id}`)[0].n,guestsBefore);
 const anon=client('none'); const denied=await anon(path,{csrf}, {accept:'application/json'}); assert.equal(denied.status,401); assert.deepEqual(JSON.parse(denied.html),{ok:false,error:'Sign in to RSVP.'});
});
