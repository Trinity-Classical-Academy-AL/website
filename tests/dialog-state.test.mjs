import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { dialogAttributes, dialogMatches, syncDialogs } from '../portal/src/lib/dialogs.ts';
const url=path=>new URL(path,'http://portal.test');
test('sheet query state also matches nested confirmation URLs but never another resource or route',()=>{
 const open=url('/admin/tours?slot=one');
 assert.equal(dialogMatches(url('/admin/tours?slot=one&confirm=one'),open),true);
 for(const path of ['/admin/tours','/admin/tours?slot=two','/admin/events?slot=one'])assert.equal(dialogMatches(url(path),open),false);
 assert.equal(dialogMatches(new URL('https://other.test/admin/tours?slot=one'),open),false);
});
test('SSR and client use the same URL rules, including an error fallback without its query key',()=>{
 const attrs=dialogAttributes(url('/admin/tours'),{openUrl:'/admin/tours?sheet=add',closeUrl:'/admin/tours',hidden:false});
 assert.equal(attrs.hidden,false);assert.equal(attrs['data-dialog-fallback-url'],'http://portal.test/admin/tours');
 const closed=dialogAttributes(url('/admin/tours'),{openUrl:'/admin/tours?sheet=add',closeUrl:'/admin/tours'});
 assert.equal(closed.hidden,true);
});
test('initialization, close, history traversal and nested confirmation update every responsive copy',()=>{
 const {document}=parseHTML('<html><body>'+[1,2].map(()=>'<div data-instant-dialog-url="/admin/tours?slot=one"><input value="typed draft"></div><div data-instant-dialog-url="/admin/tours?slot=one&confirm=one"></div><div data-instant-dialog-url="/admin/tours?sheet=add"></div>').join('')+'</body></html>');
 const state=()=>[...document.querySelectorAll('[data-instant-dialog-url]')].map(el=>el.hidden);
 for(const [path,expected]of [
  ['/admin/tours',[true,true,true,true,true,true]],
  ['/admin/tours?slot=one',[false,true,true,false,true,true]],
  ['/admin/tours?slot=one&confirm=one',[false,false,true,false,false,true]],
  ['/admin/tours?slot=one',[false,true,true,false,true,true]],
  ['/admin/tours',[true,true,true,true,true,true]],
  ['/admin/tours?sheet=add',[true,true,false,true,true,false]],
 ]){syncDialogs(document,url(path));assert.deepEqual(state(),expected);}
 assert.equal(document.querySelector('input').value,'typed draft');
});
