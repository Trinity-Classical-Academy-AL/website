import config from './astro.config.mjs';
import { assertLocalDev } from '../packages/school/src/dev/local-guard.ts';
// Standalone Astro dev only: omit Netlify's emulator and account/config discovery.
// Production keeps using astro.config.mjs and the Netlify adapter unchanged.
assertLocalDev();
export default { ...config, adapter: undefined };
