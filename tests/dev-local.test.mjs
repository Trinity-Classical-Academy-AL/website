import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalDev, assertLocalDev } from '../packages/school/src/dev/local-guard.ts';
const local = { DEV_LOCAL: '1', DATABASE_URL: 'postgres://dev:fake@localhost:55440/tca_dev' };
test('local guard permits only explicit loopback development', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(isLocalDev({...local, DATABASE_URL: `postgres://dev:fake@${host}/tca_dev`}), true);
  for (const value of ['', 'invalid', 'https://localhost/db', 'postgres://dev:password@ep-example.neon.tech/prod', 'postgres://dev:password@db.example.com/prod', 'postgres://localhost.example.com/db', 'postgres://127.0.0.2/db', 'postgres://localhost/db?host=remote.example.com', 'postgres://localhost/db?sslmode=require']) {
    assert.equal(isLocalDev({...local, DATABASE_URL: value}), false, value);
    assert.throws(() => assertLocalDev({...local, DATABASE_URL: value}), error => !error.message.includes('password') && error.message.includes('Local dev refused'));
  }
  for (const key of ['NETLIFY', 'CONTEXT', 'DEPLOY_URL']) for (const value of ['', 'production', '1']) assert.equal(isLocalDev({...local, [key]: value}), false);
  for (const value of [undefined, '', 'true', '0']) assert.equal(isLocalDev({...local, DEV_LOCAL: value}), false);
});

test('quick sign-in refuses outside the local boundary before reading a request or DB', async (t) => {
  const {devLogin}=await import('../portal/src/dev/login.ts');
  const old=process.env.DEV_LOCAL;delete process.env.DEV_LOCAL;
  t.after(()=>old===undefined?delete process.env.DEV_LOCAL:process.env.DEV_LOCAL=old);
  assert.equal((await devLogin({})).status,404);
});

test('all destructive entry points refuse before connecting and redact URL credentials', async () => {
  const {spawnSync}=await import('node:child_process');
  for(const args of [['scripts/dev/seed-rich.mjs'],['scripts/dev/local.mjs'],['scripts/dev/local.mjs','--seed']]){
    for(const override of [{DATABASE_URL:'postgres://admin:never-print-this@ep-demo.neon.tech/prod'}, {NETLIFY:'true'}, {CONTEXT:'production'}, {DEPLOY_URL:'https://example.com'}, {DEV_LOCAL:'0'}]){
      const result=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,DEV_LOCAL:'1',DATABASE_URL:'postgres://tca:tca@localhost:55440/tca_dev',...override},timeout:5000});
      assert.equal(result.status,1,args.join(' '));
      assert.match(result.stderr,/Local dev refused/);
      assert.doesNotMatch(result.stderr+result.stdout,/never-print-this/);
    }
  }
});
