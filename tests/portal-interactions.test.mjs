import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { optimisticUpdate, responseError, searchURL } from '../portal/src/scripts/interactions-core.ts';

function dom(html) { return parseHTML(`<html><body>${html}</body></html>`).document; }
test('optimistic removal restores both responsive copies and preserves pre-existing hidden state', () => {
 const doc = dom('<div data-row="a">Desktop</div><div data-row="a" hidden>Mobile</div><div data-row="b">Other</div><form data-optimistic="remove" data-optimistic-target="a"></form>');
 const rows = [...doc.querySelectorAll('[data-row]')];
 const restore = optimisticUpdate(doc.querySelector('form'), new FormData());
 assert.equal(rows[0].hidden, true); assert.equal(rows[1].hidden, true); assert.equal(rows[2].hidden, false);
 restore(); assert.equal(rows[0].hidden, false); assert.equal(rows[1].hidden, true);
});
test('closing sheets snapshots nested confirmations without replacing nodes or losing entered values', () => {
 const doc=dom('<div class="ov"><div class="ssheet"><form data-optimistic="close-sheet"><input value="Keep my draft"></form></div><div class="ov" hidden></div></div>');
 const input=doc.querySelector('input'); const restore=optimisticUpdate(doc.querySelector('form'),new FormData());
 assert.equal(doc.querySelector('.ov').hidden,true); restore();
 assert.equal(doc.querySelector('.ov').hidden,false); assert.equal(doc.querySelector('.ov .ov').hidden,true);
 assert.equal(doc.querySelector('input'),input); assert.equal(input.value,'Keep my draft');
});
test('status rollback uses committed server text and restores badge classes', () => {
 const doc=dom('<form data-optimistic="status" data-status-value="new"><span data-status class="badge b-gray">contacted</span></form>');
 const data=new FormData(); data.set('status','contacted');
 const restore=optimisticUpdate(doc.querySelector('form'),data); const badge=doc.querySelector('[data-status]');
 assert.equal(badge.textContent,'contacted'); assert.equal(badge.className,'badge b-green');
 restore(); assert.equal(badge.textContent,'new'); assert.equal(badge.className,'badge b-gray');
});
test('fixed statuses update all matching rows; unrelated rows and form values stay intact', () => {
 const doc=dom('<div data-row="a"><span data-status>Draft</span></div><div data-row="a"><span data-status>Draft</span></div><div data-row="b"><span data-status>Other</span></div><form data-optimistic="status:Published" data-optimistic-target="a"></form>');
 const restore=optimisticUpdate(doc.querySelector('form'),new FormData());
 assert.deepEqual([...doc.querySelectorAll('[data-status]')].map(el=>el.textContent),['Published','Published','Other']);
 restore(); assert.equal(doc.querySelector('[data-status]').textContent,'Draft');
});
test('toggle rollback restores both checkbox property and absent aria attribute', () => {
 const doc=dom('<form data-optimistic="toggle"><input data-toggle><button data-toggle aria-pressed="false"></button></form>');
 const checkbox=doc.querySelector('input'); checkbox.checked=false;
 const restore=optimisticUpdate(doc.querySelector('form'),new FormData());
 assert.equal(checkbox.checked,true); assert.equal(doc.querySelector('button').getAttribute('aria-pressed'),'true');
 restore(); assert.equal(checkbox.checked,false); assert.equal(checkbox.hasAttribute('aria-pressed'),false);
 assert.equal(doc.querySelector('button').getAttribute('aria-pressed'),'false');
});
test('server-rendered validation and rate-limit errors are detected even with HTTP 200', () => {
 for(const html of ['<p class="alert alert-err">Expired request</p>', '<p class="errm" role="alert">Expired request</p>', '<p class="errm">Expired request</p>', '<p data-interaction-error>Expired request</p>']) assert.equal(responseError(dom(html)),'Expired request');
 assert.equal(responseError(dom('<div class="toast t-ok">Saved</div>')),'');
 assert.equal(responseError(dom('<p class="errm" hidden>Hidden file validation</p>')),'');
});
test('server message is treated as text, including hostile markup', () => {
 assert.equal(responseError(dom('<p class="alert-err">Do not retry &lt;script&gt;alert(1)&lt;/script&gt;</p>')),'Do not retry <script>alert(1)</script>');
});
test('live search keeps tab/filter state, encodes query, and clears empty query', () => {
 const NativeFormData=globalThis.FormData;
 const doc=dom('<form><input name="q" value="A & B"><input name="when" value="future"></form>');
 const form=doc.querySelector('form');
 Object.defineProperty(form,'elements',{value:[...form.querySelectorAll('input')]});
 globalThis.FormData=class extends NativeFormData {constructor(form){super(); for(const input of form.elements)this.append(input.name,input.value)}};
 try {
  const url=searchURL(form,'https://portal.test/admin/tours?tab=bookings&q=old&when=past#row');
  assert.equal(url.searchParams.get('tab'),'bookings'); assert.equal(url.searchParams.get('q'),'A & B');
  assert.deepEqual(url.searchParams.getAll('when'),['future']); assert.equal(url.hash,'');
  form.querySelector('[name=q]').value=''; assert.equal(searchURL(form,url.href).searchParams.has('q'),false);
 } finally {globalThis.FormData=NativeFormData}
});

test('server field validation preserves typed drafts and targets the matching action', async () => {
 const {applyValidation}=await import('../portal/src/scripts/interactions-core.ts');
 const old=dom('<form><input name="action" value="slot"><div class="field"><input name="date" value="my draft"></div></form>');
 const server=dom('<form><input name="action" value="other"><input name="date" class="bad"></form><form><input name="action" value="slot"><div class="field"><input name="date" class="inp bad" value="server draft"><p class="errm">Enter a date.</p></div></form>');
 const form=old.querySelector('form');applyValidation(form,server);
 const input=form.querySelector('[name=date]');assert.equal(input.value,'my draft');assert.equal(input.getAttribute('aria-invalid'),'true');
 assert.equal(form.querySelector('.errm').textContent,'Enter a date.');
 applyValidation(form,server);assert.equal(form.querySelectorAll('.errm').length,1);
});

test('scroll policy preserves query/POST swaps, resets new paths, and prioritizes history restoration', async () => {
 const {navigationScrollMode}=await import('../portal/src/scripts/interactions-core.ts');
 const from=new URL('https://portal.test/admin/tours?sheet=add');
 for(const type of ['push','replace']) {
  assert.equal(navigationScrollMode(from,new URL('https://portal.test/admin/tours?saved=1'),type),'preserve');
  assert.equal(navigationScrollMode(from,new URL(from),type),'preserve');
  assert.equal(navigationScrollMode(from,new URL('https://portal.test/admin/families'),type),'top');
 }
 assert.equal(navigationScrollMode(from,new URL('https://portal.test/admin/tours?tab=bookings'),'traverse'),'history');
 assert.equal(navigationScrollMode(from,new URL('https://portal.test/admin/families'),'traverse'),'history');
});

// Same characterization cases now exercise the extracted submission pipeline.
async function mutationLoader(event, state, deps) {
 const { submitAndRevalidate } = await import('../portal/src/scripts/interactions-core.ts');
 return submitAndRevalidate(event, state, { headers: { 'x-astro-test': 'adapter' }, document: deps.document, fetch: deps.fetch, parse: dom, rollback: deps.rollback });
}

function loaderCase(response, aborted=false) {
 const controller=new AbortController();if(aborted)controller.abort();
 const event={to:new URL('https://portal.test/admin/tours?sheet=add'),formData:new FormData(),signal:controller.signal};
 const document=dom('<form><input name="action" value="slot"><div class="field"><input name="date" value="my draft"></div></form>');
 const state={form:document.querySelector('form'),url:'https://portal.test/admin/tours?sheet=add'};
 const calls=[];const rollbacks=[];const validations=[];
 const deps={document,fetch:async(...args)=>{calls.push(args);if(response instanceof Error || typeof response==='string')throw response;return response;},rollback:message=>rollbacks.push(message),applyValidation:(...args)=>validations.push(args)};
 return {event,state,calls,rollbacks,validations,deps,run:()=>mutationLoader(event,state,deps)};
}
const htmlResponse=(html,extra={})=>({ok:true,status:200,headers:new Headers({'content-type':'text/html; charset=utf-8'}),text:async()=>html,redirected:false,url:'https://portal.test/admin/tours',...extra});
test('mutation loader posts once with adapter headers, applies redirected fresh HTML, and strips noscript',async()=>{
 const c=loaderCase(htmlResponse('<meta name="astro-view-transitions-enabled"><noscript>fallback</noscript><p>Fresh rows</p>',{redirected:true,url:'https://portal.test/admin/tours?saved=abc'}));await c.run();
 assert.equal(c.calls.length,1);assert.equal(c.calls[0][0],'https://portal.test/admin/tours?sheet=add');
 const options=c.calls[0][1];assert.equal(options.method,'POST');assert.equal(options.body,c.event.formData);assert.equal(options.signal,c.event.signal);assert.equal(options.credentials,'same-origin');assert.equal(options.headers['x-astro-test'],'adapter');
 assert.equal(c.event.to.href,'https://portal.test/admin/tours?saved=abc');assert.equal(c.event.newDocument.querySelector('noscript'),null);assert.equal(c.event.newDocument.querySelector('p').textContent,'Fresh rows');assert.deepEqual(c.rollbacks,[]);
});
test('mutation loader rolls back HTTP-200 validation and merges fields without applying the rejected page',async()=>{
 const c=loaderCase(htmlResponse('<p class="alert-err">Fix 1 field to save.</p><form><input name="action" value="slot"><div class="field"><input name="date" class="bad"><p class="errm">Enter a date.</p></div></form>'));await c.run();
 assert.deepEqual(c.rollbacks,['Fix 1 field to save.']);assert.equal(c.state.form.querySelector('[name=date]').value,'my draft');assert.equal(c.state.form.querySelector('.errm').textContent,'Enter a date.');assert.equal(c.event.newDocument,c.deps.document);assert.equal(c.event.to.href,c.state.url);assert.equal(c.calls.length,1);
});
test('mutation loader retains HTTP/session/network error copy and never replays a POST',async()=>{
 for(const [response,message] of [
  [htmlResponse('',{ok:false,status:500}),'Could not save (500). Check before trying again.'],
  [htmlResponse('<h1>Sign in</h1>'),'Your session may have expired. Check before trying again.'],
  [htmlResponse('<meta name="astro-view-transitions-enabled">',{headers:new Headers({'content-type':'application/json'})}),'Your session may have expired. Check before trying again.'],
  [new Error('socket lost'),'socket lost'],
  ['network down','Could not save. Check your connection before trying again.'],
 ]) { const c=loaderCase(response);await c.run();assert.deepEqual(c.rollbacks,[message]);assert.equal(c.calls.length,1);assert.equal(c.event.newDocument,c.deps.document);assert.equal(c.validations.length,0); }
});
test('an aborted mutation leaves superseding navigation in charge',async()=>{
 const c=loaderCase(new Error('aborted'),true);await c.run();assert.deepEqual(c.rollbacks,[]);assert.equal(c.event.newDocument,undefined);assert.equal(c.validations.length,0);
});

test('removal from an inline row and fixed unpublished status retain their exact rollback state', () => {
 const doc=dom('<div data-row="a"><form data-optimistic="remove|status:Unpublished"><span data-status class="badge b-green">Published</span></form></div>');
 const row=doc.querySelector('[data-row]'),badge=doc.querySelector('[data-status]');
 const restore=optimisticUpdate(doc.querySelector('form'),new FormData());
 assert.equal(row.hidden,true);assert.equal(badge.textContent,'Unpublished');
 restore();assert.equal(row.hidden,false);assert.equal(badge.textContent,'Published');assert.equal(badge.className,'badge b-green');
});

test('publish mode follows the submitted button, updates both copies and rolls back exactly', () => {
 for (const [value,text,color] of [['yes','Published','b-green'],['no','Draft','b-gray']]) {
  const doc=dom('<div data-row="a"><span data-status class="badge b-gold">Before</span></div><div data-row="a"><span data-status class="badge b-gray">Draft</span></div><form data-optimistic="publish" data-optimistic-target="a"></form>');
  const data=new FormData();data.set('publish',value);
  const restore=optimisticUpdate(doc.querySelector('form'),data);
  for(const badge of doc.querySelectorAll('[data-status]')) {assert.equal(badge.textContent,text);assert.equal(badge.className,`badge ${color}`);}
  restore();assert.deepEqual([...doc.querySelectorAll('[data-status]')].map(el=>[el.textContent,el.className]),[['Before','badge b-gold'],['Draft','badge b-gray']]);
 }
});
test('publication checkbox handles unpublished slots and retains full capacity badges', () => {
 const doc=dom('<div data-row="a"><span data-status class="badge b-green">Published</span><span data-status data-publish-full class="badge b-gray">Full</span></div><form data-optimistic="publish" data-optimistic-target="a" data-unpublished-label="Unpublished"></form>');
 const restore=optimisticUpdate(doc.querySelector('form'),new FormData());
 assert.equal(doc.querySelector('[data-status]').textContent,'Unpublished');assert.equal(doc.querySelector('[data-status]').className,'badge b-gray');
 assert.equal(doc.querySelector('[data-publish-full]').textContent,'Full');restore();assert.equal(doc.querySelector('[data-status]').textContent,'Published');
});
test('status color reflects the requested status and rollback is safe to call twice', () => {
 const doc=dom('<div data-row="a"><span data-status class="badge b-green">contacted</span></div><form data-optimistic="status" data-optimistic-target="a"></form>');
 const data=new FormData();data.set('status','new');
 const restore=optimisticUpdate(doc.querySelector('form'),data);
 assert.equal(doc.querySelector('[data-status]').className,'badge b-gray');restore();restore();assert.equal(doc.querySelector('[data-status]').className,'badge b-green');
});
test('date removal targets just the requested date across responsive copies', () => {
 const doc=dom('<tr data-row="series:2028-01-01"></tr><tr data-row="series:2028-01-01"></tr><tr data-row="series:2028-01-08"></tr><form data-optimistic="remove" data-optimistic-target="series:2028-01-01"></form>');
 const restore=optimisticUpdate(doc.querySelector('form'),new FormData());assert.deepEqual([...doc.querySelectorAll('[data-row]')].map(row=>row.hidden),[true,true,false]);restore();assert.ok([...doc.querySelectorAll('[data-row]')].every(row=>!row.hidden));
});

test('publish uses a checked slot checkbox and the announcement label without changing form controls', () => {
 const doc=dom('<div data-row="a"><span data-status class="badge b-gray">Unpublished</span></div><form data-optimistic="publish" data-optimistic-target="a" data-published-label="Sent"><input name="title" value="Keep draft"></form>');
 const data=new FormData();data.set('published','on');const restore=optimisticUpdate(doc.querySelector('form'),data);
 assert.equal(doc.querySelector('[data-status]').textContent,'Sent');assert.equal(doc.querySelector('[data-status]').className,'badge b-green');assert.equal(doc.querySelector('input').value,'Keep draft');
 restore();assert.equal(doc.querySelector('[data-status]').textContent,'Unpublished');assert.equal(doc.querySelector('[data-status]').className,'badge b-gray');
});

test('incoming contacted feedback updates both responsive rows and rolls back identity/date', async () => {
 const {parseHTML}=await import('linkedom');
 const {optimisticUpdate}=await import('../portal/src/scripts/interactions-core.ts');
 const {document}=parseHTML('<html><body><tr data-row="contact"><td data-status>new</td><td data-contacted>Not yet</td></tr><tr data-row="contact"><td data-status>new</td><td data-contacted>Not yet</td></tr><form data-optimistic="status:contacted|contacted" data-optimistic-target="contact" data-contacted-label="office@example.com · 11/19/2026"></form></body></html>');
 const undo=optimisticUpdate(document.querySelector('form'),new FormData());
 assert.deepEqual([...document.querySelectorAll('[data-contacted]')].map(n=>n.textContent),['office@example.com · 11/19/2026','office@example.com · 11/19/2026']);
 undo();assert.deepEqual([...document.querySelectorAll('[data-contacted]')].map(n=>n.textContent),['Not yet','Not yet']);
});
