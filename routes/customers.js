const express = require('express');
const { readDb } = require('../db-helper');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers — List all customers (Admin only)
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const db = readDb();
  const customers = db.users
    .filter(u => u.role === 'customer')
    .map(u => ({ id: u.id, name: u.name, email: u.email }));
  res.json(customers);
});

module.exports = router;
