/** One boundary for destructive fixtures and local-only app features. Never include credentials in errors. */
export function isLocalDev(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DEV_LOCAL !== '1' || ['NETLIFY', 'CONTEXT', 'DEPLOY_URL'].some(key => env[key] !== undefined)) return false;
  try {
    const url = new URL(env.DATABASE_URL || '');
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
      // postgres.js accepts connection overrides through query parameters.
      && [...url.searchParams.keys()].every(key => key === 'sslmode' && url.searchParams.get(key) === 'disable');
  } catch { return false; }
}

export function assertLocalDev(env: Record<string, string | undefined> = process.env): void {
  if (!isLocalDev(env)) throw new Error('Local dev refused: require DEV_LOCAL=1, a loopback Postgres DATABASE_URL, and no NETLIFY, CONTEXT or DEPLOY_URL environment variables.');
}
