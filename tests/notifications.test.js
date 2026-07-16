/**
 * tests/notifications.test.js
 * Integration tests for /api/notifications/* routes.
 */

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-key-12345';

const TEST_DB_PATH = path.join(__dirname, 'test-db-notifications.json');
process.env.DB_PATH = TEST_DB_PATH;

const app = require('../server');
const { readDb, writeDb, invalidateCache } = require('../db-helper');
const bcrypt = require('bcryptjs');

let adminCookie, customer1Cookie, customer2Cookie, agentCookie;

function seedUsersAndNotifications() {
  const db = readDb();
  const salt = bcrypt.genSaltSync(10);
  const passHash = bcrypt.hashSync('pass12345', salt);

  // 1. Seed admin
  db.users.push({
    id: 'usr_admin',
    name: 'Admin User',
    email: 'admin@notifications.com',
    passwordHash: passHash,
    role: 'admin',
    isVerified: true,
    createdAt: new Date().toISOString()
  });

  // 2. Seed customer 1
  db.users.push({
    id: 'usr_cust1',
    name: 'Customer One',
    email: 'cust1@notifications.com',
    passwordHash: passHash,
    role: 'customer',
    isVerified: true,
    createdAt: new Date().toISOString()
  });

  // 3. Seed customer 2
  db.users.push({
    id: 'usr_cust2',
    name: 'Customer Two',
    email: 'cust2@notifications.com',
    passwordHash: passHash,
    role: 'customer',
    isVerified: true,
    createdAt: new Date().toISOString()
  });

  // 4. Seed agent
  db.users.push({
    id: 'usr_agt',
    name: 'Agent User',
    email: 'agent@notifications.com',
    passwordHash: passHash,
    role: 'agent',
    isVerified: true,
    createdAt: new Date().toISOString()
  });
  db.agents.push({
    id: 'agt_id_1',
    userId: 'usr_agt',
    name: 'Agent User',
    status: 'BUSY',
    currentLat: 18.5,
    currentLng: 73.8
  });

  // 5. Seed orders
  db.orders.push(
    {
      id: 'ord_c1',
      customerId: 'usr_cust1',
      agentId: 'agt_id_1',
      status: 'Assigned',
      totalCharge: 100
    },
    {
      id: 'ord_c2',
      customerId: 'usr_cust2',
      agentId: null,
      status: 'Placed',
      totalCharge: 150
    }
  );

  // 6. Seed notifications
  db.notificationLogs.push(
    {
      id: 'ntf_1',
      orderId: 'ord_c1',
      customerId: 'usr_cust1',
      type: 'EMAIL',
      message: 'Order c1 is assigned.',
      recipient: 'cust1@notifications.com',
      timestamp: new Date().toISOString()
    },
    {
      id: 'ntf_2',
      orderId: 'ord_c2',
      customerId: 'usr_cust2',
      type: 'EMAIL',
      message: 'Order c2 is placed.',
      recipient: 'cust2@notifications.com',
      timestamp: new Date().toISOString()
    }
  );

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

  seedUsersAndNotifications();

  adminCookie = await loginAs('admin@notifications.com', 'pass12345');
  customer1Cookie = await loginAs('cust1@notifications.com', 'pass12345');
  customer2Cookie = await loginAs('cust2@notifications.com', 'pass12345');
  agentCookie = await loginAs('agent@notifications.com', 'pass12345');
});

afterAll(() => {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  } catch (err) {}
});

describe('GET /api/notifications', () => {
  it('returns only customer 1 notifications for customer 1', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', customer1Cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].orderId).toBe('ord_c1');
  });

  it('returns only customer 2 notifications for customer 2', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', customer2Cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].orderId).toBe('ord_c2');
  });

  it('returns notifications for orders assigned to agent', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', agentCookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].orderId).toBe('ord_c1');
  });

  it('returns empty array for agent without profile or assigned orders', async () => {
    const db = readDb();
    const originalAgents = [...db.agents];
    db.agents = [];
    writeDb(db);
    invalidateCache();

    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', agentCookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);

    const dbRestore = readDb();
    dbRestore.agents = originalAgents;
    writeDb(dbRestore);
    invalidateCache();
  });

  it('returns all notifications for admin', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});
