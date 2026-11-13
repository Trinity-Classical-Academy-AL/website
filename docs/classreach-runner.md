# ClassReach pull on the NucBox

The portal does not call ClassReach. A small script on the NucBox (a residential address) logs in, reads the calendar and directory, and posts that snapshot to the portal. The portal stores it in staging tables. Families do not see it until an admin approves it.

Leave `CLASSREACH_SYNC_ENABLED` unset on Netlify. The hourly Netlify function stays off.

## Secrets

Generate one long random value and use it in both places. Do not commit it.

On the NucBox, in `/etc/tca/classreach.env` (mode `600`):

- `CLASSREACH_USERNAME`
- `CLASSREACH_PASSWORD`
- `CLASSREACH_INGEST_TOKEN`
- `CLASSREACH_INGEST_URL` is optional. The default is `https://portal.trinityclassical.academy/classreach/ingest`.

On the Netlify site **tca-portal-al**, Production scope, for functions and runtime:

- `CLASSREACH_INGEST_TOKEN` set to the same value

Do not set `CLASSREACH_SYNC_ENABLED`.

## Run once

From a checkout of this repo, with Node 22:

```bash
set -a
. /etc/tca/classreach.env
set +a
node --experimental-strip-types portal/scripts/classreach-pull.mjs
```

The script talks to ClassReach with the system `curl` binary, not Node’s fetch, because Cloudflare rejects Node’s TLS fingerprint. `curl` does not follow redirects; the runner follows each hop so the login cookie is kept. `CLASSREACH_TRANSPORT=fetch` switches back to Node. The ingest post to the portal still uses fetch. The script waits at least 1.5 seconds between ClassReach requests. A Cloudflare challenge stops the run immediately and does not post to the portal. A saved session is kept in `~/.local/share/tca/classreach-session.json`. `curl` must be installed.

## Hourly cron

```cron
17 * * * * . /etc/tca/classreach.env; cd /opt/tca/website && git pull --ff-only && /usr/bin/node --experimental-strip-types portal/scripts/classreach-pull.mjs >> /var/log/classreach-pull.log 2>&1
```

## systemd

The timer already on the NucBox needs this `ExecStartPre` line, then `systemctl daemon-reload`. The service user must be able to fast-forward `/opt/tca/website`.

`/etc/systemd/system/classreach-pull.service`:

```ini
[Service]
Type=oneshot
EnvironmentFile=/etc/tca/classreach.env
WorkingDirectory=/opt/tca/website
ExecStartPre=/usr/bin/git -C /opt/tca/website pull --ff-only
ExecStart=/usr/bin/node --experimental-strip-types portal/scripts/classreach-pull.mjs
```

`/etc/systemd/system/classreach-pull.timer`:

```ini
[Timer]
OnCalendar=*-*-* *:17:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now classreach-pull.timer
```
