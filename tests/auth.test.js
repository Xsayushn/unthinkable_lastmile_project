/**
 * tests/auth.test.js
 * Integration tests for /api/auth/* routes using supertest.
 */

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');

// Set test environment before requiring the app
process.env.NODE_ENV  = 'test';
process.env.JWT_SECRET = 'test-secret-key-12345';

// Use a separate DB file for testing
const TEST_DB_PATH = path.join(__dirname, 'test-db.json');
process.env.DB_PATH = TEST_DB_PATH;

const app = require('../server');
const { readDb, writeDb, invalidateCache } = require('../db-helper');
const bcrypt = require('bcryptjs');

function seedAdminAndCustomer() {
  const db = readDb();
  const salt = bcrypt.genSaltSync(10);
  
  // Seed admin if not present
  if (!db.users.find(u => u.email === 'admin@tracker.com')) {
    db.users.push({
      id: 'usr_admin',
      name: 'System Admin',
      email: 'admin@tracker.com',
      passwordHash: bcrypt.hashSync('admin123', salt),
      role: 'admin',
      isVerified: true,
      createdAt: new Date().toISOString()
    });
  }

  // Seed customer if not present
  if (!db.users.find(u => u.email === 'customer@tracker.com')) {
    db.users.push({
      id: 'usr_cust1',
      name: 'Tata Logistics (B2B)',
      email: 'customer@tracker.com',
      passwordHash: bcrypt.hashSync('customer123', salt),
      role: 'customer',
      isVerified: true,
      createdAt: new Date().toISOString()
    });
  }

  writeDb(db);
  invalidateCache();
}

beforeEach(() => {
  // Reset the test database before each test
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  } catch (err) {}
  invalidateCache();
});

afterAll(() => {
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  } catch (err) {}
});

// ── POST /api/auth/register ───────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('registers a new customer successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test User', email: 'test@example.com', password: 'pass123', role: 'customer' });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body.user.role).toBe('customer');
    // Raw token should NOT be in body (only in httpOnly cookie)
    expect(res.body.token).toBeUndefined();
    // Cookie should be set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('token='))).toBe(true);
  });

  it('returns 400 for invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'not-an-email', password: 'pass123', role: 'customer' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('returns 400 for short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'test2@example.com', password: '123', role: 'customer' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('returns 400 for empty name', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: '', email: 'test3@example.com', password: 'pass123', role: 'customer' });
    expect(res.status).toBe(400);
  });

  it('blocks self-registration as admin', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Hacker', email: 'hacker@example.com', password: 'pass123', role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('returns 400 for duplicate email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'User1', email: 'dup@example.com', password: 'pass123', role: 'customer' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User2', email: 'dup@example.com', password: 'pass123', role: 'customer' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    // Register a test user first
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Login User', email: 'login@example.com', password: 'mypass123', role: 'customer' });
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'mypass123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('login@example.com');
    // httpOnly cookie should be set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('token='))).toBe(true);
  });

  it('returns 400 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrongpass' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'pass123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  let cookie;

  beforeEach(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Me User', email: 'me@example.com', password: 'mypass123', role: 'customer' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'me@example.com', password: 'mypass123' });

    cookie = loginRes.headers['set-cookie'];
  });

  it('returns user when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@example.com');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 403 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(403);
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('clears the auth cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });
});

// ── Agent Registration & Admin Verification Flow ──────────────────────────────

describe('Agent Registration & Admin Verification Flow', () => {
  beforeEach(() => {
    seedAdminAndCustomer();
  });

  it('registers a new agent with pending verification state', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New Agent', email: 'newagent@example.com', password: 'password123', role: 'agent' });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe('agent');
    expect(res.body.message).toMatch(/pending/i);
    // Raw token should NOT be set as cookie because login is not allowed yet
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      expect(cookies.some(c => c.startsWith('token='))).toBe(false);
    }
  });

  it('blocks login for unverified agents and allows for verified ones', async () => {
    // 1. Register agent
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New Agent 2', email: 'newagent2@example.com', password: 'password123', role: 'agent' });
    expect(regRes.status).toBe(201);

    // 2. Try to log in — should be blocked (403)
    const blockRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newagent2@example.com', password: 'password123' });
    expect(blockRes.status).toBe(403);
    expect(blockRes.body.error).toMatch(/pending admin verification/i);

    // 3. Log in as admin to get admin cookie
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@tracker.com', password: 'admin123' });
    expect(adminLoginRes.status).toBe(200);
    const adminCookie = adminLoginRes.headers['set-cookie'];

    // 4. Find the agent's agent ID from the list
    const agentsRes = await request(app)
      .get('/api/agents')
      .set('Cookie', adminCookie);
    expect(agentsRes.status).toBe(200);
    const registeredAgentObj = agentsRes.body.find(a => a.name === 'New Agent 2');
    expect(registeredAgentObj).toBeDefined();
    expect(registeredAgentObj.isVerified).toBe(false);

    // 5. Verify the agent via Admin endpoint
    const verifyRes = await request(app)
      .post(`/api/agents/${registeredAgentObj.id}/verify`)
      .set('Cookie', adminCookie);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.message).toMatch(/verified successfully/i);

    // 6. Try to log in again — should succeed (200)
    const allowRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newagent2@example.com', password: 'password123' });
    expect(allowRes.status).toBe(200);
    expect(allowRes.body.user).toBeDefined();
    expect(allowRes.body.user.role).toBe('agent');
  });

  it('rejects verification if requester is not admin', async () => {
    // Register agent
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New Agent 3', email: 'newagent3@example.com', password: 'password123', role: 'agent' });
    expect(regRes.status).toBe(201);

    // Login as Customer
    const custLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'customer@tracker.com', password: 'customer123' });
    expect(custLoginRes.status).toBe(200);
    const custCookie = custLoginRes.headers['set-cookie'];

    // Attempt to verify agent as customer
    const verifyRes = await request(app)
      .post('/api/agents/agt_dummy/verify')
      .set('Cookie', custCookie);
    expect(verifyRes.status).toBe(403);
    expect(verifyRes.body.error).toMatch(/admins only/i);
  });
});
