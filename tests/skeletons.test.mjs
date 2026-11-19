import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { delayedSkeleton, showPageSkeleton, showSheetSkeleton } from '../portal/src/scripts/skeletons.ts';

test('fast navigation never mounts a skeleton; slow navigation mounts and restores once', t => {
 t.mock.timers.enable({apis:['setTimeout']});
 let shown=0,restored=0;
 const show=()=>{shown++;return ()=>restored++;};
 const fast=delayedSkeleton(show);t.mock.timers.tick(149);fast();t.mock.timers.tick(1);assert.equal(shown,0);
 const slow=delayedSkeleton(show);t.mock.timers.tick(150);assert.equal(shown,1);slow();slow();assert.equal(restored,1);
});

test('page skeleton keeps table geometry and original nodes, then restores busy state', () => {
 const {document}=parseHTML('<html><body><template data-page-skeleton><div data-skeleton><span>Loading</span></div></template><div class="awrap" aria-busy="false"><header class="ahead"><h1>Title</h1></header><div class="tbox"><table><tr><td>One</td><td>Two</td><td>Three</td></tr></table></div><input value="Draft"></div></body></html>');
 for(const el of document.querySelectorAll('*')) {el.getClientRects=()=>[{}];el.getBoundingClientRect=()=>({left:10,top:20,width:100,height:52});}
 const scope=document.querySelector('.awrap'),input=document.querySelector('input');
 const restore=showPageSkeleton(document);
 assert.equal(scope.getAttribute('aria-busy'),'true');assert.equal(scope.querySelectorAll('.skeleton-shape').length,4);assert.equal(scope.querySelectorAll('.skeleton-rule').length,1);
 assert.equal(scope.querySelectorAll('.skeleton-table .skeleton-shape').length,3);assert.equal(scope.querySelector('.skeleton-table .skeleton-shape').style.left,'12px');
 assert.equal(scope.querySelector('input'),input);assert.equal(input.value,'Draft');
 restore();assert.equal(scope.getAttribute('aria-busy'),'false');assert.equal(scope.classList.contains('portal-loading'),false);assert.equal(scope.querySelector('[data-skeleton]'),null);
});

test('sheet skeleton mounts only in a visible shell and removes only its own nodes', () => {
 const {document}=parseHTML('<html><body><template data-sheet-skeleton><div data-loading-sheet>Fields</div></template><div class="shell-d"><div class="ov">Existing sheet</div></div><div class="shell-m"></div></body></html>');
 document.querySelector('.shell-d').getClientRects=()=>[{}];document.querySelector('.shell-m').getClientRects=()=>[];
 const restore=showSheetSkeleton(document);assert.equal(document.querySelectorAll('[data-loading-sheet]').length,1);
 restore();assert.equal(document.querySelector('[data-loading-sheet]'),null);assert.equal(document.querySelector('.ov').textContent,'Existing sheet');
});
