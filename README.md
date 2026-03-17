# Filament Manager

A browser-based filament inventory manager. Track your spool stock with color swatches, brand/type/variant filtering, and in-stock status across all devices.

Built with Node.js + Express + SQLite. Protected by session-based cookie auth.

---

## Features

- Color swatch carousel sorted by hue
- **Pattern image per swatch** — upload a square image (e.g. marble, glitter texture) that fills the swatch visually; hex color is still stored for sorting
- Brand, type, variant, and in-stock filters
- Add / edit / delete filaments with RGB + hex color picker
- Duplicate detection (same brand + type + variant + color)
- Configurable carousel row count (1–4 rows)
- Dark / light / system theme (persisted per-browser via settings)
- Session-based login page (no browser credential dialog)
- Sign out link
- **ZIP backup / restore** — export all filaments + pattern images as a single `.zip`; import accepts `.zip` (new) or legacy `.json` (backward compatible)
- Optional public swatch view (`/swatches`) — shareable read-only page, no login required, configurable to show all or in-stock-only filaments; pattern images are also visible on the public view

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 18 |
| Framework | Express 5 |
| Database | SQLite via `better-sqlite3` (file: `data/filaments.db`) |
| Auth | Session cookie (`fm_session`), credentials in `.env` |
| File uploads | `multer` (memory storage) — images written to `public/uploads/` |
| ZIP archive | `adm-zip` — used for backup export and restore import |
| Frontend | Vanilla JS / CSS / HTML (no build step) |

---

## Project structure

```
filament-manager/
├── server.js             ← Express app: static serving, session auth, REST API
├── db.js                 ← SQLite setup and schema initialisation
├── ecosystem.config.js   ← PM2 process config
├── package.json
├── .env                  ← ADMIN_USER / ADMIN_PASS  (never commit — see .env.example)
├── .env.example          ← Template showing required variables
├── .gitignore
├── data/
│   └── filaments.db      ← SQLite file (auto-created on first run, never commit)
└── public/
    ├── index.html        ← All UI + frontend logic (single file)
    ├── login.html        ← Login page (served unauthenticated)
    ├── swatches.html     ← Public read-only swatch viewer (served unauthenticated)
    ├── favicon.svg
    └── uploads/          ← Pattern images (auto-created, never committed — see .gitignore)
        └── pattern_<id>.<ext>
```

---

## Local setup

**Requirements:** Node.js >= 18, npm

```sh
cd filament-manager
npm install
```

Copy `.env.example` to `.env` and set your credentials:

```sh
cp .env.example .env
```

```
ADMIN_USER=admin
ADMIN_PASS=yourpassword
PORT=3002
```

Start the server:

```sh
npm start
# or: node server.js
```

Open http://localhost:3002 — you will be redirected to the login page.

The SQLite database and `public/uploads/` directory are created automatically on first run.

---

## Security

- **Credentials** are stored only in `.env` (never committed). Change `ADMIN_PASS` from the example value before deploying.
- **Sessions** are random 32-byte tokens stored in an in-memory `Set`. Sessions are lost on server restart — users are redirected to login again. There is currently no session expiry; use a reverse proxy with HTTPS to protect the cookie in transit.
- **Auth middleware** guards all routes except `/login`, `/logout`, `/swatches`, `/api/public/filaments`, and `/uploads/*`. The `/uploads/*` path is intentionally public so that the unauthenticated `/swatches` page can render pattern images.
- **File uploads** are validated by MIME type (`image/*` only) and capped at 10 MB per image. File names are server-controlled (`pattern_<id>.<ext>`) — original file names from the client are never used as paths.
- **ZIP imports** are capped at 50 MB. Only files under `uploads/` inside the ZIP are extracted to disk; `filaments.json` is the only other entry read.
- **Public view** (`/swatches`) is opt-in. It is disabled by default and must be enabled explicitly in Settings. When enabled it can be restricted to in-stock-only filaments.
- **SQL** uses parameterised `better-sqlite3` prepared statements throughout — no string interpolation in queries.
- **Deploy behind HTTPS.** The `fm_session` cookie does not set `Secure` because the server itself only speaks HTTP; the reverse proxy (nginx) should enforce HTTPS and can add `Secure` via a `proxy_cookie_flags` directive if needed.

---

## Running in the background with PM2

```sh
npm install -g pm2

# From the filament-manager directory:
pm2 start ecosystem.config.js
pm2 save   # persist so it survives reboots
```

### Auto-start on boot — Linux / VPS (systemd)

```sh
pm2 startup systemd
# copy-paste the printed sudo command, then:
pm2 save
```

### Common commands

```sh
pm2 status                    # list all managed processes
pm2 logs filament-manager     # tail live logs
pm2 restart filament-manager  # restart after a code update
pm2 stop filament-manager     # stop without removing from list
pm2 delete filament-manager   # remove from list entirely
```

### Deploying an update

```sh
git pull
npm install --omit=dev
pm2 restart filament-manager
```

---

## REST API

All endpoints require a valid session cookie **except** the ones listed in the Public and Auth sections below. Payloads and responses are JSON unless noted.

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/swatches` | Serve the public read-only swatch page |
| GET | `/api/public/filaments` | List filaments for the public view — returns `403` if public view is disabled; respects the in-stock-only setting |
| GET | `/uploads/:filename` | Serve a pattern image file — public so the `/swatches` page can display them |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| GET | `/login` | Serve the login page |
| POST | `/login` | Authenticate — body: `{ username, password }` — sets `fm_session` cookie on success |
| GET | `/logout` | Clear session cookie and redirect to `/login` |

### Filaments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/filaments` | List all filaments |
| POST | `/api/filaments` | Create filament — body: see schema |
| PUT | `/api/filaments/:id` | Replace filament (full update) |
| DELETE | `/api/filaments/:id` | Delete filament and its pattern image (if any) |

Filament body fields: `brand`, `colorName`, `type` (`PLA` / `PETG` / `ABS` / `ASA` / `TPU`), `variant` (`Basic` / `Mat` / `Metal` / `Glow` / `Marble`), `inStock` (bool), `colorR` (0–255), `colorG` (0–255), `colorB` (0–255), `colorHex` (hex string).

Response includes `colorRGB: { r, g, b }` reconstructed from the flat columns, and `patternImage` (filename string or `null`).

### Pattern images

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/filaments/:id/pattern` | Upload or replace pattern image — `multipart/form-data`, field name `image`, max 10 MB, `image/*` MIME only. Returns `{ patternImage: "pattern_<id>.<ext>" }` |
| DELETE | `/api/filaments/:id/pattern` | Remove pattern image — deletes the file and clears the DB field |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/:key` | Get setting — returns `{ key, value }` or 404 |
| PUT | `/api/settings/:key` | Upsert setting — body: `{ value }` |

Known keys:

| Key | Type | Description |
|-----|------|-------------|
| `rows` | integer | Carousel row count (1–4) |
| `theme` | string | `system` / `light` / `dark` |
| `publicViewEnabled` | boolean | Enable the unauthenticated `/swatches` page and `/api/public/filaments` endpoint |
| `publicViewInStockOnly` | boolean | When public view is enabled, only return filaments with `inStock = true` |

### Backup / Restore

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export` | Download a ZIP containing `filaments.json` + all pattern images under `uploads/`. Filename: `filaments-backup-YYYY-MM-DD.zip` |
| POST | `/api/import` | Restore from backup — accepts `multipart/form-data` with field `backup` containing a `.zip` (new format) or a raw JSON array body (legacy). **Replaces all existing data.** |

The ZIP format is self-contained: importing it on a fresh instance restores all filament data and pattern images. Old `.json` backups (exported before pattern image support was added) remain importable.

---

## Database schema

```sql
CREATE TABLE filaments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand        TEXT    NOT NULL DEFAULT '',
  colorName    TEXT    NOT NULL DEFAULT '',
  type         TEXT    NOT NULL DEFAULT 'PLA',
  variant      TEXT    NOT NULL DEFAULT 'Basic',
  inStock      INTEGER NOT NULL DEFAULT 1,
  colorR       INTEGER NOT NULL DEFAULT 255,
  colorG       INTEGER NOT NULL DEFAULT 255,
  colorB       INTEGER NOT NULL DEFAULT 255,
  colorHex     TEXT    NOT NULL DEFAULT '#ffffff',
  patternImage TEXT                            -- filename in public/uploads/, nullable
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

The base schema is applied via `CREATE TABLE IF NOT EXISTS` on every startup. The `patternImage` column is added via a migration-safe `ALTER TABLE` if it does not already exist (safe to run on an existing database).

---

## VPS deployment (nginx + PM2)

1. Copy the `filament-manager/` directory to your VPS (e.g. under `/opt/printseed/`).
2. Run `npm install --omit=dev` on the VPS.
3. Create `.env` with your credentials.
4. Start with PM2: `pm2 start ecosystem.config.js && pm2 save`.
5. Add an nginx `location` block (or a new `server` block) to proxy port 3002:

```nginx
server {
    listen 443 ssl;
    server_name filaments.yourdomain.com;

    # SSL config here (certbot / Let's Encrypt)

    # Increase max upload size for pattern images and ZIP backups
    client_max_body_size 55M;

    location / {
        proxy_pass         http://127.0.0.1:3002;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

> **Note:** Set `client_max_body_size` to at least `55M` to accommodate ZIP backups (max 50 MB) and pattern image uploads (max 10 MB).

---

## Development notes

- **No build step.** Edit `public/index.html` and reload the browser. All UI and JS is in a single file.
- **Auth.** On login, the server generates a 32-byte random token, stores it in an in-memory `Set`, and sets an `HttpOnly` cookie (`fm_session`). Sessions are lost on server restart — users are redirected to login again.
- **Pattern images.** Uploaded via `POST /api/filaments/:id/pattern` as `multipart/form-data`. Multer stores the file in memory; the route handler writes it to `public/uploads/pattern_<id>.<ext>`. Using memory storage (rather than disk storage) is intentional — it ensures `req.params.id` is available when the file is written, which is not guaranteed with multer's disk storage in Express 5.
- **Public swatch view.** `/swatches` and `/api/public/filaments` are registered before the auth middleware and are always accessible without a session. The `/uploads` static path is also registered before the auth middleware so pattern images are accessible to the public page. The public API endpoint checks the `publicViewEnabled` setting and returns `403` if it is false or unset.
- **Theme.** The `theme` setting is loaded at startup and applied as a `data-theme` attribute on `<html>`. `system` removes the attribute (letting the OS `prefers-color-scheme` media query take effect), `light`/`dark` set it explicitly.
- **Settings storage.** Values are `JSON.stringify`-ed on write and `JSON.parse`-d on read in `server.js`.
- **Uploads directory** (`public/uploads/`) is excluded from git (see `.gitignore`). On a fresh clone or VPS deploy the directory is created automatically by `server.js` on startup.
