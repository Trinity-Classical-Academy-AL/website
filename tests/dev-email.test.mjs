import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendEmail, notifyStaff } from '../packages/school/src/email.ts';

test('mail preserves missing-key, Resend and webhook delivery outside local mode', async (t) => {
  for (const key of ['DEV_LOCAL', 'DATABASE_URL', 'RESEND_API_KEY', 'SCHOOL_NOTIFY_WEBHOOK_URL', 'SCHOOL_NOTIFY_WEBHOOK_TOKEN']) {
    const old = process.env[key]; delete process.env[key];
    t.after(() => old === undefined ? delete process.env[key] : process.env[key] = old);
  }
  const calls = [];
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({url, options}); return new Response('{}'); });
  const input = { to: 'guardian@example.com', subject: 'School notice', text: 'Hello', replyTo: 'office@example.com' };
  assert.deepEqual(await sendEmail(input), {delivered: false, reason: 'resend-not-configured'});
  assert.equal(calls.length, 0);
  process.env.RESEND_API_KEY = 'fake-test-key';
  assert.deepEqual(await sendEmail(input), {delivered: true});
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(JSON.parse(calls[0].options.body).to, [input.to]);
  assert.equal(JSON.parse(calls[0].options.body).reply_to, input.replyTo);
  process.env.SCHOOL_NOTIFY_WEBHOOK_URL = 'https://example.com/notify';
  process.env.SCHOOL_NOTIFY_WEBHOOK_TOKEN = 'fake-token';
  await notifyStaff('New inquiry', 'Hello');
  assert.equal(calls.at(-1).url, 'https://example.com/notify');
  assert.equal(calls.at(-1).options.headers.authorization, 'Bearer fake-token');
});

test('local mode suppresses Resend and school webhooks even with keys set', async (t) => {
  for (const [key, value] of Object.entries({DEV_LOCAL:'1', DATABASE_URL:'postgres://tca:tca@localhost:55440/tca_dev', RESEND_API_KEY:'fake-key', SCHOOL_NOTIFY_WEBHOOK_URL:'https://example.com/notify', STAFF_NOTIFY_EMAIL:'office@example.com'})) {
    const old=process.env[key];process.env[key]=value;
    t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old);
  }
  for(const key of ['NETLIFY','CONTEXT','DEPLOY_URL']){const old=process.env[key];delete process.env[key];t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old);}
  const logs=[];
  t.mock.method(console,'info',line=>logs.push(line));
  t.mock.method(console,'error',()=>{});
  t.mock.method(globalThis,'fetch',()=>{throw Error('Outbound fetch must never run');});
  // Avoid a real DB read in this test; notifyStaff catches the unavailable database.
  process.env.DATABASE_URL='postgres://tca:tca@127.0.0.1:1/tca_dev';
  assert.deepEqual(await sendEmail({to:'guardian@example.com',subject:'Permission\nform',text:'Private body'}),{delivered:false,reason:'dev-local'});
  await notifyStaff('New inquiry','Private body');
  assert.equal(globalThis.fetch.mock.calls.length,0);
  assert.equal(logs.filter(line=>line.startsWith('[dev webhook]')).length,1);
  assert.ok(logs.some(line=>line.includes('guardian@example.com')&&line.includes('Permission')));
  assert.ok(logs.every(line=>!line.includes('\n')&&!line.includes('Private body')));
});
