# Staff admin

Astro app for `admin.trinityclassical.academy`. It is not a page on the public website.

Sign-in is one staff key (`TCA_ADMIN_TOKEN`), then a 14-day httpOnly cookie scoped to this host. The same database as the website and the family portal holds the banner, tour dates, tour requests, interest notes, families, bookings, questions, RSVPs, and events. Applications is a disabled “later” item.

Flyer files stay in the website’s Netlify Blobs. Set `FLYER_SITE_ID` and `FLYER_BLOB_TOKEN` on this site so uploads land there.

Netlify base directory: `admin`. DNS and the rest of the environment are in `docs/architecture.md`.

```sh
npm run dev --workspace=admin
```

Open `http://127.0.0.1:4322`. The website dev server does not have to be running. This app talks to Postgres directly.
