# Student Help Desk – PTI

A university student help desk with secure `@/admin` dashboard. Students sign in (matric + password), lecturers sign in with staff IDs, tickets are routed by lecturer ID, and an administrator manages everything from `/admin`.

**Stack:** Node.js 24.x · `node:sqlite` (built-in, zero npm dependencies) · plain HTML/CSS/JS. No `node_modules` install required beyond `npm install`.

> **Production hosting:** Render Web Service (paid plan) + persistent disk at `/var/data`. See [Deploy on Render](#deploy-on-render).

## Local development

### Prerequisites
- Node.js 24.x (see `.node-version` / `package.json` engines). `node:sqlite` requires Node 22.5+; Render uses 24.x.

### Run
```bash
npm install   # no-op deps, but keeps the workflow identical to Render
npm start     # or: node server.js
```

- Website: http://localhost:3000/
- Admin: http://localhost:3000/admin
- Health check: http://localhost:3000/healthz

On first start the server creates the DB, seeds **development-only** demo data (see below), and prints a **one-time admin password** in the terminal. Sign in at `/admin` as `admin`, then change the password under **Admin Profile** (min 10 chars; the account is flagged `must_change_password`).

Copy `.env.example` to `.env` for local overrides (never commit `.env`):

```bash
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
```

### Development demo data
When `SEED_DEMO=true` (default locally) or `NODE_ENV=development`, a fresh empty DB is seeded with demo accounts below. Production (`NODE_ENV=production`) **never** auto-seeds demo users, lecturers, tickets or passwords. Existing records are never deleted or overwritten.

| Role | ID | Password |
| --- | --- | --- |
| Student | `CSC/2024/0142` | `student123` |
| Lecturer | `STAFF-1042` (and 6 more seeded staff) | `lecturer123` |

Change all demo passwords via the admin panel before any shared use.

## Environment variables

| Var | Default (local) | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen port (Render injects automatically) |
| `HOST` | `0.0.0.0` | Listen address |
| `NODE_ENV` | unset | Set `production` on Render |
| `DATA_DIR` | unset | Persistent disk root. Production: `/var/data` |
| `DATABASE_PATH` | `$DATA_DIR/helpdesk.sqlite` or `./data/helpdesk.sqlite` | SQLite file (WAL sidecars live alongside it) |
| `UPLOADS_DIR` | `$DATA_DIR/uploads` or `assets/uploads` | Uploaded logos/images |
| `SOUNDS_DIR` | `$DATA_DIR/sounds` or `assets/sounds` | Custom notification sounds (built-in WAVs are generated on first boot) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | Create first admin from env when NO admin exists yet (≥10 chars). Required in production; the server refuses to boot without them on a fresh production DB. Never overwritten afterwards. Account is flagged to change password at first sign-in. |
| `COOKIE_SECURE` | unset | `true` behind HTTPS (adds `Secure` to HttpOnly/SameSite=Lax session cookies). Render: always `true`. |
| `SEED_DEMO` | `true` locally / `false` in prod | `true` seeds demo data on a fresh empty DB (dev only) |

## Admin panel (`/admin`)

Sections: Dashboard · Lecturers · Students · Tickets · Notifications · Website Control · Branding & Settings · Activity Logs · Admin Profile.

- **Lecturers** — create, edit, reset password (scrypt-hashed server-side), deactivate/reactivate, soft-delete with ticket reassign guard.
- **Students** — view/edit/suspend/reactivate/soft-delete, reset passwords, view ticket history, search/filter.
- **Tickets** — view all, search/filter, conversation history, status changes, reassign, CSV export.
- **Notifications** — All students / Selected students / All lecturers / Selected lecturers / Everyone / One specific user; search + checkboxes, **Select All** = every eligible account in scope, **Clear Selection**; count + confirmation before sending; schedule + expiry; sound options (default/chime/alert/gentle/custom) with preview; idempotent sends; history with recipients + read counts.
- **Website Control** — maintenance on/off with title/message/reopening time; confirmation dialog; admin stays able to restore. Data is never deleted.
- **Branding & Settings** — brand name, title, welcome, footer, institution, primary color, contact, logo upload (PNG/JPG/WEBP/GIF/SVG ≤1MB, magic-byte validated).
- **Activity Logs** — every admin action (no passwords) with timestamps.
- **Sounds** — recipients enable sound on their device (toggle in the notification bell); plays once per new unread notification, respects browser autoplay rules, never replays on refresh (state persisted server-side).

## Deploy on Render

A `render.yaml` Blueprint in this repo configures everything (paid plan + 10GB disk at `/var/data`). You can use the Blueprint (recommended) or create the service manually.

### 1. Create the GitHub repository
1. Go to GitHub → **New repository** → name e.g. `pti-student-help-desk` → **Create repository** (do not add a README — one already exists).
2. In PowerShell, in this project folder, run the commands in [Git commands](#git-commands-powershell).

### 2. Push to GitHub
See [Git commands](#git-commands-powershell) below. Verify `.env`, `data/*.sqlite`, and `node_modules/` are **not** in the repo (`.gitignore` covers them).

### 3. Create the Render Web Service (Blueprint)
1. Go to the Render Dashboard → **New → Blueprint** → connect the GitHub repo.
2. Render reads `render.yaml` and creates `pti-student-help-desk` (Node, paid plan, disk `pti-helpdesk-data` 10GB → `/var/data`, health check `/healthz`).
3. Review, then **Apply**.

### ...or create the service manually
1. Render Dashboard → **New → Web Service** → connect the repo.
2. Settings:
   - **Name:** `pti-student-help-desk`
   - **Runtime:** Node
   - **Plan:** Standard (paid — free plan cannot have persistent disks)
   - **Root directory:** `.` (repo root)
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/healthz`
3. **Disk:** add persistent disk `pti-helpdesk-data`, mount path `/var/data`, size 10GB (Starter plans allow 1–10GB; Standard allows more — 10GB is plenty for SQLite + uploads; check Render's current limits for your plan).
4. **Environment variables** (Dashboard → Environment):
   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `HOST` | `0.0.0.0` |
   | `DATA_DIR` | `/var/data` |
   | `DATABASE_PATH` | `/var/data/helpdesk.sqlite` |
   | `COOKIE_SECURE` | `true` |
   | `SEED_DEMO` | `false` |
   | `ADMIN_USERNAME` | your admin username (e.g. `admin`) |
   | `ADMIN_PASSWORD` | a strong random password (min 10 chars) — generate one, save it in a password manager, **never commit it** |
   - Do **not** set `PORT` (Render injects it).
5. **Create Web Service** → wait for the first deploy.

### 4. First sign-in
1. Open `https://<your-service>.onrender.com/admin`
2. Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from step above.
3. You are flagged to change the password — change it immediately under **Admin Profile** (the env vars only matter when no admin exists; they never overwrite an existing admin).
4. Remove / ignore `ADMIN_PASSWORD` from the dashboard afterwards (optional; it is inert once an admin exists).

### 5. Accessing the site
- Website: `https://<your-service>.onrender.com/`
- Admin: `https://<your-service>.onrender.com/admin`

### 6. Updates
Push to the branch connected in Render → Render auto-deploys (Blueprint sets `autoDeploy: true`). Data survives because the disk is mounted at `/var/data`.

## Git commands (PowerShell)

```powershell
cd C:\Users\USER\Desktop\student-help-desk-shedrack-main\student-help-desk-shedrack-main

# First time
git init
git branch -M main
git add .
git status            # verify NO .env / data/*.sqlite / node_modules staged
git commit -m "Production-ready Render deployment (persistent storage, health check, secure admin)"
git remote add origin https://github.com/<you>/pti-student-help-desk.git
git push -u origin main

# Later changes
git add .
git commit -m "describe your change"
git push
```

If the DB or credentials were ever committed by mistake, remove them from tracking (local files stay):

```powershell
git rm --cached .env data/helpdesk.sqlite data/helpdesk.sqlite-wal data/helpdesk.sqlite-shm
git commit -m "Stop tracking database and secrets"
git push
# Then ROTATE any password that was ever committed — treat it as compromised.
```

## Backup & restore

The SQLite DB plus WAL/SHM sidecars live together in `DATA_DIR` (`/var/data` in production). Back up the whole set while the server is stopped, or copy all three files consistently.

```bash
# Local / VPS-style (stop server first, or copy all files together)
cp data/helpdesk.sqlite data/helpdesk.sqlite.bak
cp data/helpdesk.sqlite-wal data/helpdesk.sqlite-wal.bak 2>/dev/null || true
cp data/helpdesk.sqlite-shm data/helpdesk.sqlite-shm.bak 2>/dev/null || true
# restore
cp data/helpdesk.sqlite.bak data/helpdesk.sqlite
```

- **Render disk:** use Render Dashboard → Disk → **Snapshots** (paid) for point-in-time restore, plus periodic manual exports. Also back up `/var/data/uploads/` and `/var/data/sounds/`.
- **SQLite checkpoint:** the server uses WAL mode; before a cold backup run a checkpoint (`sqlite3 data/helpdesk.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"`) if the `sqlite3` CLI is available.
- Do **not** run multiple app instances against the same SQLite file.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Server exits: `no administrator exists ... ADMIN_USERNAME/ADMIN_PASSWORD are not set` | Set both env vars in the Render Dashboard (≥10 char password), then redeploy. Only needed on a fresh DB. |
| `ECONNREFUSED` / health check failing on Render | Confirm Start command is `npm start`, health check path `/healthz`, and the app logs show `[server] Student Help Desk running`. Health check returns 503 when the DB is unreachable. |
| Data disappeared after redeploy | The disk is not mounted. Check Disk `pti-helpdesk-data` → mount path `/var/data`, and `DATA_DIR=/var/data` + `DATABASE_PATH=/var/data/helpdesk.sqlite`. Free plans have no disks — upgrade to a paid plan. |
| `EADDRINUSE` / port errors locally | Another process already uses the port. Change `PORT` (e.g. `PORT=3001 node server.js`) or stop the other process. |
| `node:sqlite` import error | Node < 22.5. Use Node 24.x (`nvm use` / `.nvmrc`, or Render `engines`). |
| Cannot log in after deploy | Verify `COOKIE_SECURE=true` (Render HTTPS) and that you are using `https://…/admin`. Check admin `active=1` and that maintenance mode is off (Website Control). |
| Uploaded logo/sound 404 | Check `UPLOADS_DIR`/`SOUNDS_DIR` point inside the disk (`/var/data/uploads`, `/var/data/sounds`) and that files were written there (server logs `file_uploaded` audit entries). |
| Windows `cp` unavailable | Use `Copy-Item data\helpdesk.sqlite data\helpdesk.sqlite.bak` in PowerShell. |

## Security notes

- Session cookies: HttpOnly + SameSite=Lax (+ Secure on HTTPS). CSRF double-submit enforced on all mutations. Passwords: scrypt (salted, server-side). Rate-limited auth endpoints. Role-based authorization (student/lecturer/admin) on every API route. Security headers (`HSTS`, `nosniff`, `frame-ancestors` via `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).
- The database, `.env` and WAL/SHM files are never served over HTTP. Uploaded files are type- + size-validated (magic bytes, 1MB images / 2MB sounds) and path-traversal protected.
- Notification-sound preference is a per-device browser setting; shared state (tickets, users, notifications) always lives server-side in SQLite — never browser storage.
- Admin activity is audit-logged (no passwords). See Activity Logs in `/admin`.

## Preserved workflows

Student sign-in · lecturer sign-in (staff ID) · ticket creation routed by exact lecturer ID · student history · lecturer oldest-first queue · responses/status · close/reopen · maintenance mode · branding/logo uploads · notification sounds · same visual design and routes (`#home`, `#student-login`, `#lecturer-login`, `#student`, `#lecturer`).
