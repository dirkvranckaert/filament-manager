# Filament Manager

A browser-based filament inventory manager. Track your spool stock with color swatches, brand/type/variant filtering, and in-stock status across all devices.

Built with Node.js + Express + SQLite. Protected by session-based cookie auth.

---

## Features

- Color swatch carousel sorted by hue
- Brand, type, variant, and in-stock filters
- Add / edit / delete filaments with RGB + hex color picker
- Import and export JSON (compatible with old `filaments.json` backups)
- Configurable carousel row count (1–4 rows)
- Dark / light / system theme (persisted per-browser via settings)
- Session-based login page (no browser credential dialog)
- Sign out link
- Duplicate detection (same brand + type + variant + color)
- Optional public swatch view (`/swatches`) — shareable read-only page, no login required, configurable to show all or in-stock-only filaments

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 18 |
| Framework | Express 5 |
| Database | SQLite via `better-sqlite3` (file: `data/filaments.db`) |
| Auth | Session cookie (`fm_session`), credentials in `.env` |
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
    └── favicon.svg
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

The SQLite database is created automatically at `data/filaments.db` on first run.

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

All endpoints require a valid session cookie **except** the ones listed in the Public and Auth sections below. Payloads and responses are JSON.

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/swatches` | Serve the public read-only swatch page |
| GET | `/api/public/filaments` | List filaments for the public view — returns `403` if public view is disabled; respects the in-stock-only setting |

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
| DELETE | `/api/filaments/:id` | Delete filament |

Filament body fields: `brand`, `colorName`, `type` (`PLA` / `PETG` / `ABS` / `ASA` / `TPU`), `variant` (`Basic` / `Mat` / `Metal` / `Glow` / `Marble`), `inStock` (bool), `colorR` (0–255), `colorG` (0–255), `colorB` (0–255), `colorHex` (hex string).

Response includes `colorRGB: { r, g, b }` reconstructed from the flat columns.

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

### Export / Import

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export` | Download all filaments as a dated JSON file |
| POST | `/api/import` | Replace all filaments from a JSON array (old backups compatible) |

---

## Database schema

```sql
CREATE TABLE filaments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  brand     TEXT NOT NULL DEFAULT '',
  colorName TEXT NOT NULL DEFAULT '',
  type      TEXT NOT NULL DEFAULT 'PLA',
  variant   TEXT NOT NULL DEFAULT 'Basic',
  inStock   INTEGER NOT NULL DEFAULT 1,
  colorR    INTEGER NOT NULL DEFAULT 255,
  colorG    INTEGER NOT NULL DEFAULT 255,
  colorB    INTEGER NOT NULL DEFAULT 255,
  colorHex  TEXT NOT NULL DEFAULT '#ffffff'
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

Schema is applied via `CREATE TABLE IF NOT EXISTS` in `db.js` on every startup.

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

    location / {
        proxy_pass         http://127.0.0.1:3002;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

---

## Development notes

- **No build step.** Edit `public/index.html` and reload the browser. All UI and JS is in a single file.
- **Auth.** On login, the server generates a 32-byte random token, stores it in an in-memory `Set`, and sets an `HttpOnly` cookie (`fm_session`). Sessions are lost on server restart — users are redirected to login again.
- **Public swatch view.** `/swatches` and `/api/public/filaments` are registered before the auth middleware and are always accessible without a session. The API endpoint checks the `publicViewEnabled` setting and returns `403` if it is false or unset. When `publicViewInStockOnly` is true, only filaments with `inStock = 1` are returned. The public page applies dark mode via `@media (prefers-color-scheme: dark)` only — it cannot load the saved theme preference without authentication.
- **Theme.** The `theme` setting is loaded at startup and applied as a `data-theme` attribute on `<html>`. `system` removes the attribute (letting the OS `prefers-color-scheme` media query take effect), `light`/`dark` set it explicitly.
- **Settings storage.** Values are `JSON.stringify`-ed on write and `JSON.parse`-d on read in `server.js`.
