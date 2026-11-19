import test from 'node:test';
import assert from 'node:assert/strict';
import { runActions, redirectOnSuccess, fieldErrorMessage, toastFrom } from '../portal/src/lib/actions.ts';

function page(method='POST', values={csrf:'token',action:'save'}) {
 const form=new FormData();for(const [key,value] of Object.entries(values))form.set(key,value);
 let reads=0;
 return { request:{method,formData:async()=>{reads++;return form}},cookies:{get:()=>({value:'token'})},get reads(){return reads} };
}
test('GET is inert; POST reads once and expired requests never dispatch',async()=>{
 const get=page('GET');let calls=0;
 assert.deepEqual(await runActions(get,{save:()=>{calls++;return {}}}),{error:'',fields:{},draft:undefined});assert.equal(get.reads,0);assert.equal(calls,0);
 const post=page('POST',{action:'delete'});
 const result=await runActions(post,{delete:()=>{calls++;return {redirect:'/removed'}}},{draftFrom:form=>({action:form.get('action')})});
 assert.deepEqual(result,{error:'That request expired. Try again.',fields:{},draft:{action:'delete'}});assert.equal(post.reads,1);assert.equal(calls,0);
});
test('dispatch normalizes errors/fields/draft and preserves redirect statuses',async()=>{
 const post=page();
 const draft={title:'typed draft'};
 assert.deepEqual(await runActions(post,{save:(_form,ctx)=>({error:fieldErrorMessage({title:'Required'}),fields:{title:'Required'},draft:ctx.draft})},{draftFrom:()=>draft}),{error:'Fix 1 field to save.',fields:{title:'Required'},draft});assert.equal(post.reads,1);
 assert.deepEqual(await runActions(page(),{save:()=>({redirect:'https://portal.test/rsvp/id',status:303})}),{redirect:'https://portal.test/rsvp/id',status:303});
});
test('unknown actions are inert unless a page explicitly preserves a default handler',async()=>{
 for(const action of ['unknown','toString','constructor','__proto__']) {
  assert.deepEqual(await runActions(page('POST',{csrf:'token',action}),{}),{error:'',fields:{},draft:undefined});
  assert.deepEqual(await runActions(page('POST',{csrf:'token',action}),{},{fallback:(_form,ctx)=>({error:ctx.action})}),{error:action,fields:{},draft:undefined});
 }
});
test('legacy action resolution and expired redirect/status policies are explicit',async()=>{
 const post=page();const original=post.request.formData;post.request.formData=async()=>{const form=await original();form.append('action','resend');return form};
 assert.deepEqual(await runActions(post,{resend:()=>({redirect:'/account?notice=resent'})},{actionFrom:form=>form.getAll('action').includes('resend')?'resend':String(form.get('action'))}),{redirect:'/account?notice=resent'});assert.equal(post.reads,1);
 assert.deepEqual(await runActions(page('POST',{}),{},{csrfFailure:error=>({error,status:403})}),{error:'That request expired. Try again.',status:403,fields:{},draft:undefined});
 assert.deepEqual(await runActions(page('POST',{}),{},{csrfFailure:error=>({redirect:'/account?error='+encodeURIComponent(error)})}),{redirect:'/account?error=That%20request%20expired.%20Try%20again.'});
});
test('unexpected DB failures remain server failures and are never retried',async()=>{
 let calls=0;const failure=new Error('database unavailable');
 await assert.rejects(runActions(page(),{save:()=>{calls++;throw failure}}),error=>error===failure);assert.equal(calls,1);
});
test('save/delete outcomes share normalization without losing field messages or identifiers',()=>{
 assert.deepEqual(redirectOnSuccess({ok:false,error:'Gone',fields:{id:'Missing'}},'/removed'),{error:'Gone',fields:{id:'Missing'}});
 assert.deepEqual(redirectOnSuccess({ok:true,id:'abc'},result=>`/saved?id=${result.id}`),{redirect:'/saved?id=abc'});
 assert.deepEqual(redirectOnSuccess({ok:true,notified:2},'/removed=1'),{redirect:'/removed=1'});
});
test('field grammar retains each existing singular/plural/banner variant',()=>{
 assert.equal(fieldErrorMessage({title:'Required'}),'Fix 1 field to save.');
 assert.equal(fieldErrorMessage(2),'Fix 2 fields to save.');
 assert.equal(fieldErrorMessage(1,{plural:true}),'Fix 1 fields to save.');
 assert.equal(fieldErrorMessage(1,{suffix:' before saving. The live banner hasn’t changed.'}),'Fix 1 field before saving. The live banner hasn’t changed.');
});
test('toast map preserves truthiness, precedence and exact dynamic copy',()=>{
 const url=new URL('https://portal.test/admin/tours?saved=&removed=0&sent=1');
 assert.equal(toastFrom(url,{saved:'Saved',removed:'Removed',sent:'Sent'}),'Removed');
 url.searchParams.set('saved','abc');assert.equal(toastFrom(url,{saved:'Saved',removed:'Removed'}),'Saved');
 assert.equal(toastFrom(new URL('https://portal.test/?invited=a%2Bb%40example.com'),{invited:email=>`Invite sent to ${email}.`}), 'Invite sent to a+b@example.com.');
 assert.equal(toastFrom(new URL('https://portal.test/'),{saved:'Saved'}),'');
});
