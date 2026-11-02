# Staff API

The public website (`trinityclassical.academy`, Netlify site `tcabham`) owns the data. Tour requests, interest notes, tour dates, and the announcement banner are stored in a Netlify Blobs store named `admissions` (production). Deploy previews of the website use `admissions-deploy-preview` so they cannot overwrite live records.

The staff admin (`admin.trinityclassical.academy`) and, later, the family portal (`app.trinityclassical.academy`) do not keep their own copy of this data. They call this API.

One secret, `TCA_ADMIN_TOKEN`, is the shared staff login. Set it on the **website** Netlify site. The same value is what every staff tool sends to `POST /api/admin/session`. It is compared in constant time. A match sets an httpOnly cookie, `tca_admin_session`, for 30 days. The cookie is a signed session, not the token itself.

## Who calls what

| Caller | Endpoints | Auth |
| --- | --- | --- |
| Public website pages | `GET /api/banner`, `GET /api/banner/flyer`, `GET /api/tours`, `POST /api/tour-requests`, `POST /api/interest` | None. Same origin. |
| Staff admin, and later the portal | `/api/admin/*` | Session cookie, or `Authorization: Bearer` with the same session value |

Public pages on the website call the API on their own origin. The admin site proxies `/api/*` to `https://trinityclassical.academy/api/:splat` (see `admin/netlify.toml`) so the browser treats the session as first-party.

A tool that calls the API on another origin must send `credentials: 'include'`. The API allows credentialed browser calls from the origins in `ADMIN_ORIGINS` (comma-separated). If that variable is unset, the allowed origins are:

- `https://admin.trinityclassical.academy`
- `http://127.0.0.1:5173`
- `http://localhost:5173`

Cross-site session cookies are `SameSite=None; Secure`. Same-site and local proxied calls stay `SameSite=Lax`.

## Staff session

`POST /api/admin/session`

```json
{ "token": "<TCA_ADMIN_TOKEN>" }
```

- `200` `{ "ok": true }` and `Set-Cookie: tca_admin_session=...; HttpOnly`
- `401` `{ "error": "That token isn't valid. ..." }`
- `503` if `TCA_ADMIN_TOKEN` is not set on the website

`GET /api/admin/session` returns `{ "ok": true }` or `401`.

`DELETE /api/admin/session` clears the cookie.

Later portal sections should use this same session. Do not invent a second staff password.

## Banner

`GET /api/admin/banner` returns `{ current, history }`. Each banner includes `version` and `active`.

`PUT /api/admin/banner` replaces the current banner and pushes the previous one onto `history` (dates on a reused banner are the caller's job to clear).

```json
{
  "enabled": true,
  "text": "Up to 120 characters",
  "startsOn": "2027-01-04",
  "endsOn": "2027-01-21",
  "clickAction": "flyer",
  "url": "",
  "flyer": null,
  "modal": {
    "title": "",
    "date": "",
    "time": "",
    "location": "",
    "description": "",
    "rsvpUrl": "",
    "rsvpLabel": "RSVP",
    "secondaryUrl": "",
    "secondaryLabel": ""
  }
}
```

`clickAction` is `flyer` or `url`. `startsOn` and `endsOn` are `YYYY-MM-DD` in America/Chicago, or empty. `flyer` is `null` to remove it, omitted to keep the saved file, or `{ key, name, contentType, size }` from an upload.

`POST /api/admin/banner/flyer` is `multipart/form-data` with a field named `flyer`. PNG, JPEG, WebP, or PDF, up to 8 MB. Response: `{ "flyer": { "key", "name", "contentType", "size" } }`.

`GET /api/admin/banner/flyer?key=flyer/<uuid>` returns the file. Staff session required.

Public read (no auth), used by the website banner:

`GET /api/banner` → `{ "active": false }` or `{ active, version, text, clickAction, url, flyer, modal }`.

`GET /api/banner/flyer` returns the current flyer only while the banner is active.

Dismissal in the browser uses `localStorage` key `tca:banner:dismissed`. The value is `version`. Changing the banner content changes `version`, so the banner shows again.

## Tours and interest notes

`GET /api/tours` (public) → dates that are still ahead, with `remaining`, `full`, `timeLabel`, `schoolYear`, and the confirmation copy.

`POST /api/tour-requests` (public)

```json
{
  "parentName": "",
  "email": "",
  "phone": "",
  "children": "",
  "grades": ["K", "2"],
  "tourDateId": "2027-01-13",
  "hearAbout": "friend",
  "message": "",
  "company": ""
}
```

`company` is a honeypot. A non-empty value returns `{ "ok": true }` and stores nothing.

- `200` `{ ok, givenName, email, dateLabel, timeLabel, location, confirmationMessage, whatToExpect }`
- `400` `{ error, fields }` field messages for the form
- `409` `{ error, code: "date_full", fields }` that date filled before the save

`POST /api/interest` (public)

```json
{ "name": "", "email": "", "phone": "", "message": "", "pagePath": "/admissions", "company": "" }
```

`200` `{ ok, givenName }`. Phone is optional.

`GET /api/admin/overview` (staff) returns `{ source, today, dates, suggestedDates, requests, interest, grades, hearAbout }`. `dates` include `booked`. `source` is `saved` or `default`.

`PUT /api/admin/tour-dates` (staff)

```json
{ "dates": [{ "date": "2027-01-13", "startTime": "09:00", "endTime": "10:00", "capacity": 12, "enabled": true }] }
```

`POST /api/admin/tour-requests/cancel` (staff) `{ "id": "<uuid>" }` marks a request cancelled and frees the seat. The row stays in the export.

`GET /api/admin/export?type=tours` and `?type=interest` return CSV. Staff session required.

## Not in this API yet

Families, portal questions, RSVPs, and applications will be more routes under `/api/admin/` (or a sibling prefix the portal owns) and more sections in the staff admin. They should use `tca_admin_session`. They should not add a second login.

There is no email sender in this repo. If `SCHOOL_NOTIFY_WEBHOOK_URL` is set, new tour requests and interest notes are also POSTed there as `{ type, text, data }`. See `src/lib/admissions/notify.ts`.
