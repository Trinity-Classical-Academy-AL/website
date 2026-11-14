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
