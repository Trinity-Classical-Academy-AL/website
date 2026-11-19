// Production must tree-shake the entire local sign-in feature, even with local env set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const build=spawnSync('npm',['run','build','--workspace=portal'],{stdio:'inherit',env:{...process.env,CI:'1',DEV_LOCAL:'1',DATABASE_URL:'postgres://tca:tca@127.0.0.1:55440/tca_dev',DEV_ALLOWED_HOSTS:'dev-only-host.example.com'}});
assert.equal(build.status,0,'Portal production build failed');
let checked=0;
function scan(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())scan(path);
  else if(/\.(m?js|html|json)$/.test(entry.name)){
    const content=readFileSync(path,'utf8');
    assert.doesNotMatch(content,/Dev roles|data-dev-roles|\/dev\/login|Unknown dev role|Run npm run dev:seed first|dev-only-host\.example\.com/,path);
    checked++;
  }
}}
scan('portal/dist');scan('portal/.netlify/build');
assert.ok(checked>0);console.log(`Production exclusion passed (${checked} build files).`);
