# Implementation checklist — Admin Panel (Crouton Alpha)

## Stage 1 — Inspect (done)
- [x] Audited index.html / app.js / style.css / README
- [x] Identified localStorage-only store, seeded lecturers/student, hash routes

## Stage 2 — Backend & persistence (done)
- [x] db.js — node:sqlite shared DB, scrypt hashing, schema, seed
- [x] server.js — sessions (httpOnly), CSRF, rate limit, maintenance gate, static + API
- [x] Password hashing, server-side RBAC, audit logs, safe migration endpoint

## Stage 3 — Admin dashboard (done)
- [x] /admin login (separate session cookie, env/one-time bootstrap, must-change flow)
- [x] Dashboard overview (counts, statuses, recents, site status)
- [x] Lecturer CRUD (create/edit/deactivate/reactivate/delete + reassign, reset pw, search/filter, tickets, last login)
- [x] Student management (view/edit/suspend/reactivate/delete, reset pw, ticket history, search/filter)
- [x] Ticket management (all tickets, search/filter, history, status, reassign, CSV export)
- [x] Notifications (6 recipient types, selected+Select All/Clear, count preview, confirm, history, read states, sound preview, scheduling/expiry, idempotent sends)
- [x] Website Control (maintenance toggle, title/message/reopening, confirmation, emergency recovery note)
- [x] Branding & Settings (brand, title, welcome, logo upload (magic-byte validated, 1MB), footer, institution, color, contact)
- [x] Activity Logs (persistence of admin actions, no passwords logged)
- [x] Admin Profile (change own password, min 10)

## Stage 4 — Main site integration (done)
- [x] app.js rewritten as API client (preserves routes, design, workflows)
- [x] Notification center + sound toggle (localStorage), 15s polling, no replay, read marking
- [x] Settings-driven branding (title, hero, footer, logo, primary color, favicon)
- [x] Maintenance page (blocks student/lecturer)
- [x] Legacy localStorage one-time import (/api/migrate-local)

## Stage 5 — Testing (done, server-side)
- [x] /admin 200, admin login/logout, anon->admin 403
- [x] Lecturer create->login, edit, reset pw, deactivate blocks login, reactivate, delete reassign guard
- [x] Student suspend/reactivate, registration, ticket create/route/reply E2E
- [x] Notifications: all_students/all_lecturers/everyone/specific, count, history, idempotent
- [x] Maintenance on/off blocks+restores; student/lecturer->admin 403; CSRF enforced
- [x] Settings persistence; test data cleaned back to seed (1 student, 7 lecturers, 3 tickets)
- [x] Final sweep (2026-11-04): GET /, /admin, app.js, sounds 200; overview 200; 7 lecturers / 1 student / 3 tickets; anon 403; student login 200 + student->admin 403; lecturer login 200 + lecturer->admin 403; wrong admin pw 401; no-CSRF mutation 403; maintenance off; brand default

## Stage 6 — Deployment docs (done)
- [x] .env.example, README (local run, admin setup, /admin routing, backup/restore, reverse proxy, env vars)

## Stage 7 — Render production (done)
- [x] package.json (Node 24.x, `npm start` = `node server.js`), .node-version/.nvmrc, render.yaml (paid plan, 10GB disk /var/data, /healthz)
- [x] DATA_DIR persistence: DB -> /var/data/helpdesk.sqlite, uploads -> /var/data/uploads, sounds -> /var/data/sounds (env-overridable, auto-created)
- [x] GET /healthz (200 DB-ok / 503 DB-down, no auth, no secrets); security headers; DB/.env never served; upload path-traversal guard
- [x] Production admin bootstrap: ADMIN_USERNAME/ADMIN_PASSWORD required on fresh prod DB (must_change_password=1), one-time fallback kept for local dev only
- [x] SEED_DEMO gate: demo users/tickets never auto-seeded in production; existing records never overwritten/deleted
- [x] .gitignore (.env, *.sqlite*, node_modules, uploads, backups); README rewritten for Render incl. dashboard steps, backup/restore, troubleshooting

## Notes / remaining
- Sounds are procedurally generated WAVs (default/chime/alert/gentle) — no autoplay bypass; user must enable on device.
- Notification delivery uses 15s polling (chosen over WebSocket/SSE for simple shared hosting).
- Browser rendering not visually tested here; run locally and open / and /admin to verify on desktop+mobile.

## Handoff state (for next session)
- Server running: http://localhost:3000/ and http://localhost:3000/admin (node server.js)
- DB state: 1 student, 7 lecturers, 3 tickets, maintenance OFF, brand "Student Help Desk", audit cleared except post-cleanup logins
- Admin bootstrap: env ADMIN_USERNAME/ADMIN_PASSWORD or one-time password in server log (username admin — the one-time value printed at first boot was redacted here; if you never changed it, sign in with the log from your own first boot and change it immediately). CHANGE any previously exposed admin password.
- Files: server.js, db.js, app.js, index.html, style.css, admin/{index.html,app.js,style.css}, package.json, render.yaml, .env.example, .gitignore, .node-version, CHECKLIST.md, README.md, README.txt (legacy browser-only note — historical), data/helpdesk.sqlite, assets/sounds/*.wav
- Next action for owner: open browser, sign in to /admin, change admin password, visually verify desktop+mobile. For Render: push to GitHub, create Blueprint or Web Service per README, set ADMIN_USERNAME/ADMIN_PASSWORD in the dashboard.
