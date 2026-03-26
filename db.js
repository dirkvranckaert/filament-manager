const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'filaments.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS filaments (
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

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token     TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL
  );
`);

// Migrations
try { db.exec('ALTER TABLE filaments ADD COLUMN patternImage TEXT'); } catch {}

module.exports = db;
