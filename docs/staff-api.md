# Staff access

Staff do not sign in on the public website. The admin app at `admin.trinityclassical.academy` (`admin/`) checks `TCA_ADMIN_TOKEN` in constant time and sets an httpOnly cookie, `tca_admin_session`, for 14 days. The cookie is scoped to the admin host.

The public site, the family portal, and the admin app all use the shared package `@tca/school` and one Postgres database. There is no separate API service. See `docs/architecture.md`.

Families sign in on `app.trinityclassical.academy` with email and password. That session is a different cookie and does not accept the staff key.
