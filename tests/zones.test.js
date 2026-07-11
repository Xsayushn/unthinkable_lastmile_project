/**
 * tests/zones.test.js
 * Integration tests for /api/zones/* routes.
 */

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-key-12345';

const TEST_DB_PATH = path.join(__dirname, 'test-db-zones.json');
process.env.DB_PATH = TEST_DB_PATH;

const app = require('../server');
const { readDb, writeDb, invalidateCache } = require('../db-helper');
const bcrypt = require('bcryptjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedAdminUser() {
  const db = readDb();
  if (!db.users.find(u => u.email === 'zoneadmin@test.com')) {
    const salt = bcrypt.genSaltSync(10);
    db.users.push({
      id: 'usr_zadmin',
      name: 'Zone Admin',
      email: 'zoneadmin@test.com',
      passwordHash: bcrypt.hashSync('adminpass123', salt),
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    writeDb(db);
    invalidateCache();
  }
}

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.headers['set-cookie'];
}

async function registerCustomer(email) {
  await request(app).post('/api/auth/register').send({
    name: 'Cust', email, password: 'cust12345', role: 'customer'
  });
  return loginAs(email, 'cust12345');
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let adminCookie, customerCookie;

beforeAll(async () => {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  } catch (err) {}
  invalidateCache();

  seedAdminUser();
  adminCookie    = await loginAs('zoneadmin@test.com', 'adminpass123');
  customerCookie = await registerCustomer('zonecust@test.com');
});

afterAll(() => {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  } catch (err) {}
});

// ── GET /api/zones ────────────────────────────────────────────────────────────

describe('GET /api/zones', () => {
  it('returns zone list when authenticated', async () => {
    const res = await request(app)
      .get('/api/zones')
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/zones');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/zones ───────────────────────────────────────────────────────────

const newZoneBody = {
  name: 'Test Zone C',
  lat: 18.6,
  lng: 73.9,
  radiusKm: 3.0,
  description: 'A test zone'
};

describe('POST /api/zones', () => {
  it('creates zone when admin is authenticated', async () => {
    const res = await request(app)
      .post('/api/zones')
      .set('Cookie', adminCookie)
      .send(newZoneBody);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Zone C');
    expect(res.body.id).toMatch(/^zone_/);
  });

  it('returns 403 when customer tries to create zone', async () => {
    const res = await request(app)
      .post('/api/zones')
      .set('Cookie', customerCookie)
      .send(newZoneBody);
    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).post('/api/zones').send(newZoneBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid latitude', async () => {
    const res = await request(app)
      .post('/api/zones')
      .set('Cookie', adminCookie)
      .send({ ...newZoneBody, lat: 200 }); // invalid
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app)
      .post('/api/zones')
      .set('Cookie', adminCookie)
      .send({ ...newZoneBody, name: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for zero radius', async () => {
    const res = await request(app)
      .post('/api/zones')
      .set('Cookie', adminCookie)
      .send({ ...newZoneBody, radiusKm: 0 });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/zones/:id ─────────────────────────────────────────────────────

describe('DELETE /api/zones/:id', () => {
  let createdZoneId;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/zones')
      .set('Cookie', adminCookie)
      .send({ name: 'Temp Zone', lat: 18.5, lng: 73.7, radiusKm: 2.0 });
    createdZoneId = res.body.id;
  });

  it('deletes zone when admin is authenticated', async () => {
    const res = await request(app)
      .delete(`/api/zones/${createdZoneId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('returns 403 when customer tries to delete zone', async () => {
    const res = await request(app)
      .delete(`/api/zones/${createdZoneId}`)
      .set('Cookie', customerCookie);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent zone ID', async () => {
    const res = await request(app)
      .delete('/api/zones/zone_doesnotexist')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
