import assert from 'node:assert/strict';
import { assertLocalDev } from '../../packages/school/src/dev/local-guard.ts';
assertLocalDev();
const base=process.env.PORTAL_E2E_URL || 'http://127.0.0.1:3500';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Use a loopback portal URL');
const {db,dbReady}=await import('@tca/school');await dbReady();
const sql=db();
try{
  const [family]=await sql`select id from families where email='guardian@example.com'`;
  const [prospect]=await sql`select id from families where email='prospect@example.com'`;
  const [form]=await sql`select id from school_forms where status='open' order by title limit 1`;
  const [assignment]=await sql`select id from form_assignments where family_id=${family.id} limit 1`;
  const [document]=await sql`select id from school_documents where status='published' limit 1`;
  const roles={
    admin:['/admin','/admin/prospects',`/admin/prospects/${prospect.id}`,'/admin/tours','/admin/events','/admin/website','/admin/families',`/admin/families/${family.id}`,'/admin/documents',`/admin/forms/${form.id}`,'/admin/inquiries','/admin/staff','/account'],
    guardian:['/g','/g/students','/g/calendar','/g/announcements','/g/documents',`/g/documents/${document.id}`,'/g/forms',`/g/forms/${assignment.id}`,'/account','/events'],
    staff:['/home','/events','/account'],
    prospect:['/home','/tour','/events','/account'],
  };
  for(const [role,paths]of Object.entries(roles)){
    const signIn=await fetch(base+'/dev/login',{method:'POST',body:new URLSearchParams({role}),headers:{origin:base},redirect:'manual'});
    assert.equal(signIn.status,303,role);
    const cookie=signIn.headers.getSetCookie().find(c=>c.startsWith('tca_family_session=')).split(';')[0];
    for(const path of paths){const res=await fetch(base+path,{headers:{cookie},redirect:'manual'});assert.equal(res.status,200,`${role} ${path}`);assert.match(await res.text(),/data-dev-roles/);}
    if(role!=='admin')assert.equal((await fetch(base+'/admin',{headers:{cookie},redirect:'manual'})).status,302);
    if(role!=='guardian')assert.equal((await fetch(base+'/g',{headers:{cookie},redirect:'manual'})).status,302);
    console.log(`${role}: ${paths.length} pages 200, role restrictions passed`);
  }
  const out=await fetch(base+'/dev/login',{method:'POST',body:new URLSearchParams({role:'signed-out'}),redirect:'manual'});
  assert.equal(out.status,303);assert.match(out.headers.get('set-cookie'),/tca_family_session=(deleted)?;/);
  assert.equal((await fetch(base+'/dev/login',{method:'POST',body:new URLSearchParams({role:'admin'}),headers:{origin:'https://example.com'},redirect:'manual'})).status,403);
  console.log('Quick sign-in switches all roles, signs out and rejects cross-origin requests.');
}finally{await sql.end();}
