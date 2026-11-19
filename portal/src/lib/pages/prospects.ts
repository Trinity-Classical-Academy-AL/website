import type { AstroGlobal } from 'astro';
import { CONTACT_TYPES, addIncomingNote, incomingActivity, incomingDate, listIncoming, markContacted, markProspectEmailed } from '@tca/school';
import { runActions } from '../actions.ts';
import { csrfToken } from '../security.ts';

export async function loadIncoming(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
 const csrf=csrfToken(Astro.cookies,Astro.url.protocol==='https:');
 const base=new URL(Astro.url);base.searchParams.delete('contact');
 const closeUrl=base.pathname+base.search;
 const by=Astro.locals.sessionEmail || family.email || family.name;
 const result=await runActions(Astro,{
  'email-account':async form=>{
   const result=await markProspectEmailed(String(form.get('id') || ''),by);
   if ('error' in result) return {error:result.error};
   if ('skipped' in result) return {error:'Contact updates are available in production.'};
   return {redirect:closeUrl};
  },
  contacted:async form=>{
   const result=await markContacted(String(form.get('id') || ''),by);
   if ('error' in result) return {error:result.error};
   if ('skipped' in result) return {error:'Contact updates are available in production.'};
   return {redirect:closeUrl};
  },
  emailed:async form=>{
   const result=await markContacted(String(form.get('id') || ''),by,'emailed');
   if ('error' in result) return {error:result.error};
   if ('skipped' in result) return {error:'Contact updates are available in production.'};
   return {redirect:closeUrl};
  },
  note:async form=>{
   const id=String(form.get('id') || '');
   const result=await addIncomingNote(id,by,String(form.get('note') || ''));
   if ('error' in result) return {error:result.error};
   if ('skipped' in result) return {error:'Contact updates are available in production.'};
   return {redirect:closeUrl};
  },
 });
 if ('redirect' in result) return Astro.redirect(result.redirect,result.status);
 const rows=await listIncoming();
 const selected=rows.find(row=>row.id===Astro.url.searchParams.get('contact'));
 const activity=selected ? await incomingActivity(selected.id) : [];
 const rawFilter=Astro.url.searchParams.get('filter') || '';
 const type=Astro.url.searchParams.get('type') || (CONTACT_TYPES.includes(rawFilter as any)?rawFilter:'');
 const filter=['new','overdue'].includes(rawFilter)?rawFilter:'';
 const prior=Astro.url.searchParams.get('prior')==='1',q=(Astro.url.searchParams.get('q') || '').trim().toLowerCase();
 const now=Date.now();
 const visible=rows.filter(row=>(prior || !row.priorYear) && (filter!=='new' || row.status==='new')
  && (filter!=='overdue' || row.status==='new' && !row.contactedAt && now-Date.parse(row.createdAt)>=14*86400000)
  && (!CONTACT_TYPES.includes(type as any) || row.contactType===type)
  && (!q || `${row.name} ${row.email}`.toLowerCase().includes(q)));
 const href=(changes:Record<string,string>)=>{
  const url=new URL(base);url.searchParams.delete('tab');
  for(const [key,value]of Object.entries(changes)) value ? url.searchParams.set(key,value) : url.searchParams.delete(key);
  return url.pathname+url.search;
 };
 return {csrf,error:result.error,visible,selected,activity,filter,type,prior,href,closeUrl,by,contactedLabel:`${by} · ${incomingDate(new Date().toISOString())}`};
}
export type IncomingView=Exclude<Awaited<ReturnType<typeof loadIncoming>>,Response>;
