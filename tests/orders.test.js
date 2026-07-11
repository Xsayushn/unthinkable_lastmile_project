/**
 * tests/orders.test.js
 * Integration tests for /api/orders/* routes.
 */

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-key-12345';

const TEST_DB_PATH = path.join(__dirname, 'test-db-orders.json');
process.env.DB_PATH = TEST_DB_PATH;

const app = require('../server');
const { invalidateCache, readDb, writeDb } = require('../db-helper');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function registerAndLogin(email, password, role, name) {
  await request(app).post('/api/auth/register').send({ name, email, password, role });
  const loginRes = await request(app).post('/api/auth/login').send({ email, password });
  return loginRes.headers['set-cookie'];
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let customerCookie;

const validEstimateBody = {
  pickupLat: 18.5200, pickupLng: 73.8560,
  dropLat:   18.5250, dropLng:   73.8510,
  length: 10, width: 10, height: 10,
  actualWeight: 1.5, orderType: 'B2C', paymentType: 'Prepaid'
};

// Seed zones and rate cards needed for pricing engine
function seedOrdersDb() {
  const db = readDb();
  if (db.zones.length === 0) {
    db.zones = [
      { id: 'zone_a', name: 'Pune Central', lat: 18.5204, lng: 73.8567, radiusKm: 5.0 },
      { id: 'zone_b', name: 'Hinjawadi',    lat: 18.5913, lng: 73.7389, radiusKm: 4.0 }
    ];
  }
  if (db.rateCards.length === 0) {
    db.rateCards = [
      { id: 'rc_b2c_intra', orderType: 'B2C', zoneType: 'INTRA', basePrice: 50.0,  baseWeightKg: 2.0, perKgRate: 10.0, codSurchargeFlat: 20.0, codSurchargePct: 1.5 },
      { id: 'rc_b2c_inter', orderType: 'B2C', zoneType: 'INTER', basePrice: 120.0, baseWeightKg: 2.0, perKgRate: 20.0, codSurchargeFlat: 40.0, codSurchargePct: 3.0 },
      { id: 'rc_b2b_intra', orderType: 'B2B', zoneType: 'INTRA', basePrice: 100.0, baseWeightKg: 5.0, perKgRate: 15.0, codSurchargeFlat: 50.0, codSurchargePct: 1.0 },
      { id: 'rc_b2b_inter', orderType: 'B2B', zoneType: 'INTER', basePrice: 250.0, baseWeightKg: 5.0, perKgRate: 25.0, codSurchargeFlat: 100.0, codSurchargePct: 2.0 }
    ];
  }
  writeDb(db);
  invalidateCache();
}

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  invalidateCache();
  seedOrdersDb();
  customerCookie = await registerAndLogin('cust@orders.com', 'pass12345', 'customer', 'Order Customer');
});

afterAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

// ── POST /api/orders/estimate ─────────────────────────────────────────────────

describe('POST /api/orders/estimate', () => {
  it('returns pricing estimate for valid inputs', async () => {
    const res = await request(app)
      .post('/api/orders/estimate')
      .send(validEstimateBody);

    expect(res.status).toBe(200);
    expect(res.body.totalCharge).toBeGreaterThan(0);
    expect(res.body.zoneType).toBeDefined();
    expect(res.body.volumetricWeight).toBeDefined();
  });

  it('returns 400 for invalid coordinates', async () => {
    const res = await request(app)
      .post('/api/orders/estimate')
      .send({ ...validEstimateBody, pickupLat: 999 }); // invalid lat
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing dimensions', async () => {
    const res = await request(app)
      .post('/api/orders/estimate')
      .send({ ...validEstimateBody, length: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid orderType', async () => {
    const res = await request(app)
      .post('/api/orders/estimate')
      .send({ ...validEstimateBody, orderType: 'INVALID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/orderType/i);
  });

  it('returns 400 for invalid paymentType', async () => {
    const res = await request(app)
      .post('/api/orders/estimate')
      .send({ ...validEstimateBody, paymentType: 'CASH' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for zero weight', async () => {
    const res = await request(app)
      .post('/api/orders/estimate')
      .send({ ...validEstimateBody, actualWeight: 0 });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/orders ──────────────────────────────────────────────────────────

describe('POST /api/orders', () => {
  const orderBody = {
    ...validEstimateBody,
    pickupAddress: 'Shaniwar Wada, Pune',
    dropAddress:   'Camp Area, Pune'
  };

  it('creates order when logged in as customer', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', customerCookie)
      .send(orderBody);

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^ord_/);
    expect(res.body.status).toBe('Placed');
    expect(res.body.totalCharge).toBeGreaterThan(0);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send(orderBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing pickup address', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', customerCookie)
      .send({ ...orderBody, pickupAddress: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative dimensions', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', customerCookie)
      .send({ ...orderBody, length: -5 });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/orders ───────────────────────────────────────────────────────────

describe('GET /api/orders', () => {
  it('returns array of orders for authenticated customer', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
  });

  it('returns only the customer\'s own orders', async () => {
    // Create an order as cust
    await request(app)
      .post('/api/orders')
      .set('Cookie', customerCookie)
      .send({
        ...validEstimateBody,
        pickupAddress: 'Pickup A', dropAddress: 'Drop A'
      });

    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    // All returned orders must belong to this customer
    if (Array.isArray(res.body)) {
      res.body.forEach(o => {
        expect(o.customerEmail).toBe('cust@orders.com');
      });
    }
  });
});

// ── GET /api/orders/:id/history ───────────────────────────────────────────────

describe('GET /api/orders/:id/history', () => {
  it('returns order history for a valid order', async () => {
    // First create an order
    const createRes = await request(app)
      .post('/api/orders')
      .set('Cookie', customerCookie)
      .send({
        ...validEstimateBody,
        pickupAddress: 'Test Pickup', dropAddress: 'Test Drop'
      });

    const orderId = createRes.body.id;
    const res = await request(app)
      .get(`/api/orders/${orderId}/history`)
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(res.body.order).toBeDefined();
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent order ID', async () => {
    const res = await request(app)
      .get('/api/orders/ord_nonexistent/history')
      .set('Cookie', customerCookie);
    expect(res.status).toBe(404);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/orders/ord_anything/history');
    expect(res.status).toBe(401);
  });
});
