import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertLocalDev } from '../../packages/school/src/dev/local-guard.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
for (const [key, value] of Object.entries(parseEnv(readFileSync(resolve(root, '.env.dev.example'), 'utf8')))) process.env[key] ??= value;
process.env.ADMISSIONS_DATA_DIR = resolve(root, process.env.ADMISSIONS_DATA_DIR);
const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Docker command failed. Check that Docker is running and port 55440 is available.');
  return result.stdout.trim();
};

let sql;
try {
  assertLocalDev(); // Before Docker, imports, migrations or any network access.
  const url = new URL(process.env.DATABASE_URL);
  if (url.port !== '55440' || url.pathname !== '/tca_dev') throw new Error('dev:local/dev:seed require the disposable tca_dev database on port 55440.');
  const existing = spawnSync('docker', ['inspect', 'tca-dev-postgres'], {encoding:'utf8'});
  if (existing.status === 0) {
    const container = JSON.parse(existing.stdout)[0];
    const binding = container.HostConfig.PortBindings?.['5432/tcp'];
    if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || binding[0].HostPort !== '55440') throw new Error('tca-dev-postgres has unexpected port bindings; refusing to use it.');
    if (!container.State.Running) docker('start', 'tca-dev-postgres');
  } else docker('run','--detach','--name','tca-dev-postgres','--publish','127.0.0.1:55440:5432','--env','POSTGRES_USER=tca','--env','POSTGRES_PASSWORD=tca','--env','POSTGRES_DB=tca_dev','postgres:16');
  const {db}=await import('@tca/school'); sql=db();
  let connected=false;
  for(let attempt=0;attempt<40;attempt++) {
    try {await sql`select 1`;connected=true;break;}catch{await delay(500);}
  }
  if(!connected)throw new Error('Local Postgres did not become ready on port 55440.');
  const {seedRich}=await import('./seed-rich.mjs');
  const seed = process.argv.includes('--seed');
  await seedRich({empty:process.argv.includes('--empty'),ifEmpty:!seed});
  await sql.end();sql=undefined;
  if(!seed) {
    const host=process.env.DEV_HOST || '127.0.0.1';
    const port=process.env.DEV_PORT || '3500';
    process.env.PORTAL_ORIGIN=`http://${host}:${port}`;
    console.info(`[dev] Portal http://${host}:${port} · quick sign-in available in the Dev roles menu. Ctrl-C stops the server.`);
    const child=spawn(process.execPath,[resolve(root,'node_modules/astro/bin/astro.mjs'),'dev','--config','astro.local.config.mjs','--host',host,'--port',port],{cwd:resolve(root,'portal'),env:{...process.env,ASTRO_DEV_BACKGROUND:'0'},stdio:'inherit'});
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
    process.exitCode=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>done(code ?? 0));});
  }
} catch(error) {
  console.error(error.message?.startsWith('Local dev refused:') || !error.code ? error.message : `[dev] Startup failed (${error.code}); no connection details logged.`);
  process.exitCode=1;
} finally {if(sql)await sql.end({timeout:2});}
