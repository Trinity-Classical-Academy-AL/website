import { db, dbReady, issueFamilySession, FAMILY_COOKIE } from '@tca/school';
import { isLocalDev } from '../../../packages/school/src/dev/local-guard.ts';
import { DEV_ACCOUNTS } from '../../../packages/school/src/dev/accounts.ts';
import { originOk, roleHome } from '../lib/security.ts';
import type { APIContext } from 'astro';

/** Imported only inside import.meta.env.DEV; production has no route or switcher. */
export async function devLogin(context: APIContext): Promise<Response> {
  if (!isLocalDev()) return new Response('Not found', { status: 404 });
  if (context.request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!originOk(context.request) || context.request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', { status: 403 });
  const form = await context.request.formData();
  const role = String(form.get('role') || '');
  const options = {httpOnly:true, sameSite:'lax' as const, path:'/', secure:context.url.protocol==='https:'};
  context.cookies.delete('tca_after_login', {path:'/'});
  if(role==='signed-out') {
    context.cookies.delete(FAMILY_COOKIE, {path:'/'});
    return context.redirect('/',303);
  }
  if (!Object.hasOwn(DEV_ACCOUNTS, role)) return new Response('Unknown dev role', {status:400});
  const account = DEV_ACCOUNTS[role as keyof typeof DEV_ACCOUNTS];
  await dbReady();
  const [family] = await db()`select id, roles from families where lower(email) = ${account.email}`;
  if (!family) return new Response('Run npm run dev:seed first.', {status:409});
  context.cookies.set(FAMILY_COOKIE, issueFamilySession(String(family.id), account.email), options);
  return context.redirect(roleHome(family.roles, account.email),303);
}

export async function withDevTools(context: APIContext, next: () => Promise<Response>): Promise<Response> {
  if (!isLocalDev()) return context.url.pathname === '/dev/login' ? new Response('Not found',{status:404}) : next();
  if(context.url.pathname === '/dev/login') return devLogin(context);
  const response = await next();
  if(!response.headers.get('content-type')?.includes('text/html'))return response;
  const buttons = [...Object.keys(DEV_ACCOUNTS),'signed-out'].map(role=>`<button name="role" value="${role}" style="padding:4px 8px;font:12px system-ui;cursor:pointer">${role}</button>`).join(' ');
  const markup = `<details data-dev-roles style="position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#fff;color:#222;border:1px solid #aaa;border-radius:8px;padding:6px;font:12px system-ui"><summary style="cursor:pointer">Dev roles</summary><form action="/dev/login" method="post" data-astro-reload style="display:flex;gap:4px;margin-top:6px">${buttons}</form></details>`;
  return new Response((await response.text()).replace('</body>',markup+'</body>'),{status:response.status,headers:response.headers});
}
