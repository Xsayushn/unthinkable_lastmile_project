/**
 * tests/agents.test.js
 * Integration tests for /api/agents/* routes.
 */

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-key-12345';

const TEST_DB_PATH = path.join(__dirname, 'test-db-agents.json');
process.env.DB_PATH = TEST_DB_PATH;

const app = require('../server');
const { readDb, writeDb, invalidateCache } = require('../db-helper');
const bcrypt = require('bcryptjs');

let adminCookie, customerCookie, agentCookie;
let testAgentId, testAgentUserId, unverifiedAgentId;

function seedUsersAndAgents() {
  const db = readDb();
  const salt = bcrypt.genSaltSync(10);
  const passHash = bcrypt.hashSync('pass12345', salt);

  // 1. Seed admin
  db.users.push({
    id: 'usr_admin',
    name: 'Admin User',
    email: 'admin@agents.com',
    passwordHash: passHash,
    role: 'admin',
    isVerified: true,
    createdAt: new Date().toISOString()
  });

  // 2. Seed customer
  db.users.push({
    id: 'usr_cust',
    name: 'Customer User',
    email: 'cust@agents.com',
    passwordHash: passHash,
    role: 'customer',
    isVerified: true,
    createdAt: new Date().toISOString()
  });

  // 3. Seed verified agent
  testAgentUserId = 'usr_agent';
  testAgentId = 'agt_verified';
  db.users.push({
    id: testAgentUserId,
    name: 'Verified Agent',
    email: 'agent@agents.com',
    passwordHash: passHash,
    role: 'agent',
    isVerified: true,
    createdAt: new Date().toISOString()
  });
  db.agents.push({
    id: testAgentId,
    userId: testAgentUserId,
    name: 'Verified Agent',
    status: 'AVAILABLE',
    currentLat: 18.5204,
    currentLng: 73.8567
  });

  // 4. Seed unverified agent
  const unverifiedUserId = 'usr_agent_unverified';
  unverifiedAgentId = 'agt_unverified';
  db.users.push({
    id: unverifiedUserId,
    name: 'Unverified Agent',
    email: 'unverified@agents.com',
    passwordHash: passHash,
    role: 'agent',
    isVerified: false,
    createdAt: new Date().toISOString()
  });
  db.agents.push({
    id: unverifiedAgentId,
    userId: unverifiedUserId,
    name: 'Unverified Agent',
    status: 'AVAILABLE',
    currentLat: 18.5204,
    currentLng: 73.8567
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

  seedUsersAndAgents();

  adminCookie = await loginAs('admin@agents.com', 'pass12345');
  customerCookie = await loginAs('cust@agents.com', 'pass12345');
  agentCookie = await loginAs('agent@agents.com', 'pass12345');
});

afterAll(() => {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  } catch (err) {}
});

describe('GET /api/agents', () => {
  it('returns all agents (including unverified) for admin', async () => {
    const res = await request(app)
      .get('/api/agents')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    const unverified = res.body.find(a => a.id === unverifiedAgentId);
    expect(unverified).toBeDefined();
    expect(unverified.isVerified).toBe(false);
  });

  it('returns only verified agents for customer', async () => {
    const res = await request(app)
      .get('/api/agents')
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(testAgentId);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/agents/:id/verify', () => {
  it('verifies agent successfully when logged in as admin', async () => {
    const res = await request(app)
      .post(`/api/agents/${unverifiedAgentId}/verify`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified successfully/i);

    // Verify change is persisted in database
    const db = readDb();
    const user = db.users.find(u => u.id === 'usr_agent_unverified');
    expect(user.isVerified).toBe(true);
  });

  it('returns 403 when customer attempts to verify agent', async () => {
    const res = await request(app)
      .post(`/api/agents/${unverifiedAgentId}/verify`)
      .set('Cookie', customerCookie);

    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent agent ID', async () => {
    const res = await request(app)
      .post('/api/agents/agt_nonexistent/verify')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/customers', () => {
  it('returns customer list for admin', async () => {
    const res = await request(app)
      .get('/api/agents/customers')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(c => c.id === 'usr_cust')).toBe(true);
  });

  it('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/agents/customers')
      .set('Cookie', customerCookie);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/agents/:id/location', () => {
  it('allows agent to update their own location and status', async () => {
    const res = await request(app)
      .post(`/api/agents/${testAgentId}/location`)
      .set('Cookie', agentCookie)
      .send({ lat: 18.6, lng: 73.9, status: 'BUSY' });

    expect(res.status).toBe(200);
    expect(res.body.agent.id).toBe(testAgentId);

    const db = readDb();
    const updatedAgent = db.agents.find(a => a.id === testAgentId);
    expect(updatedAgent.currentLat).toBe(18.6);
    expect(updatedAgent.currentLng).toBe(73.9);
    expect(updatedAgent.status).toBe('BUSY');
  });

  it('blocks agent from updating another agent profile', async () => {
    const res = await request(app)
      .post(`/api/agents/${unverifiedAgentId}/location`)
      .set('Cookie', agentCookie)
      .send({ lat: 18.6, lng: 73.9, status: 'BUSY' });

    expect(res.status).toBe(403);
  });

  it('allows admin to update any agent location and status', async () => {
    const res = await request(app)
      .post(`/api/agents/${testAgentId}/location`)
      .set('Cookie', adminCookie)
      .send({ lat: 18.7, lng: 74.0, status: 'AVAILABLE' });

    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid coordinates', async () => {
    const res = await request(app)
      .post(`/api/agents/${testAgentId}/location`)
      .set('Cookie', agentCookie)
      .send({ lat: 100.0, lng: 73.9 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/latitude/i);
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app)
      .post(`/api/agents/${testAgentId}/location`)
      .set('Cookie', agentCookie)
      .send({ status: 'INVALID_STATUS' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/i);
  });
});
