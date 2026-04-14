'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use test database (separate from production)
const os = require('os');
const testDbPath = path.join(os.tmpdir(), 'filament-manager-test.db');
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'testadmin';
process.env.ADMIN_PASS = 'testpass';
process.env.DB_PATH = testDbPath;
// Disable shared SSO for tests so login doesn't try to sign cross-app JWTs.
// dotenv.config() (called inside server.js) does not override existing env vars,
// so setting these to empty strings keeps them disabled regardless of .env.
process.env.SHARED_AUTH_SECRET = '';
process.env.SHARED_AUTH_DOMAIN = '';

// Ensure test data directory exists
const dataDir = path.dirname(testDbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Clean up any stale test DB BEFORE requiring the server, so the db module
// binds to a fresh file (not a unlinked-but-still-open handle — that leaves
// SQLite in a "readonly" state once WAL sidecars are gone).
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const { app } = require('../server');

let cookie;

// 1x1 transparent PNG
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64'
);

/* ================================================================== */
/*  Auth                                                               */
/* ================================================================== */
describe('Authentication', () => {
  test('GET /api/whoami returns loggedIn:false when unauthenticated', async () => {
    const res = await request(app).get('/api/whoami');
    expect(res.status).toBe(200);
    expect(res.body.loggedIn).toBe(false);
  });

  test('POST /login with wrong creds returns 401', async () => {
    const res = await request(app).post('/login')
      .send({ username: 'wrong', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('POST /login with correct creds returns 200 + cookie', async () => {
    const res = await request(app).post('/login')
      .send({ username: 'testadmin', password: 'testpass' });
    if (res.status !== 200) console.log('LOGIN FAIL', res.status, res.text);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    cookie = setCookie[0].split(';')[0];
  });

  test('GET /api/whoami returns loggedIn:true when authed', async () => {
    const res = await request(app).get('/api/whoami').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.loggedIn).toBe(true);
  });

  test('GET /api/filaments without auth returns 401', async () => {
    const res = await request(app).get('/api/filaments');
    expect(res.status).toBe(401);
  });
});

/* ================================================================== */
/*  Filaments API                                                      */
/* ================================================================== */
describe('Filaments API', () => {
  let filamentId;

  test('GET /api/filaments returns empty list initially', async () => {
    const res = await request(app).get('/api/filaments').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('POST /api/filaments creates filament', async () => {
    const res = await request(app).post('/api/filaments').set('Cookie', cookie)
      .send({
        brand: 'Bambu',
        colorName: 'Galaxy Black',
        type: 'PLA',
        variant: 'Basic',
        inStock: true,
        colorR: 10, colorG: 10, colorB: 10,
      });
    expect(res.status).toBe(201);
    expect(res.body.brand).toBe('Bambu');
    expect(res.body.colorName).toBe('Galaxy Black');
    expect(res.body.type).toBe('PLA');
    expect(res.body.inStock).toBe(true);
    expect(res.body.colorHex).toBe('#0a0a0a');
    filamentId = res.body.id;
  });

  test('GET /api/filaments returns the inserted filament', async () => {
    const res = await request(app).get('/api/filaments').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(filamentId);
  });

  test('PUT /api/filaments/:id updates filament', async () => {
    const res = await request(app).put(`/api/filaments/${filamentId}`).set('Cookie', cookie)
      .send({
        brand: 'Bambu', colorName: 'Galaxy Black', type: 'PETG', variant: 'HF',
        inStock: false, colorR: 20, colorG: 20, colorB: 20,
      });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('PETG');
    expect(res.body.variant).toBe('HF');
    expect(res.body.inStock).toBe(false);
  });

  test('DELETE /api/filaments/:id removes filament', async () => {
    const res = await request(app).delete(`/api/filaments/${filamentId}`).set('Cookie', cookie);
    expect(res.status).toBe(204);
    const check = await request(app).get('/api/filaments').set('Cookie', cookie);
    expect(check.body.find(f => f.id === filamentId)).toBeUndefined();
  });
});

/* ================================================================== */
/*  Gallery upload                                                     */
/* ================================================================== */
describe('Gallery upload', () => {
  let filamentId;

  beforeAll(async () => {
    const res = await request(app).post('/api/filaments').set('Cookie', cookie)
      .send({ brand: 'Polymaker', colorName: 'Sunset', type: 'PLA', variant: 'Basic', inStock: true });
    filamentId = res.body.id;
  });

  test('POST /api/filaments/:id/images with no file returns 400', async () => {
    const res = await request(app).post(`/api/filaments/${filamentId}/images`).set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no files/i);
  });

  test('POST /api/filaments/:id/images rejects non-image content type', async () => {
    // multer fileFilter rejects non-image mimetypes — surface as 500 from express
    // (the route never gets called). Either way, no file is persisted.
    const res = await request(app).post(`/api/filaments/${filamentId}/images`)
      .set('Cookie', cookie)
      .attach('images', Buffer.from('not an image'), { filename: 'notes.txt', contentType: 'text/plain' });
    // multer error → 500 (default express error handler) or 400; accept either, just not 201.
    expect(res.status).not.toBe(201);
  });

  test('POST /api/filaments/:id/images uploads a small PNG', async () => {
    const res = await request(app).post(`/api/filaments/${filamentId}/images`)
      .set('Cookie', cookie)
      .attach('images', tinyPng, { filename: 'tiny.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].filamentId).toBe(filamentId);
    expect(res.body[0].url).toContain(`/uploads/filaments/${filamentId}/`);
  });

  test('GET /api/filaments/:id/images lists uploaded image', async () => {
    const res = await request(app).get(`/api/filaments/${filamentId}/images`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/filaments/:id/images accepts HEIC-as-jpg upload (client converts to JPEG before upload)', async () => {
    // Mirrors real client flow: filament-manager UI converts HEIC → JPEG client-side
    // (heic2any), then uploads as image/jpeg. Server should accept with .jpg ext.
    const res = await request(app).post(`/api/filaments/${filamentId}/images`)
      .set('Cookie', cookie)
      .attach('images', tinyPng, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body[0].filename).toMatch(/\.jpe?g$/);
  });
});

/* ================================================================== */
/*  Settings API                                                       */
/* ================================================================== */
describe('Settings API', () => {
  test('PUT /api/settings/:key stores a value', async () => {
    const res = await request(app).put('/api/settings/rows').set('Cookie', cookie)
      .send({ value: 4 });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(4);
  });

  test('GET /api/settings/:key reads it back', async () => {
    const res = await request(app).get('/api/settings/rows').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(4);
  });
});

// Clean up
afterAll(() => {
  const { db } = require('../server');
  try { db.close(); } catch {}
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  // Clean up any test gallery dirs
  const galleryRoot = path.join(__dirname, '..', 'public', 'uploads', 'filaments');
  if (fs.existsSync(galleryRoot)) {
    for (const d of fs.readdirSync(galleryRoot)) {
      const p = path.join(galleryRoot, d);
      try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
    }
  }
});
