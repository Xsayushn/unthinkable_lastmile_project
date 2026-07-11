const express = require('express');

const { readDb, writeDb } = require('../db-helper');
const { authenticateToken } = require('../middleware/auth');
const { validateLat, validateLng } = require('../middleware/validate');

const router = express.Router();

// All agent routes require authentication
router.use(authenticateToken);

// GET /api/agents — List all agents
router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.agents);
});

// GET /api/customers — List customers (Admin only)
router.get('/customers', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Admins only.' });
  }
  const db = readDb();
  const customers = db.users
    .filter(u => u.role === 'customer')
    .map(u => ({ id: u.id, name: u.name, email: u.email }));
  res.json(customers);
});

// POST /api/agents/:id/location — Update agent GPS coordinates / duty status
router.post('/:id/location', (req, res) => {
  const { status } = req.body;
  const lat = req.body.lat != null ? validateLat(req.body.lat) : undefined;
  const lng = req.body.lng != null ? validateLng(req.body.lng) : undefined;

  if (req.body.lat != null && lat === null) {
    return res.status(400).json({ error: 'Latitude must be between -90 and 90.' });
  }
  if (req.body.lng != null && lng === null) {
    return res.status(400).json({ error: 'Longitude must be between -180 and 180.' });
  }

  const allowedStatuses = ['AVAILABLE', 'BUSY', 'OFFLINE'];
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowedStatuses.join(', ')}.` });
  }

  const db = readDb();
  const agent = db.agents.find(a => a.id === req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent profile not found.' });
  }

  // Authorization: agents can only update their own profile
  if (req.user.role === 'agent') {
    const matchedProfile = db.agents.find(a => a.userId === req.user.id);
    if (!matchedProfile || matchedProfile.id !== agent.id) {
      return res.status(403).json({ error: 'Access forbidden. You can only update your own profile.' });
    }
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden.' });
  }

  if (lat !== undefined) agent.currentLat = lat;
  if (lng !== undefined) agent.currentLng = lng;
  if (status) agent.status = status;

  writeDb(db);
  res.json({ message: 'Agent location/status updated successfully.', agent });
});

module.exports = router;
