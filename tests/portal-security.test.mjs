import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const urlFor = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(urlFor(path), 'utf8');

test('portal routes are gated by role and auth posts check origin and csrf', () => {
	const middleware = read('portal/src/middleware.ts');
	assert.match(middleware, /path\.startsWith\('\/admin'\)/);
	assert.match(middleware, /includes\('admin'\)/);
	assert.match(middleware, /path\.startsWith\('\/g'\)/);
	assert.match(middleware, /includes\('guardian'\)/);
	assert.match(middleware, /originOk/);
	assert.match(read('portal/src/lib/security.ts'), /httpOnly:\s*true/);
	assert.match(read('portal/src/lib/security.ts'), /sameSite:\s*'lax'/);
	assert.match(read('portal/src/pages/sign-out.ts'), /csrfOk/);
	assert.match(read('portal/src/pages/index.astro'), /tooManyAttempts/);
	assert.match(read('portal/src/pages/index.astro'), /googleOnly/);
	assert.match(read('portal/src/pages/index.astro'), /login_hint/);
	assert.match(read('portal/src/pages/index.astro'), /searchParams\.set\('next', next\)/);
	assert.match(read('portal/src/pages/auth/google.ts'), /login_hint/);
	assert.match(read('portal/src/pages/forgot.astro'), /tooManyAttempts/);
});

test('family passwords are scrypt and the session cookie is HttpOnly and Lax', () => {
	const passwords = read('packages/school/src/passwords.ts');
	assert.match(passwords, /scrypt/);
	assert.match(passwords, /timingSafeEqual/);
	const session = read('packages/school/src/session.ts');
	assert.match(session, /HttpOnly/);
	assert.match(session, /SameSite=Lax/);
	assert.match(session, /FAMILY_SESSION_SECRET/);
});

test('the session helper only uses the dev secret outside production', () => {
	const session = read('packages/school/src/session.ts');
	const productionGuard = session.indexOf("CONTEXT === 'production'");
	const fallback = session.indexOf('dev-family-secret');
	assert.ok(productionGuard > 0 && productionGuard < fallback);
});

test('shared radii keep fields moderate and every button a pill', () => {
	const portal = read('portal/public/css/portal.css');
	assert.match(portal, /--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px/);
	assert.match(portal, /--t-meta:12px;--t-sec:13px;--t-ui:14px;--t-body:15px;--t-h2:16px;--t-h1:30px/);
	assert.match(portal, /--r-sm:4px/);
	assert.match(portal, /\.si \.inp\{[^}]*border-radius:4px/);
	assert.doesNotMatch(portal, /\.si \.inp\{[^}]*border-radius:22px/);
	assert.match(portal, /\.root \.btn,\.root \.btn-sm\{border-radius:999px\}/);
	assert.match(portal, /--r-control:4px/);
	assert.match(portal, /--r-pill:999px/);
	assert.match(portal, /\[data-part="item"\]\{border-radius:var\(--r-control\)!important\}/);
	assert.match(read('portal/public/css/fonts.css'), /font-display:optional/);
	assert.doesNotMatch(portal, /font-display:swap/);
	assert.match(read('portal/src/components/FontHead.astro'), /rel="preload"/);
	assert.match(read('portal/src/components/FontHead.astro'), /transition:persist="portal-fonts"/);
	assert.match(read('portal/src/layouts/PortalLayout.astro'), /FontHead/);
	assert.match(portal, /\.narrow\{max-width:720px\}/);
	assert.match(portal, /\.card\{padding:20px;border-radius:var\(--r-md\)/);
	assert.match(portal, /outline:2px solid var\(--forest\)/);
	assert.match(read('src/styles/global.css'), /--r-control:\s*4px/);
	assert.match(read('src/styles/global.css'), /--r-pill:\s*999px/);
	assert.match(read('admin/public/css/app.css'), /border-radius:var\(--r-pill\)/);
	assert.match(read('src/components/PortalCta.astro'), /--r-control/);
	assert.match(read('src/components/PortalCta.astro'), /--r-pill/);
});

test('the public site sends visitors to the portal instead of the old forms', () => {
	assert.equal(existsSync(urlFor('portal/src/pages/verify.astro')), false);
	assert.equal(existsSync(urlFor('src/pages/admin.astro')), false);
	const visit = read('src/pages/visit.astro');
	assert.match(visit, /PORTAL_TOUR_SIGNUP/);
	assert.match(visit, /New dates coming soon/);
	assert.doesNotMatch(visit, /PortalCta|Book in TCA Portal|data-visit-form|data-updates-form/);
	assert.match(read('src/lib/links.ts'), /signup\?next=tour/);
	assert.match(read('src/lib/nav.ts'), /PORTAL_TOUR_SIGNUP/);
	assert.match(read('src/components/Header.astro'), /site-header/);
	assert.doesNotMatch(read('src/components/Header.astro'), /v5h-nav/);
	assert.match(read('src/lib/links.ts'), /https:\/\/portal\.trinityclassical\.academy/);
	assert.doesNotMatch(read('src/lib/links.ts'), /tca-portal-al\.netlify\.app/);
	assert.match(read('src/components/InterestForm.astro'), /Stay in the loop/);
	assert.match(read('src/components/InterestForm.astro'), /\/api\/updates/);
	assert.match(read('src/components/InterestForm.astro'), /create your TCA account/);
});

test('account setup does not carry the email token into the next address', () => {
	const setup = read('portal/src/pages/setup.astro');
	assert.match(setup, /action="\/setup"/);
	assert.match(setup, /name="token"/);
	assert.match(setup, /Astro\.redirect\(url\.href, 303\)/);
	assert.match(setup, /url\.search = ''/);
	assert.doesNotMatch(setup, /redirect\(roleHome/);
});

test('the public site does not read TCA_ADMIN_TOKEN', () => {
	assert.doesNotMatch(read('src/lib/admissions/defaults.ts'), /TCA_ADMIN_TOKEN/);
	assert.doesNotMatch(read('src/lib/admissions/auth.ts'), /TCA_ADMIN_TOKEN/);
	assert.doesNotMatch(read('netlify/functions/admissions-public.ts'), /TCA_ADMIN_TOKEN/);
	assert.doesNotMatch(read('netlify/functions/curriculum-content.ts'), /TCA_ADMIN_TOKEN/);
	assert.match(read('netlify/functions/curriculum-content.ts'), /CURRICULUM_ADMIN_TOKEN/);
	assert.match(read('packages/school/src/session.ts'), /TCA_ADMIN_TOKEN/);
});

test('example env does not contain live secrets', () => {
	const example = read('.env.example');
	assert.match(example, /RESEND_API_KEY=$/m);
	assert.match(example, /PORTAL_ADMIN_EMAILS=$/m);
	assert.doesNotMatch(example, /re_[A-Za-z0-9]{8,}/);
	assert.doesNotMatch(example, /sk_live_/);
});
