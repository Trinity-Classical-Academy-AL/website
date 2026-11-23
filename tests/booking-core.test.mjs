import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';

// Module mocking runs in a child so the ordinary unit-test command needs no flags.
if (!process.execArgv.includes('--experimental-test-module-mocks')) {
 test('booking DB characterization (isolated mocked deliverer)', { skip: !process.env.DATABASE_URL }, async () => {
  try {
   const childEnv = { ...process.env, RESEND_API_KEY: '', SCHOOL_NOTIFY_WEBHOOK_URL: '' };
   delete childEnv.NODE_TEST_CONTEXT;
   const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--test', '--test-concurrency=1', import.meta.filename], { env: childEnv, maxBuffer: 2e6 });
   console.log(stdout);
  } catch (error) { assert.fail(error.stdout + error.stderr); }
 });
} else {
 const original = await import('../packages/school/src/email.ts');
 const calls = [];
 mock.module('../packages/school/src/email.ts', { namedExports: { ...original,
  // Families' emails come from the catalog (copy is editable in Developer → Emails), so record who, what and which template.
  sendEmail: async input => { calls.push(['email', { to: input.to, subject: input.subject, template: input.template }]); return { delivered: false, reason: 'test' }; },
  notifyStaff: async (...args) => { calls.push(['staff', ...args]); return { delivered: false, reason: 'test' }; },
 } });
 const s = await import('../packages/school/src/index.ts');
 const { randomUUID } = await import('node:crypto');
 const today = '2027-01-01', campus = '7160 Cahaba Valley Rd., Birmingham, AL 35242';
 async function fixture(t) {
  await s.dbReady(); calls.length = 0;
  const families = [randomUUID(), randomUUID(), randomUUID()];
  const slots = [], rules = [];
  let holdNumber = 0;
  for (const id of families) await s.db()`insert into families (id,name,email,phone,roles) values (${id}, 'Test family', ${id+'@example.com'}, '', ${['prospect']})`;
  await s.db()`insert into notification_routes (family_id,category,email) values (${families[0]}, 'tours', 'routed@example.com')`;
  t.after(async () => {
   await s.db()`delete from families where id = any(${families}::uuid[])`;
   await s.db()`delete from tour_slots where id = any(${slots}::uuid[]) or series_id = any(${rules}::uuid[])`;
   await s.db()`delete from schedule_series where id = any(${rules}::uuid[])`;
  });
  return { families, slots, rules,
   async slot(overrides={}) {
    const data={date:'2027-01-05',start:'01:00',end:'01:30',capacity:6,capacityUnit:'people',...overrides};
    const result=await s.addTourSlot(data); assert.equal(result.ok,true,JSON.stringify(result)); slots.push(result.id); return {...data,id:result.id};
   },
   async rule(overrides={}) {
    const result=await s.saveSeries({type:'tour',weekdays:[0,1,2,3,4,5,6],start:'02:00',end:'02:30',startsOn:'2027-01-01',endsOn:'2027-01-04',capacity:1,capacityUnit:'families',published:true,bookingWindowDays:1,...overrides});
    assert.equal(result.ok,true); rules.push(result.id); return result.id;
   },
   party(slotId, familyId=families[0], extra={}) { return {familyId,familyName:' Test family ',email:familyId+'@example.com',phone:' 555 ',slotId,grades:['8','K','K','invalid'],note:' note ',...extra}; },
   async hold(slotId=null, familyId=families[0], status='new', kind=slotId?'slot':'other', extra={}) {
    const id=randomUUID(); await s.db()`insert into tour_holds ${s.db()({id,family_id:familyId,slot_id:slotId,kind,status,family_name:'Test family',email:familyId+'@example.com',head_count:2,other_time:'Wed morning',created_at:new Date(Date.UTC(2027,0,1,12,0,++holdNumber)).toISOString(),...extra})}`; return id;
   },
  };
 }
 test('booking preserves people/family capacity, clamp, duplicate/update status, windows and notice text', async t => {
  const f=await fixture(t), slot=await f.slot();
  // Families type any number of people (no clamp): more than the time holds is refused, nothing is sent.
  assert.deepEqual(await s.saveSlotBooking(f.party(slot.id,undefined,{headCount:99}),today),{ok:false,error:'That time is full.'});
  assert.deepEqual(calls,[]);
  assert.deepEqual(await s.saveSlotBooking(f.party(slot.id,undefined,{headCount:6}),today),{ok:true});
  const when=s.formatTourWhen(slot.date,slot.start,slot.end);
  assert.deepEqual(calls,[['email',{to:'routed@example.com',subject:'Your Trinity tour time',template:'tour.booked'}],['staff','Tour booking',`Test family (${f.families[0]}@example.com, 555) booked ${when}.\nGrades: K, 8\nNote: note`]]);
  const [hold]=await s.db()`select * from tour_holds where slot_id=${slot.id}`;
  assert.deepEqual([hold.head_count,hold.grades,hold.phone,hold.note],[6,['K','8'],'555','note']);
  assert.deepEqual(await s.saveSlotBooking(f.party(slot.id,f.families[1]),today),{ok:false,error:'That time is full.'});
  await s.setTourHoldStatus(hold.id,'confirmed'); calls.length=0;
  for (const [input,expected] of [[0,1],[-4,1],[2.9,2],[NaN,1],[6,6]]) {
   assert.deepEqual(await s.saveSlotBooking(f.party(slot.id,undefined,{headCount:input}),today),{ok:true});
   const [row]=await s.db()`select id,status,head_count from tour_holds where slot_id=${slot.id}`;
   assert.deepEqual([row.id,row.status,row.head_count],[hold.id,'confirmed',expected]);
  }
  assert.deepEqual(calls,[]);
  const familySlot=await f.slot({start:'01:01',end:'01:31',capacity:1,capacityUnit:'families'});
  assert.ok((await s.saveSlotBooking(f.party(familySlot.id,undefined,{headCount:6}),today)).ok);
  assert.equal((await s.db()`select status from tour_holds where id=${hold.id}`)[0].status,'new');
  assert.deepEqual(await s.saveSlotBooking(f.party(familySlot.id,f.families[1]),today),{ok:false,error:'That time is full.'});
  const rule=await f.rule(), occurrences=(await s.listTourSlotSummary({today})).filter(x=>x.seriesId===rule);
  assert.ok((await s.saveSlotBooking(f.party(occurrences[1].id),today)).ok);
  assert.deepEqual(await s.saveSlotBooking(f.party(occurrences[2].id),today),{ok:false,error:'That time is no longer open.'});
  const hidden=await f.slot({start:'01:02',end:'01:32',published:false});
  assert.deepEqual(await s.saveSlotBooking(f.party(hidden.id),today),{ok:false,error:'Choose a time to continue.'});
  assert.deepEqual(await s.saveSlotBooking(f.party(slot.id),'2027-02-01'),{ok:false,error:'Choose a time to continue.'});
  assert.deepEqual(await s.saveSlotBooking(f.party(randomUUID()),today),{ok:false,error:'Choose a time to continue.'});
 });
 test('other-time requests clean inputs, retain repeated requests and attempt routed mail/staff notices', async t => {
  const f=await fixture(t);
  assert.deepEqual(await s.requestOtherTourTime({...f.party(''),otherTime:'',days:['Sun'],dayParts:['Night']}),{ok:false,error:'Choose a time to continue.'});
  assert.deepEqual(calls,[]);
  const input={...f.party(''),otherTime:'',days:['Wed','Sun','Wed'],dayParts:['Morning','Night'],earliest:'2027-01-03',headCount:20};
  assert.deepEqual(await s.requestOtherTourTime(input),{ok:true});
  const [row]=await s.db()`select * from tour_holds where family_id=${f.families[0]}`;
  assert.deepEqual([row.kind,row.status,row.other_time,row.days,row.day_parts,row.earliest_date,row.head_count,row.grades],['other','new','Wed, Wed · Morning · after 2027-01-03',['Wed','Wed'],['Morning'],'2027-01-03',20,['K','8']]);
  assert.deepEqual(calls,[['email',{to:'routed@example.com',subject:'We received your tour time request',template:'tour.request-received'}],['staff','Different tour time',`Test family (${f.families[0]}@example.com, 555) asked for another time: ${row.other_time}.\nGrades: K, 8\nNote: note`]]);
  await s.requestOtherTourTime({...input,otherTime:'  After chapel  ',earliest:'invalid',headCount:-2});
  assert.equal((await s.db()`select id from tour_holds where family_id=${f.families[0]}`).length,2);
 });
 test('proposals, acceptance and confirmation retain policy, errors, messages and mail attempts', async t => {
  const f=await fixture(t), id=await f.hold(), input={id,date:'2027-01-06',start:'03:00',end:'03:30',mode:'proposed',message:' Please come '};
  assert.deepEqual(await s.replyToTourRequest(input),{ok:true});
  const when=s.formatTourWhen(input.date,input.start,input.end);
  assert.deepEqual(calls,[['email',{to:'routed@example.com',subject:'A tour time to confirm',template:'tour.proposed'}]]);
  assert.equal((await s.db()`select id from tour_slots where slot_date=${input.date} and start_time=${input.start}`).length,0);
  assert.deepEqual(await s.acceptProposedHold(id,f.families[1]),{ok:false,error:'That proposal is no longer open.'});
  calls.length=0;
  assert.deepEqual(await s.acceptProposedHold(id,f.families[0]),{ok:true}); assert.deepEqual(calls,[]);
  const [hold]=await s.db()`select * from tour_holds where id=${id}`; f.slots.push(hold.slot_id);
  assert.deepEqual([hold.kind,hold.status,hold.reply_message,hold.head_count],['slot','confirmed','Please come',2]);
  assert.deepEqual(await s.acceptProposedHold(id,f.families[0]),{ok:false,error:'That proposal is no longer open.'});
  const fullRequest=await f.hold(null,f.families[1],'proposed','other',{proposed_date:input.date,proposed_start:input.start,proposed_end:input.end});
  assert.deepEqual(await s.acceptProposedHold(fullRequest,f.families[1]),{ok:false,error:'That time is full.'});
  assert.deepEqual(await s.replyToTourRequest({...input,id:fullRequest,mode:'confirmed'}),{ok:false,error:'That time is full.'}); assert.deepEqual(calls,[]);
  // Staff confirmations intentionally bypass public date/publication/window restrictions.
  const hidden=await f.slot({date:'2020-01-01',capacity:6,published:false});
  const confirmed=await f.hold();
  assert.deepEqual(await s.replyToTourRequest({id:confirmed,date:hidden.date,start:hidden.start,end:hidden.end,mode:'confirmed',message:' Welcome '}),{ok:true});
  assert.deepEqual(calls,[['email',{to:'routed@example.com',subject:'Your Trinity tour is confirmed',template:'tour.confirmed'}]]);
  assert.deepEqual(await s.replyToTourRequest({...input,id:randomUUID()}),{ok:false,error:'That request is no longer open.'});
  calls.length=0;
  const people=await f.slot({start:'04:00',end:'04:30',capacity:3});
  await f.hold(people.id);
  const pending=await f.hold(null,f.families[1],'proposed','other',{proposed_date:people.date,proposed_start:people.start,proposed_end:people.end});
  assert.deepEqual(await s.acceptProposedHold(pending,f.families[1]),{ok:false,error:'That time is full.'});
  assert.deepEqual(await s.replyToTourRequest({...input,id:pending,date:people.date,start:people.start,end:people.end,mode:'confirmed'}),{ok:false,error:'That time is full.'});
  assert.deepEqual(calls,[]);
  const rule=await f.rule({published:false,bookingWindowDays:0});
  const future=(await s.listTourSlotSummary({today})).find(x=>x.seriesId===rule && x.date==='2027-01-03');
  assert.deepEqual(await s.replyToTourRequest({...input,id:pending,date:future.date,start:future.start,end:future.end,mode:'confirmed'}),{ok:true});
 });
 test('decline and family cancellation select exactly one active owned hold and keep notification order', async t => {
  const f=await fixture(t), id=await f.hold();
  assert.equal(await s.declineTourRequest(id),true);
  assert.deepEqual(calls,[['email',{to:'routed@example.com',subject:'About your tour time request',template:'tour.declined'}]]);
  calls.length=0; assert.equal(await s.declineTourRequest(id),false);
  const slot=await f.slot(), booking=await f.hold(slot.id);
  assert.equal(await s.declineTourRequest(booking),false);
  assert.equal(await s.cancelTourHold(booking,f.families[1]),false); assert.deepEqual(calls,[]);
  assert.equal(await s.cancelTourHold(booking,f.families[0]),true);
  const when=s.formatTourWhen(slot.date,slot.start,slot.end);
  assert.deepEqual(calls,[['staff','Tour request cancelled',`Test family (${f.families[0]}@example.com) cancelled ${when}.`],['email',{to:'routed@example.com',subject:'Your Trinity tour request was cancelled',template:'tour.cancelled'}]]);
  calls.length=0; assert.equal(await s.cancelTourHold(booking,f.families[0]),false); assert.deepEqual(calls,[]);
  const other=await f.hold(); assert.equal(await s.cancelTourHold(other,f.families[0]),true);
  assert.equal(calls[0][2],`Test family (${f.families[0]}@example.com) cancelled Wed morning.`);
 });
 test('slot deletion and series skip/delete cancel every active attached hold, keep past and unattached holds, and only tour wrappers notify', async t => {
  const f=await fixture(t);
  const statuses = ['new','contacted','confirmed','proposed'];
  for (const operation of ['slot','occurrence','skip','series','generic-skip','generic-series']) {
   let slot, rule;
   if (operation==='slot') slot=await f.slot();
   else { rule=await f.rule({startsOn:'2027-01-01',endsOn:'2027-01-03'}); slot=(await s.listTourSlotSummary({today})).find(x=>x.seriesId===rule); }
   const active=[];
   for (const [i,status] of statuses.entries()) active.push(await f.hold(slot.id,f.families[i % 2],status,status==='proposed'?'other':'slot',{family_name:status}));
   const cancelled=await f.hold(slot.id,undefined,'cancelled'), unattached=await f.hold();
   let past;
   if (rule) { past=await f.slot({date:'2020-01-01'}); await s.db()`update tour_slots set series_id=${rule} where id=${past.id}`; await f.hold(past.id); }
   calls.length=0;
   const result= operation==='slot'||operation==='occurrence' ? await s.deleteTourSlot(slot.id) : operation==='skip' ? await s.skipTourSeriesDate(rule,slot.date) : operation==='series' ? await s.deleteTourSeries(rule) : operation==='generic-skip' ? await s.skipSeriesDate(rule,slot.date) : await s.deleteSeries(rule);
   assert.equal(result.ok,true);
   if ('notified' in result) assert.equal(result.notified,active.length);
   if ('cancelledHolds' in result) {
    assert.equal(result.cancelledHolds.length,active.length);
    assert.deepEqual(Object.keys(result.cancelledHolds[0]).sort(),['email','end_time','family_id','family_name','slot_date','start_time']);
   }
   const rows=await s.db()`select id,status,slot_id from tour_holds where id=any(${active}::uuid[])`;
   assert.ok(rows.every(x=>x.status==='cancelled' && x.slot_id===null));
   assert.equal((await s.db()`select status from tour_holds where id=${unattached}`)[0].status,'new');
   assert.equal((await s.db()`select status from tour_holds where id=${cancelled}`)[0].status,'cancelled');
   if (past) assert.equal((await s.db()`select status from tour_holds where slot_id=${past.id}`)[0].status,'new');
   const expected=operation.startsWith('generic')?[]:statuses.map((status,i)=>['email',{to:i%2?f.families[1]+'@example.com':'routed@example.com',subject:'A Trinity tour time was cancelled',template:'tour.school-cancelled'}]);
   const order = (a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
   assert.deepEqual([...calls].sort(order),expected.sort(order));
   if (rule && !operation.endsWith('series')) await s.deleteSeries(rule);
   if (past) await s.db()`delete from tour_slots where id=${past.id}`;
  }
 });
 test('fixed fixture snapshots characterize admin, family and website shapes and their different capacity perspectives', async t => {
  const f=await fixture(t);
  const published=await s.db()`select id from schedule_series where published`;
  const publishedSlots=await s.db()`select id from tour_slots where published`;
  await s.db()`update tour_slots set published=false`;
  await s.db()`update schedule_series set published=false`;
  t.after(async()=>{
   await s.db()`update schedule_series set published=true where id=any(${published.map(x=>x.id)}::uuid[])`;
   await s.db()`update tour_slots set published=true where id=any(${publishedSlots.map(x=>x.id)}::uuid[])`;
  });
  const a=await f.slot({capacity:3}), b=await f.slot({start:'01:01',end:'01:31',capacityUnit:'families',capacity:2}), hidden=await f.slot({start:'01:02',end:'01:32',published:false});
  await f.hold(a.id); await f.hold(a.id,undefined,'confirmed'); await f.hold(a.id,f.families[1],'cancelled');
  await f.hold(b.id); await f.hold(b.id); await f.hold(hidden.id,undefined,'confirmed');
  await f.hold(null,undefined,'proposed','other',{proposed_date:'2027-01-08',proposed_start:'09:00',proposed_end:'10:00'});
  const summary=(await s.listTourSlotSummary({today})).filter(x=>f.slots.includes(x.id));
  const admin=(await s.listAdminTours()).filter(x=>f.families.some(id=>x.email===id+'@example.com'));
  const family=await s.familyTourView(f.families[0],today), other=await s.familyTourView(f.families[2],today);
  const website=await s.websiteTourSlots(today);
  const normalize=value=>JSON.parse(JSON.stringify(value).replaceAll(f.families[0],'FAMILY').replaceAll(f.families[1],'OTHER').replaceAll(f.families[2],'VIEWER').replaceAll(a.id,'PEOPLE').replaceAll(b.id,'FAMILIES').replaceAll(hidden.id,'HIDDEN').replace(/"id":"[a-f0-9-]{36}"/g,'"id":"HOLD"'));
  const result=normalize({summary,admin,family:{...family,slots:family.slots.filter(x=>f.slots.includes(x.id))},other:{...other,slots:other.slots.filter(x=>f.slots.includes(x.id))},website:{...website,slots:website.slots.filter(x=>summary.some(y=>y.when===x.when))}});
  const path=new URL('./fixtures/booking-views.json',import.meta.url);
  if(process.env.UPDATE_TOUR_FIXTURE) writeFileSync(path,JSON.stringify(result,null,2)+'\n');
  assert.deepEqual(result,JSON.parse(readFileSync(path,'utf8')));
 });
 test.after(async()=>{await s.db().end();});
}
