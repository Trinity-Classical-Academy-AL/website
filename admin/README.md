# Staff admin

This folder is its own site, meant for `admin.trinityclassical.academy`. It is not a page on the public website. The public site does not link here.

It is the one staff login for:

- website content (the announcement banner now)
- tour dates, tour requests, and interest notes
- later: families, questions, and RSVPs for `app.trinityclassical.academy`
- later: applications

Those later sections are already in the navigation. They do not save anything yet.

The website owns the records. This app calls the API documented in `docs/staff-api.md`. Locally, Vite proxies `/api` to the website dev server at `http://127.0.0.1:4321`. In production, `netlify.toml` proxies `/api/*` to `https://trinityclassical.academy`.

## Run it locally

From the repo root, start the website (`npm run dev`), then:

```sh
cd admin
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The staff token is the website's `TCA_ADMIN_TOKEN`.

## Netlify site

Create a **second** Netlify site from this same repo. Do not replace the `tcabham` site.

1. New site → import `Trinity-Classical-Academy-AL/website`.
2. Base directory: `admin`.
3. Build command: `npm run build` (already in `admin/netlify.toml`).
4. Publish directory: `dist` (relative to `admin`).
5. Node 22.
6. Do **not** set `TCA_ADMIN_TOKEN` here. Set it on the **website** site (`tcabham`). The API lives there and is what checks the token.
7. Domain: add `admin.trinityclassical.academy`.
8. DNS: CNAME `admin` → the new site's `*.netlify.app` host. Leave the website's apex records alone.

After the domain is live, the proxy in this folder's `netlify.toml` sends `/api/*` to `https://trinityclassical.academy/api/:splat`. The browser only talks to the admin host, so the 30-day httpOnly session cookie stays first-party.

That proxy always targets the live website, including from a deploy preview of this admin site. A preview can change the live banner and live tour dates. Use local `npm run dev` to try writes against the website dev server instead.

Optional: `ADMIN_ORIGINS` on the **website** site if another origin (for example a portal preview) must call `/api/admin/*` directly instead of through this proxy. Comma-separated. See `docs/staff-api.md`.

Optional on this admin site: `VITE_API_ORIGIN` at build time, only if this app should call the API on another host instead of the proxy. Leave it unset for the normal setup.

The page sends `noindex`. There is no public link to it.
