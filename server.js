require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const db = require('./db');

const app = express();
app.use(express.json());

// --- Session store ---
const sessions = new Set();

function parseCookieToken(req) {
  const raw = req.headers.cookie ?? '';
  const match = raw.match(/(?:^|;\s*)fm_session=([^;]+)/);
  return match ? match[1] : null;
}

// --- Auth routes (bypass middleware) ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `fm_session=${token}; HttpOnly; Path=/`);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false });
});

app.get('/logout', (req, res) => {
  const token = parseCookieToken(req);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'fm_session=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/login');
});

// --- Public routes (no auth required) ---
app.get('/swatches', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'swatches.html'));
});

app.get('/api/public/filaments', (req, res) => {
  const enabledRow = db.prepare('SELECT value FROM settings WHERE key=?').get('publicViewEnabled');
  let enabled = false;
  try { enabled = JSON.parse(enabledRow?.value); } catch {}
  if (!enabled) return res.status(403).json({ error: 'Public view disabled' });

  const stockRow = db.prepare('SELECT value FROM settings WHERE key=?').get('publicViewInStockOnly');
  let inStockOnly = false;
  try { inStockOnly = JSON.parse(stockRow?.value); } catch {}

  const rows = inStockOnly
    ? db.prepare('SELECT * FROM filaments WHERE inStock=1').all()
    : db.prepare('SELECT * FROM filaments').all();
  res.json(rows.map(toClient));
});

// --- Session auth middleware ---
app.use((req, res, next) => {
  if (req.path === '/favicon.svg') return next();
  const token = parseCookieToken(req);
  if (token && sessions.has(token)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
});

app.use(express.static('public'));

// --- Filaments ---
app.get('/api/filaments', (req, res) => {
  const rows = db.prepare('SELECT * FROM filaments').all();
  res.json(rows.map(toClient));
});

app.post('/api/filaments', (req, res) => {
  const f = fromBody(req.body);
  const result = db.prepare(
    'INSERT INTO filaments (brand, colorName, type, variant, inStock, colorR, colorG, colorB, colorHex) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(f.brand, f.colorName, f.type, f.variant, f.inStock, f.colorR, f.colorG, f.colorB, f.colorHex);
  res.status(201).json(toClient({ id: result.lastInsertRowid, ...f }));
});

app.put('/api/filaments/:id', (req, res) => {
  const f = fromBody(req.body);
  db.prepare(
    'UPDATE filaments SET brand=?, colorName=?, type=?, variant=?, inStock=?, colorR=?, colorG=?, colorB=?, colorHex=? WHERE id=?'
  ).run(f.brand, f.colorName, f.type, f.variant, f.inStock, f.colorR, f.colorG, f.colorB, f.colorHex, req.params.id);
  res.json(toClient({ id: Number(req.params.id), ...f }));
});

app.delete('/api/filaments/:id', (req, res) => {
  db.prepare('DELETE FROM filaments WHERE id=?').run(req.params.id);
  res.status(204).end();
});

// --- Settings ---
app.get('/api/settings/:key', (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(req.params.key);
  if (!row) return res.status(404).json(null);
  let value = row.value;
  try { value = JSON.parse(value); } catch {}
  res.json({ key: req.params.key, value });
});

app.put('/api/settings/:key', (req, res) => {
  const { value } = req.body;
  const stored = JSON.stringify(value);
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(req.params.key, stored);
  res.json({ key: req.params.key, value });
});

// --- Export ---
app.get('/api/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM filaments').all();
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="filaments-export-${date}.json"`);
  res.json(rows.map(toClient));
});

// --- Import ---
app.post('/api/import', (req, res) => {
  const data = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'Expected an array' });
  db.transaction(() => {
    db.prepare('DELETE FROM filaments').run();
    for (const item of data) {
      const f = fromBody(item);
      db.prepare(
        'INSERT INTO filaments (brand, colorName, type, variant, inStock, colorR, colorG, colorB, colorHex) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(f.brand, f.colorName, f.type, f.variant, f.inStock, f.colorR, f.colorG, f.colorB, f.colorHex);
    }
  })();
  res.json({ ok: true });
});

// --- Helpers ---
function fromBody(body) {
  const colorR = body.colorR ?? body.colorRGB?.r ?? 255;
  const colorG = body.colorG ?? body.colorRGB?.g ?? 255;
  const colorB = body.colorB ?? body.colorRGB?.b ?? 255;
  const colorHex = body.colorHex ?? rgbToHex(colorR, colorG, colorB);
  return {
    brand:     (body.brand     || '').toString(),
    colorName: (body.colorName || '').toString(),
    type:      (body.type      || 'PLA').toString().toUpperCase(),
    variant:   (body.variant   || 'Basic').toString(),
    inStock:   body.inStock ? 1 : 0,
    colorR:    Number(colorR),
    colorG:    Number(colorG),
    colorB:    Number(colorB),
    colorHex,
  };
}

function toClient(row) {
  return {
    id:        row.id,
    brand:     row.brand,
    colorName: row.colorName,
    type:      row.type,
    variant:   row.variant,
    inStock:   !!row.inStock,
    colorRGB:  { r: row.colorR, g: row.colorG, b: row.colorB },
    colorHex:  row.colorHex,
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
}

app.listen(process.env.PORT || 3002, () => {
  console.log(`Filament Manager running on port ${process.env.PORT || 3002}`);
});
