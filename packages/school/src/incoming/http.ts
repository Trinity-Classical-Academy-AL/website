import { incomingWritesAllowed, type IncomingEnv } from './model.ts';
import { syncFormaloo } from './formaloo.ts';
import { parseNetlifySubmission, tokenAuthorized, verifyNetlifySignature } from './netlify.ts';
import { upsertIncoming } from './repository.ts';
import { previewIncomingDigest } from './digest.ts';

type Dependencies = { env?:IncomingEnv; sync?:typeof syncFormaloo; upsert?:typeof upsertIncoming; digest?:typeof previewIncomingDigest };
const skipped=()=>Response.json({skipped:'not-production'});
const unconfigured=()=>Response.json({error:'not-configured'},{status:503});
const denied=()=>Response.json({error:'unauthorized'},{status:401});
const bearer=(request:Request)=>request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] || null;
export async function handleFormaloo(request:Request,deps:Dependencies={}) {
 const env=deps.env || process.env;
 if (!incomingWritesAllowed(env)) return skipped();
 if (!env.FORMALOO_WEBHOOK_TOKEN || !env.FORMALOO_API_KEY || !env.FORMALOO_API_SECRET) return unconfigured();
 if (!tokenAuthorized(env.FORMALOO_WEBHOOK_TOKEN,request.headers.get('x-formaloo-token')) && !tokenAuthorized(env.FORMALOO_WEBHOOK_TOKEN,bearer(request))) return denied();
 const url=new URL(request.url),dry=url.searchParams.get('dry')==='1';
 try {
  // Payload is only a trigger: never read, log or trust its contents.
  const result=await (deps.sync || syncFormaloo)({env,full:url.searchParams.get('mode')==='full',dry});
  return dry ? Response.json(result) : new Response(null,{status:200});
 } catch { return Response.json({error:'pull-failed'},{status:502}); }
}
export async function handleNetlifyForms(request:Request,deps:Dependencies={}) {
 const env=deps.env || process.env;
 if (!incomingWritesAllowed(env)) return skipped();
 if (!env.NETLIFY_FORMS_WEBHOOK_SECRET) return unconfigured();
 const body=await request.text();
 if (!verifyNetlifySignature(body,request.headers.get('x-webhook-signature'),env.NETLIFY_FORMS_WEBHOOK_SECRET)) return denied();
 let payload:unknown;try {payload=JSON.parse(body);}catch{return Response.json({error:'invalid-payload'},{status:400});}
 const parsed=parseNetlifySubmission(payload);
 if (parsed) await (deps.upsert || upsertIncoming)(parsed,{env});
 return new Response(null,{status:200});
}
export async function handleDigestPreview(request:Request,deps:Dependencies={}) {
 const env=deps.env || process.env;
 if (!incomingWritesAllowed(env)) return skipped();
 if (!env.FORMALOO_WEBHOOK_TOKEN) return unconfigured();
 if (!tokenAuthorized(env.FORMALOO_WEBHOOK_TOKEN,bearer(request))) return denied();
 return new Response(await (deps.digest || previewIncomingDigest)(),{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
}
