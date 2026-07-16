const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { readDb, writeDb } = require('../db-helper');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { sanitizeString, validateEmail, validatePassword } = require('../middleware/validate');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
}
const IS_PROD = process.env.NODE_ENV === 'production';

// Helper: create and set JWT cookie + return user
function issueSession(res, user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.cookie('token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax'
  });
  // Also send token in header for API clients; NOT in body to reduce exposure
  res.setHeader('X-Auth-Token', token);
  return token;
}

// POST /api/auth/register
router.post('/register', authLimiter, (req, res) => {
  const { name, role } = req.body;

  const email = validateEmail(req.body.email);
  const password = validatePassword(req.body.password);
  const cleanName = sanitizeString(name, 100);

  if (!email) return res.status(400).json({ error: 'Invalid email address.' });
  if (!password) return res.status(400).json({ error: 'Password must be 6–128 characters.' });
  if (!cleanName) return res.status(400).json({ error: 'Name is required (max 100 characters).' });

  // Restrict self-registration as admin
  let userRole = role;
  if (userRole === 'admin') {
    return res.status(400).json({ error: 'Self-registration as admin is forbidden.' });
  }
  if (userRole !== 'customer' && userRole !== 'agent') {
    userRole = 'customer';
  }

  const db = readDb();
  if (db.users.find(u => u.email.toLowerCase() === email)) {
    return res.status(400).json({ error: 'User already exists.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  const userId = 'usr_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8);

  const newUser = {
    id: userId,
    name: cleanName,
    email,
    passwordHash,
    role: userRole,
    isVerified: userRole !== 'agent',
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);

  if (userRole === 'agent') {
    db.agents.push({
      id: 'agt_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
      userId,
      name: cleanName,
      status: 'AVAILABLE',
      currentLat: 18.5204 + (Math.random() - 0.5) * 0.05,
      currentLng: 73.8567 + (Math.random() - 0.5) * 0.05
    });
  }

  writeDb(db);

  if (userRole === 'agent') {
    res.status(201).json({
      message: 'Agent registered successfully. Pending administrator verification.',
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }
    });
  } else {
    issueSession(res, newUser);
    res.status(201).json({
      message: 'User registered successfully.',
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }
    });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email/username and password are required.' });
  }

  let emailToLook = String(email).toLowerCase().trim();
  // Username alias map
  const aliases = {
    admin: 'admin@tracker.com',
    usr_admin: 'admin@tracker.com',
    customer: 'customer@tracker.com',
    usr_cust1: 'customer@tracker.com',
    ayush: 'ayush@tracker.com',
    usr_cust2: 'ayush@tracker.com',
    agent1: 'agent1@tracker.com',
    usr_agent1: 'agent1@tracker.com',
    agent2: 'agent2@tracker.com',
    usr_agent2: 'agent2@tracker.com'
  };
  if (aliases[emailToLook]) emailToLook = aliases[emailToLook];

  const db = readDb();
  const user = db.users.find(u => u.email.toLowerCase() === emailToLook);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: 'Invalid email/username or password.' });
  }

  if (user.role === 'agent' && user.isVerified === false) {
    return res.status(403).json({ error: 'Agent account is pending admin verification.' });
  }

  issueSession(res, user);
  res.json({
    message: 'Login successful.',
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully.' });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
