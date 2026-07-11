const express = require('express');
const crypto = require('crypto');

const { readDb, writeDb } = require('../db-helper');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sanitizeString, validateLat, validateLng, validatePositiveNumber } = require('../middleware/validate');

const router = express.Router();

// All zone routes require authentication
router.use(authenticateToken);

// GET /api/zones — List all zones (authenticated)
router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.zones);
});

// POST /api/zones — Create a new zone (Admin only)
router.post('/', requireAdmin, (req, res) => {
  const { name, description } = req.body;

  const cleanName = sanitizeString(name, 100);
  const lat = validateLat(req.body.lat);
  const lng = validateLng(req.body.lng);
  const radiusKm = validatePositiveNumber(req.body.radiusKm);
  const cleanDesc = sanitizeString(description, 500) || '';

  if (!cleanName) return res.status(400).json({ error: 'Zone name is required (max 100 characters).' });
  if (lat === null) return res.status(400).json({ error: 'Latitude must be a number between -90 and 90.' });
  if (lng === null) return res.status(400).json({ error: 'Longitude must be a number between -180 and 180.' });
  if (radiusKm === null) return res.status(400).json({ error: 'Radius must be a positive number.' });

  const db = readDb();
  const newZone = {
    id: 'zone_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
    name: cleanName,
    lat,
    lng,
    radiusKm,
    description: cleanDesc
  };

  db.zones.push(newZone);
  writeDb(db);
  res.status(201).json(newZone);
});

// DELETE /api/zones/:id — Delete a zone (Admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const initialLength = db.zones.length;
  db.zones = db.zones.filter(z => z.id !== req.params.id);

  if (db.zones.length === initialLength) {
    return res.status(404).json({ error: 'Zone not found.' });
  }

  writeDb(db);
  res.json({ message: 'Zone deleted successfully.' });
});

module.exports = router;
