require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const AdmZip  = require('adm-zip');
const db = require('./db');
const sharedAuth = require('./shared-auth');

const app = express();
app.use(express.json());

// --- Uploads directory ---
const uploadsDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// --- Multer: pattern image upload (memory storage — file written manually in the route handler) ---
const uploadPattern = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  }
});

// --- Multer: ZIP backup import ---
const uploadZip = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// --- Session store ---
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function parseCookieToken(req) {
  const raw = req.headers.cookie ?? '';
  const match = raw.match(/(?:^|;\s*)fm_session=([^;]+)/);
  return match ? match[1] : null;
}

function isValidSession(token) {
  const row = db.prepare('SELECT expiresAt FROM sessions WHERE token=?').get(token);
  if (!row) return false;
  if (Date.now() > row.expiresAt) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return false; }
  return true;
}

// --- Auth routes (bypass middleware) ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, expiresAt) VALUES (?,?)').run(token, Date.now() + SESSION_TTL);
    const cookies = [`fm_session=${token}; HttpOnly; Path=/; Max-Age=604800`];
    const sharedCookie = sharedAuth.createSharedCookie(username);
    if (sharedCookie) cookies.push(sharedCookie);
    res.setHeader('Set-Cookie', cookies);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false });
});

app.get('/logout', (req, res) => {
  const token = parseCookieToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  const cookies = ['fm_session=; HttpOnly; Path=/; Max-Age=0'];
  const clearShared = sharedAuth.clearSharedCookie();
  if (clearShared) cookies.push(clearShared);
  res.setHeader('Set-Cookie', cookies);
  res.redirect('/login');
});

// --- Public routes (no auth required) ---
app.get('/swatches', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'swatches.html'));
});

app.get('/api/public/settings', (req, res) => {
  const rowsRow = db.prepare('SELECT value FROM settings WHERE key=?').get('rows');
  let rows = 3; // default
  try { const v = JSON.parse(rowsRow?.value); if (Number.isInteger(v) && v >= 1) rows = v; } catch {}
  res.json({ rows });
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

// --- Serve uploaded pattern images publicly (needed for /swatches page) ---
app.use('/uploads', express.static(uploadsDir));

// --- Session auth middleware ---
app.use((req, res, next) => {
  if (['/favicon.svg', '/manifest.json', '/sw.js', '/api/config'].includes(req.path)) return next();
  const token = parseCookieToken(req);
  if (token && isValidSession(token)) return next();
  if (sharedAuth.validateSharedToken(req)) return next();
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
  res.status(201).json(toClient({ id: result.lastInsertRowid, ...f, patternImage: null }));
});

app.put('/api/filaments/:id', (req, res) => {
  const f = fromBody(req.body);
  db.prepare(
    'UPDATE filaments SET brand=?, colorName=?, type=?, variant=?, inStock=?, colorR=?, colorG=?, colorB=?, colorHex=? WHERE id=?'
  ).run(f.brand, f.colorName, f.type, f.variant, f.inStock, f.colorR, f.colorG, f.colorB, f.colorHex, req.params.id);
  const row = db.prepare('SELECT * FROM filaments WHERE id=?').get(req.params.id);
  res.json(toClient(row));
});

app.delete('/api/filaments/:id', (req, res) => {
  const row = db.prepare('SELECT patternImage FROM filaments WHERE id=?').get(req.params.id);
  if (row?.patternImage) {
    try { fs.unlinkSync(path.join(uploadsDir, row.patternImage)); } catch {}
  }
  db.prepare('DELETE FROM filaments WHERE id=?').run(req.params.id);
  res.status(204).end();
});

// --- Pattern image ---
app.post('/api/filaments/:id/pattern', uploadPattern.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const row = db.prepare('SELECT patternImage FROM filaments WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // Delete old pattern file if one exists
  if (row.patternImage) {
    try { fs.unlinkSync(path.join(uploadsDir, row.patternImage)); } catch {}
  }
  const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
  const filename = `pattern_${req.params.id}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
  db.prepare('UPDATE filaments SET patternImage=? WHERE id=?').run(filename, req.params.id);
  res.json({ patternImage: filename });
});

app.delete('/api/filaments/:id/pattern', (req, res) => {
  const row = db.prepare('SELECT patternImage FROM filaments WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.patternImage) {
    try { fs.unlinkSync(path.join(uploadsDir, row.patternImage)); } catch {}
    db.prepare('UPDATE filaments SET patternImage=NULL WHERE id=?').run(req.params.id);
  }
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

// --- Export (ZIP with filaments.json + pattern images) ---
app.get('/api/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM filaments').all();
  const zip = new AdmZip();
  zip.addFile('filaments.json', Buffer.from(JSON.stringify(rows.map(toClient), null, 2)));
  for (const row of rows) {
    if (row.patternImage) {
      const filePath = path.join(uploadsDir, row.patternImage);
      if (fs.existsSync(filePath)) zip.addLocalFile(filePath, 'uploads');
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="filaments-backup-${date}.zip"`);
  res.setHeader('Content-Type', 'application/zip');
  res.send(zip.toBuffer());
});

// --- Import (ZIP with images, or legacy JSON body) ---
app.post('/api/import', uploadZip.single('backup'), (req, res) => {
  let data;
  if (req.file) {
    // ZIP import
    let zip;
    try { zip = new AdmZip(req.file.buffer); } catch { return res.status(400).json({ error: 'Invalid ZIP file' }); }
    const jsonEntry = zip.getEntry('filaments.json');
    if (!jsonEntry) return res.status(400).json({ error: 'Missing filaments.json in ZIP' });
    try { data = JSON.parse(jsonEntry.getData().toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid filaments.json' }); }
    if (!Array.isArray(data)) return res.status(400).json({ error: 'Invalid filaments.json' });
    // Extract images
    for (const entry of zip.getEntries()) {
      if (entry.entryName.startsWith('uploads/') && !entry.isDirectory) {
        const filename = path.basename(entry.entryName);
        fs.writeFileSync(path.join(uploadsDir, filename), entry.getData());
      }
    }
  } else {
    // Legacy JSON body
    data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: 'Expected an array' });
  }
  db.transaction(() => {
    // Delete existing pattern files before clearing DB
    const existing = db.prepare('SELECT patternImage FROM filaments').all();
    for (const row of existing) {
      if (row.patternImage) try { fs.unlinkSync(path.join(uploadsDir, row.patternImage)); } catch {}
    }
    db.prepare('DELETE FROM filaments').run();
    for (const item of data) {
      const f = fromBody(item);
      const patternImage = item.patternImage || null;
      db.prepare(
        'INSERT INTO filaments (brand, colorName, type, variant, inStock, colorR, colorG, colorB, colorHex, patternImage) VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).run(f.brand, f.colorName, f.type, f.variant, f.inStock, f.colorR, f.colorG, f.colorB, f.colorHex, patternImage);
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
    id:           row.id,
    brand:        row.brand,
    colorName:    row.colorName,
    type:         row.type,
    variant:      row.variant,
    inStock:      !!row.inStock,
    colorRGB:     { r: row.colorR, g: row.colorG, b: row.colorB },
    colorHex:     row.colorHex,
    patternImage: row.patternImage || null,
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
}

// --- Config & discovery ---
app.get('/api/config', (_req, res) => {
  res.json({
    version: require('./package.json').version,
    appName: 'Filament Manager',
    appId: 'filament-manager',
    sharedAuth: sharedAuth.isEnabled(),
  });
});

app.get('/api/discover', async (_req, res) => {
  const apps = {};
  const plannerUrl = process.env.PLANNER_URL || '';
  const calcUrl = process.env.CALCULATOR_URL || '';
  if (plannerUrl) apps.planner = await sharedAuth.discoverApp(plannerUrl);
  if (calcUrl) apps.calculator = await sharedAuth.discoverApp(calcUrl);
  res.json({ sharedAuth: sharedAuth.isEnabled(), apps });
});

app.listen(process.env.PORT || 3002, () => {
  console.log(`Filament Manager running on port ${process.env.PORT || 3002}`);
});
