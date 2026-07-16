/**
 * tests/rates.test.js
 * Integration tests for /api/rates/* routes.
 */

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-key-12345';

const TEST_DB_PATH = path.join(__dirname, 'test-db-rates.json');
process.env.DB_PATH = TEST_DB_PATH;

const app = require('../server');
const { readDb, writeDb, invalidateCache } = require('../db-helper');
const bcrypt = require('bcryptjs');

let adminCookie, customerCookie;
const rateCardId = 'rc_b2c_intra_test';

function seedUsersAndRates() {
  const db = readDb();
  const salt = bcrypt.genSaltSync(10);
  const passHash = bcrypt.hashSync('pass12345', salt);

  // 1. Seed admin
  db.users.push({
    id: 'usr_admin',
    name: 'Admin User',
    email: 'admin@rates.com',
    passwordHash: passHash,
    role: 'admin',
    isVerified: true,
    createdAt: new Date().toISOString()
  });

  // 2. Seed customer
  db.users.push({
    id: 'usr_cust',
    name: 'Customer User',
    email: 'cust@rates.com',
    passwordHash: passHash,
    role: 'customer',
    isVerified: true,
    createdAt: new Date().toISOString()
  });

  // 3. Seed rate cards
  db.rateCards.push({
    id: rateCardId,
    orderType: 'B2C',
    zoneType: 'INTRA',
    basePrice: 50.0,
    baseWeightKg: 2.0,
    perKgRate: 10.0,
    codSurchargeFlat: 20.0,
    codSurchargePct: 1.5,
    baseDistanceKm: 5,
    perKmRateDistance: 3
  });

  writeDb(db);
  invalidateCache();
}

async function loginAs(email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.headers['set-cookie'];
}

beforeAll(async () => {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  } catch (err) {}
  invalidateCache();

  seedUsersAndRates();

  adminCookie = await loginAs('admin@rates.com', 'pass12345');
  customerCookie = await loginAs('cust@rates.com', 'pass12345');
});

afterAll(() => {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  } catch (err) {}
});

describe('GET /api/rates', () => {
  it('returns all rate cards when authenticated', async () => {
    const res = await request(app)
      .get('/api/rates')
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(rateCardId);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/rates');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/rates/:id', () => {
  it('updates rate card successfully when admin is authenticated', async () => {
    const res = await request(app)
      .put(`/api/rates/${rateCardId}`)
      .set('Cookie', adminCookie)
      .send({
        basePrice: 60.0,
        perKgRate: 12.0,
        codSurchargePct: 2.5
      });

    expect(res.status).toBe(200);
    expect(res.body.basePrice).toBe(60.0);
    expect(res.body.perKgRate).toBe(12.0);
    expect(res.body.codSurchargePct).toBe(2.5);

    // Verify database persist
    const db = readDb();
    const rateCard = db.rateCards.find(rc => rc.id === rateCardId);
    expect(rateCard.basePrice).toBe(60.0);
    expect(rateCard.perKgRate).toBe(12.0);
  });

  it('returns 403 when non-admin attempts to update rates', async () => {
    const res = await request(app)
      .put(`/api/rates/${rateCardId}`)
      .set('Cookie', customerCookie)
      .send({ basePrice: 100.0 });

    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent rate card', async () => {
    const res = await request(app)
      .put('/api/rates/rc_nonexistent')
      .set('Cookie', adminCookie)
      .send({ basePrice: 100.0 });

    expect(res.status).toBe(404);
  });

  it('returns 400 for negative base price', async () => {
    const res = await request(app)
      .put(`/api/rates/${rateCardId}`)
      .set('Cookie', adminCookie)
      .send({ basePrice: -10.0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/basePrice/i);
  });

  it('returns 400 for negative codSurchargeFlat', async () => {
    const res = await request(app)
      .put(`/api/rates/${rateCardId}`)
      .set('Cookie', adminCookie)
      .send({ codSurchargeFlat: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/codSurchargeFlat/i);
  });

  it('returns 400 for out-of-range codSurchargePct', async () => {
    const res = await request(app)
      .put(`/api/rates/${rateCardId}`)
      .set('Cookie', adminCookie)
      .send({ codSurchargePct: 150 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/codSurchargePct/i);
  });
});
