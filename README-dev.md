# Disposable local portal

Requires Node 22.23.4+, npm and Docker. From this checkout:

```sh
npm install
npm run dev:local
```

This reads the committed `.env.dev.example` defaults, creates/starts `tca-dev-postgres` on **127.0.0.1:55440**, applies the existing migrations, seeds an empty database, and starts the portal with hot reload at **http://127.0.0.1:3500**. Environment variables override defaults. The database `tca_dev` is disposable and separate from refactor/test Postgres on 55434. No production connection is used. Mail and notification webhooks are logged as one-line to/subject summaries, even if keys are set. ClassReach fixtures make no network calls; do not run the manual sync against live ClassReach.

```sh
npm run dev:seed             # reset and load rich data
npm run dev:seed -- --empty  # reset to role accounts only, for empty states
# Ctrl-C stops the dev server
docker stop tca-dev-postgres
# To discard the database entirely (after stopping the server):
docker rm -f tca-dev-postgres
```

Use the small **Dev roles** menu in the lower right to switch to admin, staff, guardian, prospect, or signed out. It exists only in Astro development mode with the shared local guard satisfied. Production builds contain no quick sign-in handler or menu.

All four accounts use the fake password **`Trinity-dev-only-2026!`**:

| Role | Email | Landing page |
| --- | --- | --- |
| Admin · Morgan Ellis | admin@example.com | /admin |
| Staff · Claire Bennett | staff@example.com | /home |
| Guardian · Rachel Brooks | guardian@example.com | /g |
| Prospect · Daniel Parker | prospect@example.com | /home |

Staff retains the existing staff permissions; admin pages require the admin role. Additional families use the same disposable password. All fixture emails are @example.com.

For the UI pass, open **Cursor or VS Code → Remote-SSH → `nucbox`**, folder **`~/work/tca/website-dev`**. Run this in that checkout to expose the portal on your network:

```sh
DEV_HOST=0.0.0.0 npm run dev:local
```

Open **http://nucbox-k8-plus:3500** or **http://100.113.9.63:3500** (Tailscale). Postgres remains bound to loopback. `DEV_HOST` defaults to `127.0.0.1`; `DEV_PORT` defaults to `3500`. `DEV_ALLOWED_HOSTS` is a comma-separated Vite dev-server allowlist (defaults include both URLs above); it has no production build effect.

Destructive scripts require `DEV_LOCAL=1`, a loopback Postgres URL, and no `NETLIFY`, `CONTEXT`, or `DEPLOY_URL` variable (even an empty one). The npm launcher additionally requires database `tca_dev` on port 55440. Direct seed invocation requires explicit environment setup; do not point it at any database you want to keep. Local document/flyer files live in `.data/dev-admissions`.

Checks: `node --test --test-concurrency=1 tests/dev-{local,email}.test.mjs`, `npm run test:dev:build`, and `DEV_LOCAL=1 DATABASE_URL=postgres://tca:tca@127.0.0.1:55440/tca_dev node tests/dev-seed-smoke.mjs`. With the local server running, use `DEV_LOCAL=1 DATABASE_URL=postgres://tca:tca@127.0.0.1:55440/tca_dev PORTAL_E2E_URL=http://127.0.0.1:3500 node tests/e2e/dev-local.request.mjs`.

## On the NucBox (already running)

The checkout `~/work/tca/website-dev` runs in tmux session `tca-dev` at **http://nucbox-k8-plus:3500** (also `http://100.113.9.63:3500`, Tailscale only). Saved edits hot-reload in the browser.

```sh
tmux attach -t tca-dev                      # view logs (detach: Ctrl-b d)
tmux kill-session -t tca-dev                # stop
~/work/tca/dev-start.sh                     # start again (also after a NucBox reboot)
cd ~/work/tca/website-dev && npm run dev:seed   # reseed while running
```
