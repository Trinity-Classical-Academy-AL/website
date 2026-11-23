import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalDev, isLocalDev } from '../../packages/school/src/dev/local-guard.ts';
import { DEV_ACCOUNTS, DEV_PASSWORD } from '../../packages/school/src/dev/accounts.ts';

export const fixtureId = name => {
  const hex = createHash('sha256').update(`tca-dev:${name}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
const date = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export async function seedRich({ empty = false, ifEmpty = false } = {}) {
  assertLocalDev(); // Must precede DB imports, connections, migrations, files and writes.
  process.env.ADMISSIONS_STORE = 'file';
  process.env.ADMISSIONS_DATA_DIR ||= resolve('.data/dev-admissions');
  const { db, dbReady, hashPassword } = await import('@tca/school');
  await dbReady(); // Apply the existing schema/migrations only.
  const sql = db();
  if (ifEmpty && (await sql`select id from families limit 1`).length) return false;
  const passwordHash = await hashPassword(DEV_PASSWORD);
  // A valid, readable one-page fixture, so Download/Open also work during the UI pass.
  const stream = 'BT /F1 20 Tf 54 740 Td (Trinity Classical Academy) Tj /F1 12 Tf 0 -36 Td (Family Handbook - disposable local sample) Tj 0 -28 Td (Welcome! Please check the family calendar for school dates.) Tj 0 -22 Td (Contact the office with questions about forms or classroom visits.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdf = Buffer.from(content);
  const documentKey = `doc/${fixtureId('handbook')}`;
  const flyerKey = `flyer/${fixtureId('flyer')}`;
  const {default: sharp} = await import('sharp');
  const flyerBytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#183f32"/><text x="55" y="200" fill="#f8f0d5" font-size="45">Trinity Open House</text><text x="55" y="270" fill="white" font-size="25">Come learn with us.</text></svg>')).png().toBuffer();
  await mkdir(process.env.ADMISSIONS_DATA_DIR, { recursive: true });
  for (const [key, bytes, name, type] of [
    [documentKey, pdf, 'family-handbook.pdf', 'application/pdf'],
    [flyerKey, flyerBytes, 'open-house.png', 'image/png'],
  ]) await writeFile(resolve(process.env.ADMISSIONS_DATA_DIR, key.replace('/', '__') + '.json'), JSON.stringify({base64: bytes.toString('base64'), metadata: {name, contentType: type}}));
  await sql.begin(async tx => {
    // Explicit application tables only. Never drop a schema or alter migrations.
    await tx.unsafe(`truncate table applications, family_join_requests, family_activity, family_people, children, enrollments, families, email_tokens, tour_dates, tour_requests, interest_notes,
      tour_bookings, questions, events, rsvps, event_guest_rsvps, activity, auth_attempts, updates_list,
      time_requests, announcements, tour_slots, tour_holds, inquiry_activity, inquiries, family_emails,
      email_codes, notification_routes, schedule_series, school_documents, school_forms,
      form_assignments, classreach_events, classreach_families, classreach_students,
      classreach_guardians, classreach_sessions, classreach_alerts, classreach_sync_runs,
      students, prospect_children, announcement_reads, class_students, attendance, report_cards, grade_alerts, scores,
      message_threads, message_reads, messages restart identity`);
    await tx`delete from settings where key not in ('schema_version', 'seed:info-night-2027-01-26', 'tour_rule_seed_v1')`;
    const insert = async (table, row) => { await tx`insert into ${tx(table)} ${tx(row)}`; };
    const setting = async (key, value) => insert('settings', { key, value: tx.json(value) });
    await setting('dev_seed', { mode: empty ? 'empty' : 'rich' });
    await setting('inquiry_autoreply_enabled', false);
    for (const [role, account] of Object.entries(DEV_ACCOUNTS)) {
      const id = fixtureId(role);
      await insert('families', { id, ...account, password_hash: passwordHash, email_verified_at: new Date(), first_name: account.name.split(' ')[0], last_name: account.name.split(' ')[1] });
      await insert('family_emails', { id: fixtureId(`${role}-email`), family_id: id, email: account.email, password_hash: passwordHash, verified_at: new Date(), is_primary: true, roles: account.roles.filter((r) => ['staff', 'admin'].includes(r)).concat(role === 'admin' ? ['developer'] : []) });
      for (const category of ['announcements', 'tours', 'admin']) await insert('notification_routes', {family_id: id, category, email: account.email});
    }
    if (empty) return;
    for (const [key, name, email, roles] of [
      ['reed', 'Thomas Reed', 'reed@example.com', ['guardian']],
      ['nguyen', 'Linh Nguyen', 'nguyen@example.com', ['guardian']],
      ['wilson', 'Elena Wilson', 'wilson@example.com', ['prospect']],
      ['carter', 'James Carter', 'carter@example.com', ['prospect']],
      ['rivera', 'Sofia Rivera', 'rivera@example.com', ['prospect']],
    ]) {
      await insert('families', {id: fixtureId(key), name, email, roles, password_hash: passwordHash, phone: '205-555-0142', email_verified_at: new Date()});
      await insert('family_emails', {id: fixtureId(key+'-email'), family_id: fixtureId(key), email, password_hash: passwordHash, verified_at: new Date(), is_primary: true});
    }
    await insert('family_emails', {id: fixtureId('guardian-secondary'), family_id: fixtureId('guardian'), email: 'alex.brooks@example.com', label: 'Alex Brooks', password_hash: passwordHash, verified_at: new Date()});
    for (const [key, family, name, grade] of [['oliver','guardian','Oliver Brooks','3'],['amelia','guardian','Amelia Brooks','K'],['henry','reed','Henry Reed','6'],['lucy','nguyen','Lucy Nguyen','2']]) {
      await insert('children', {id: fixtureId(key), family_id: fixtureId(family), kind: 'student', name, grade, teacher: 'Claire Bennett'});
      await tx`insert into enrollments (id, child_id, school_year, grade, status) values (gen_random_uuid(), ${fixtureId(key)}, school_year_of((now() at time zone 'America/Chicago')::date), ${grade}, 'enrolled')`;
    }
    for (const family of ['prospect','wilson','carter','rivera']) await insert('children', {id: fixtureId(family+'-child'), family_id: fixtureId(family), kind: 'prospective', name: 'Evelyn', grade: 'K', school_year: '2027–28'});
    const skipped = Array.from({length: 15},(_,i)=>date(i+14)).find(d=>new Date(d+'T12:00:00Z').getUTCDay()===3);
    for (const [key, type, published, unit] of [['tours','tour',true,'families'],['draft-tours','tour',false,'people'],['interviews','interview',true,'people']]) {
      await insert('schedule_series', {id: fixtureId(key), slot_type: type, weekdays: [3,4], start_time: key==='tours'?'08:30':key==='interviews'?'14:00':'11:00', end_time: key==='tours'?'09:30':key==='interviews'?'14:45':'12:00', starts_on: date(-30), ends_on: date(150), capacity: unit==='families'?2:6, capacity_unit: unit, published, skip_dates: [skipped], booking_window_days: 92});
      for (let offset=-14;offset<=92;offset++) {
        const day=date(offset);
        if (![3,4].includes(new Date(day+'T12:00:00Z').getUTCDay()) || day===skipped) continue;
        await insert('tour_slots', {id: fixtureId(key+day), slot_date: day, start_time: key==='tours'?'08:30':key==='interviews'?'14:00':'11:00', end_time: key==='tours'?'09:30':key==='interviews'?'14:45':'12:00', series_id: fixtureId(key), slot_type: type, capacity: unit==='families'?2:6, capacity_unit: unit, published});
      }
    }
    // One-off open and full slots exercise both capacity units independently of series expansion.
    for (const [key, unit, capacity, offset] of [['full-families','families',1,4],['full-people','people',4,5],['open-people','people',10,6],['past','families',2,-10]]) {
      await insert('tour_slots', {id: fixtureId(key), slot_date: date(offset), start_time: '10:00', end_time: '11:00', capacity, capacity_unit: unit, published: true});
      if(key!=='open-people')await insert('tour_holds', {id: fixtureId(key+'-hold'), family_id: fixtureId('reed'), slot_id: fixtureId(key), kind:'slot', status:'confirmed', head_count:key==='full-people'?4:2, family_name:'Thomas Reed',email:'reed@example.com'});
    }
    await insert('tour_holds', {id:fixtureId('prospect-booked'),family_id:fixtureId('carter'),slot_id:fixtureId('open-people'),kind:'slot',status:'confirmed',family_name:'James Carter',email:'carter@example.com',head_count:3});
    for(const [type,offset]of [['open_house',21],['info_night',35]])await insert('tour_slots',{id:fixtureId(type),slot_type:type,slot_date:date(offset),start_time:'18:00',end_time:'20:00',capacity:60,capacity_unit:'people',published:true});
    for (const [index,status] of ['new','contacted','confirmed','proposed','cancelled'].entries()) {
      const family=['prospect','wilson','carter','rivera','guardian'][index];
      await insert('tour_holds', {id: fixtureId('request-'+status), family_id: fixtureId(family), kind: 'other', status, family_name: ['Daniel Parker','Elena Wilson','James Carter','Sofia Rivera','Rachel Brooks'][index], email: `${family}@example.com`, head_count: 3, days:['Wednesday','Thursday'], day_parts:['Morning'], other_time:'Wednesday or Thursday morning', note: status==='cancelled'?'Declined: family chose another school.':'We would love to see a grammar classroom.', proposed_date: status==='proposed'?date(7):null, proposed_start:status==='proposed'?'09:00':'', proposed_end:status==='proposed'?'10:00':'', reply_message:status==='proposed'?'Would this morning work for your family?':''});
    }
    for (const status of ['new','confirmed','declined']) await insert('time_requests',{id:fixtureId('time-'+status),family_id:fixtureId('prospect'),note:'A morning visit with two children, please.',head_count:3,status});
    for (const [i,source] of ['interview','interested','contact','visit','teaching'].entries()) {
      for(const status of ['new','contacted','confirmed','cancelled']) {
        const family=['prospect','wilson','carter','rivera'][['new','contacted','confirmed','cancelled'].indexOf(status)];
        await insert('inquiries',{id:fixtureId(source+status),source,status,contact_type:source==='interview'?'interview':source==='visit'?'visit':source==='teaching'?'teaching':'inquiry',email: `${family}@example.com`,name: ['Daniel Parker','Elena Wilson','James Carter','Sofia Rivera'][['new','contacted','confirmed','cancelled'].indexOf(status)],phone:'205-555-0182', grades:['K','3'],message:`We are interested in ${source==='teaching'?'teaching classical literature':'a classical Christian education'}. Please tell us about next steps.`, details:tx.json(source==='interview'?{firstName:'Daniel',lastName:'Parker',year:'2027–28',email:'prospect@example.com',children:[{name:'Evelyn Parker',dateOfBirth:'2021-05-14',currentGrade:'K',school:'Oak Grove Preschool',description:'Enjoys stories and nature walks.'}],answers:{}}:{})});
      }
      await insert('updates_list',{email:`updates-${i}@example.com`,source});
    }
    for (const [key,type,source,offset,prior,already,status] of [
      ['current','interview','formaloo_interview',-1,false,false,'new'],
      ['overdue','interview','formaloo_interview',-20,false,false,'new'],
      ['contacted','interview','formaloo_interview',-7,false,false,'contacted'],
      ['prior','interview','formaloo_interview',-240,true,false,'new'],
      ['family','interview','formaloo_interview',-2,false,true,'contacted'],
      ['learning','inquiry','contact',-2,false,false,'new'],
      ['visit','visit','contact',-3,false,false,'new'],
      ['teacher','teaching','contact',-4,false,false,'new'],
      ['other','other','contact',-5,false,false,'new'],
      ['newsletter','newsletter','newsletter',-1,false,false,'new'],
    ]) {
      const id=fixtureId('incoming-'+key), formaloo=source==='formaloo_interview';
      await insert('inquiries',{id,name:formaloo?'Alex '+key:'Nora '+key,email:already?'guardian@example.com':`incoming-${key}@example.com`,phone:'205-555-0114',message:formaloo?'':'Please contact me about next steps.',source,status,contact_type:type,external_source:formaloo?'formaloo':'netlify-forms',external_id:'dev-'+key,created_at:prior?'2026-07-31T23:00:00-05:00':new Date(Date.now()+offset*86400000),prior_year:prior,already_family:already,contacted_at:status==='contacted'?new Date():null,contacted_by:status==='contacted'?'admin@example.com':null,details:tx.json(formaloo?{enrollmentYear:'2027–28',children:[{name:'Sam Example',grade:'K',currentSchool:'Example school'}]}:{interest:type==='visit'?'visiting':type==='inquiry'?'learning':type})});
      await insert('inquiry_activity',{id:fixtureId('incoming-import-'+key),inquiry_id:id,by:formaloo?'Formaloo':'Website',kind:'imported',note:'Imported synthetic fixture'});
      if(status==='contacted')await insert('inquiry_activity',{id:fixtureId('incoming-contact-'+key),inquiry_id:id,by:'admin@example.com',kind:'contacted',note:'Spoke with family'});
      if(key==='overdue')await insert('inquiry_activity',{id:fixtureId('incoming-note-'+key),inquiry_id:id,by:'admin@example.com',kind:'note',note:'Follow up about a visit'});
    }
    for(const status of ['new','contacted'])await insert('interest_notes',{id:fixtureId('interest-'+status),status,name:'Daniel Parker',email:'prospect@example.com',page_path:'/interested',message:'Please keep us posted about enrollment.'});
    await insert('tour_dates',{date:date(7),start_time:'09:00',end_time:'10:00',capacity:12});
    for(const status of ['new','contacted','cancelled'])await insert('tour_requests',{id:fixtureId('legacy-'+status),status,tour_date:date(7),parent_name:'Daniel Parker',email:'prospect@example.com',phone:'205-555-0182',children:2,grades:['K','3']});
    for(const status of ['booked','cancelled'])await insert('tour_bookings',{id:fixtureId('booking-'+status),family_id:fixtureId('prospect'),tour_date:date(7),head_count:3,status});
    for(const [key,title,offset,show,popup]of [['open-house','Spring Open House',21,true,true],['info-night','Information & Enrollment Night',35,true,false],['past-event','Autumn Family Picnic',-30,false,false]]) {
      await insert('events',{id:fixtureId(key),title,description:'Meet our teachers, explore the classrooms, and ask questions about life at Trinity.',starts_at:date(offset)+'T18:00:00-06:00',ends_at:date(offset)+'T20:00:00-06:00',location:'Trinity campus · Fellowship Hall',show_on_website:show,feature_popup:popup,collect_rsvp:true,flyer_key:key==='open-house'?flyerKey:'',flyer_name:key==='open-house'?'open-house.png':''});
      await insert('rsvps',{id:fixtureId(key+'-rsvp'),event_id:fixtureId(key),family_id:fixtureId('guardian'),head_count:4,note:'Looking forward to meeting everyone.'});
      await insert('event_guest_rsvps',{id:fixtureId(key+'-guest'),event_id:fixtureId(key),name:'Julia Matthews',email:'julia.matthews@example.com',head_count:2,note:'Legacy guest response'});
    }
    const {emptyBanner} = await import('../../src/lib/admissions/banner.ts');
    await setting('banner', {
      current: {...emptyBanner(),enabled:true,text:'Join us for our Spring Open House',startsOn:date(-1),endsOn:date(60),clickAction:'flyer',updatedAt:new Date().toISOString(),flyer:{key:flyerKey,name:'open-house.png',contentType:'image/png',size:flyerBytes.length},modal:{title:'Spring Open House',date:date(21),time:'6–8 PM',location:'Trinity campus',description:'Meet our teachers and explore the classrooms.',rsvpUrl:'/rsvp/'+fixtureId('open-house'),rsvpLabel:'RSVP',secondaryUrl:'',secondaryLabel:''}},
      history:[{...emptyBanner(),enabled:false,text:'Enrollment updates coming soon',updatedAt:new Date().toISOString()}],
    });
    for(const [key,title,status,audience]of [['handbook','Family Handbook','published','everyone'],['report','Oliver’s progress report','published','family'],['draft-doc','Spring reading list','draft','everyone']])await insert('school_documents',{id:fixtureId(key),title,status,audience,family_id:audience==='family'?fixtureId('guardian'):null,category:'Handbooks and policies',file_key:documentKey,file_name:'family-handbook.pdf',content_type:'application/pdf',file_size:pdf.length});
    for(const [key,title,status]of [['photo','Photo permission','open'],['trip','Field trip permission','open'],['draft-form','Volunteer availability','draft']]) {
      await insert('school_forms',{id:fixtureId(key),title,status,instructions:'Please complete one response for each student.',audience:'everyone',due_on:date(14),questions:tx.json([{id:'permission',label:'I give permission',type:'yesno',required:true}])});
      if(status==='open')for(const [student,state]of [['oliver',key==='photo'?'submitted':'missing'],['amelia','draft']])await insert('form_assignments',{id:fixtureId(key+student),form_id:fixtureId(key),family_id:fixtureId('guardian'),student_id:fixtureId(student),status:state,answers:tx.json(state==='submitted'?{permission:'Yes'}:{}),signature_name:state==='submitted'?'Rachel Brooks':'',signed_at:state==='submitted'?new Date():null,submitted_at:state==='submitted'?new Date():null});
    }
    for(const [key,title,status]of [['welcome','A warm welcome to our families','sent'],['recitation','Friday recitation and chapel','sent'],['draft-announcement','Spring volunteer opportunities','draft']])await insert('announcements',{id:fixtureId(key),title,body:'We look forward to learning together. Please check the family calendar for upcoming dates and bring your questions to the office.',status,audience:'all',sent_at:status==='sent'?new Date():null});
    for(const status of ['new','replied'])await insert('questions',{id:fixtureId('question-'+status),family_id:fixtureId('guardian'),body:'What should we bring for the first day?',status});
    for(const table of ['classreach_families','classreach_students','classreach_guardians'])for(const approval of ['pending','approved'])await insert(table,{classreach_id:`dev-${table}-${approval}`,full_name:table==='classreach_students'?'Oliver Brooks':'Rachel Brooks',email:'guardian@example.com',family_id:fixtureId('guardian'),directory_name:'Trinity families',approval,payload:tx.json({devFixture:true})});
    await insert('classreach_events',{classreach_id:'dev-chapel',title:'Morning chapel',starts_on:date(3),ends_on:date(3),approval:'approved',payload:tx.json({devFixture:true})});
    await insert('classreach_alerts',{id:'dev-offline',status:'ok',reason:'Local fixture only; no ClassReach connection.'});
    await insert('classreach_sync_runs',{id:fixtureId('sync'),status:'skipped',detail:'Local fixture only; no network.',finished_at:new Date()});
    await insert('activity',{kind:'dev_seed',summary:'Disposable local demo data loaded'});
  });
  console.info(`[dev] Seeded ${empty?'empty states (role accounts only)':'rich demo data'}. Database is disposable.`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await seedRich({empty:process.argv.includes('--empty')}); }
  catch (error) { console.error(error.message.startsWith('Local dev refused:')?error.message:`[dev] Seed failed (${error.code || error.name}); no connection details logged.`); process.exitCode=1; }
  finally { if (isLocalDev()) { const {db}=await import('@tca/school'); await db().end(); } }
}
