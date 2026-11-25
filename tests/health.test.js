'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testDbPath = path.join(os.tmpdir(), `filament-manager-health-${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'testadmin';
process.env.ADMIN_PASS = 'testpass';
process.env.DB_PATH = testDbPath;
process.env.SHARED_AUTH_SECRET = '';
process.env.SHARED_AUTH_DOMAIN = '';

const { app, db } = require('../server');

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(testDbPath + suffix, { force: true });
});

describe('GET /health (DB probe)', () => {
  test('200 {ok:true} when the DB works, with no cookie', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('503 {ok:false,error:"db"} when DB access throws, without leaking details', async () => {
    jest.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('boom /secret/path/filaments.db NODE_MODULE_VERSION 115');
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'db' });
    expect(res.text).not.toMatch(/boom|secret|NODE_MODULE_VERSION|\.db/);
  });

  test('does not redirect to /login and other write routes still require auth', async () => {
    const health = await request(app).get('/health');
    expect(health.status).not.toBe(302);
    const other = await request(app).post('/api/filaments').send({});
    expect(other.status).toBe(401);
  });
});
