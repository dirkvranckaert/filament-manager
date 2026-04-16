# Filament Manager — Claude Code Context

## What this is

A browser-based filament inventory manager for 3D printing. Part of the Printseed product suite (three apps under APP3 BV). Track spool stock with color swatches, brand/type/variant filtering, pattern images, and a public shareable swatch view.

## Who uses it

Dirk (primary), potentially shared with customers via the public swatch view. Accessed via browser.

## Tech stack

- **Node 20+**, Express 5, better-sqlite3, pm2 (fork, single instance)
- **Auth:** session cookie (`fm_session`) + shared JWT for cross-app SSO
- **File uploads:** multer (memory storage) for pattern images and gallery photos
- **ZIP archive:** `adm-zip` for backup export/restore
- **Frontend:** vanilla HTML/JS/CSS, no build step
- **Tests:** Jest 29 + supertest

## Project structure

```
filament-manager/
├── server.js            # Express app, all routes, auth, file upload handling
├── db.js                # SQLite setup + schema
├── shared-auth.js       # Cross-app JWT validation (Printseed SSO)
├── lib/
│   └── release-info.js  # Read release.env for version display
├── ecosystem.config.js  # PM2 config
├── package.json
├── .env                 # ADMIN_USER, ADMIN_PASS, JWT_SECRET (git-ignored)
├── data/
│   └── filaments.db     # SQLite file (auto-created, git-ignored)
├── public/
│   ├── index.html       # Main UI (single file with all frontend JS/CSS)
│   ├── login.html       # Login page
│   ├── swatches.html    # Public read-only swatch viewer
│   ├── heic2any.min.js  # HEIC conversion for iPhone photos
│   └── uploads/         # Pattern images + gallery photos (git-ignored)
│       ├── pattern_<id>.<ext>
│       └── filaments/<id>/   # Per-filament gallery subdirs
└── tests/
    ├── server.test.js
    └── release-info.test.js
```

## Key decisions

- **Shared auth (JWT)** — all three Printseed apps share a JWT secret for SSO. The `shared-auth.js` module validates tokens from sibling apps.
- **Multer memory storage** — intentional choice over disk storage. In Express 5, `req.params` may not be resolved when multer's disk storage writes the file. Memory storage lets us control the write path using `req.params.id`.
- **Public swatch view** — `/swatches` is opt-in, disabled by default. When enabled, it serves a read-only page with no login required. Pattern images and gallery images are also public so the swatch page can render them.
- **ZIP backup format** — `GET /api/export` produces a self-contained ZIP with `filaments.json` + all pattern/gallery images. Import accepts both ZIP (new) and raw JSON (legacy backward-compatible).

## Coding conventions

- **Code, comments, commits, docs:** English
- **UI text:** English (professional/work tool)
- **Tests:** run `npm test` before claiming done. All tests must pass.
- **No CSS framework** — custom CSS with variables
- **No native `confirm()`** — use custom modal dialogs

## Running locally

```bash
npm install
cp .env.example .env    # ADMIN_USER, ADMIN_PASS
npm start               # default port from .env (typically 3002)
```

Open http://localhost:3002

## Tests

```bash
npm test
```

## Deploy

Deployed via the shared infrastructure repo: `../infrastructure/apps/filament-manager/deploy.sh`

- **PM2 name:** `filament-manager`
- **Domain:** `filaments.app3.be`
- **Server:** `app3-node-01` (142.93.105.91)

## Gotchas

- **pm2 cwd caching:** pm2 caches cwd at first start. Delete + restart if you change ecosystem.config.js.
- **Upload directory auto-creation:** `public/uploads/` and `public/uploads/filaments/` are created automatically on server startup. They are git-ignored.
- **File upload size limits:** pattern images max 10 MB, gallery images max 15 MB, ZIP backups max 50 MB. Nginx `client_max_body_size` must be set to at least 55M.
- **Sessions in memory (legacy)** — the existing README mentions in-memory sessions, but newer code may use SQLite-backed sessions. Check `server.js` for the current implementation.

## What NOT to do

- Do not remove `shared-auth.js` — other Printseed apps depend on cross-app JWT validation
- Do not install CSS frameworks
- Do not use `confirm()` or `alert()`
- Do not commit `.env`, `data/`, `logs/`, or `public/uploads/`
- Do not change the production port without updating the infrastructure repo

## Shared infrastructure

Deploy scripts, nginx configs, and runbooks live in `../infrastructure/`. That repo's `apps/filament-manager/deploy.sh` is a thin wrapper around `apps/_template/deploy.sh`.

## Architecture guide

The full house-style spec: `/Users/dirkvranckaert/Documents/personal-assistant/docs/app-architecture-guide.md`
