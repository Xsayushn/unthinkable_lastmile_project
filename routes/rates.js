const express = require('express');

const { readDb, writeDb } = require('../db-helper');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validatePositiveNumber } = require('../middleware/validate');

const router = express.Router();

// GET /api/rates — List all rate cards (authenticated)
router.get('/', authenticateToken, (req, res) => {
  const db = readDb();
  res.json(db.rateCards);
});

// PUT /api/rates/:id — Edit rate card values (Admin only)
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { basePrice, baseWeightKg, perKgRate, codSurchargeFlat, codSurchargePct, baseDistanceKm, perKmRateDistance } = req.body;

  const db = readDb();
  const rateCard = db.rateCards.find(rc => rc.id === req.params.id);
  if (!rateCard) {
    return res.status(404).json({ error: 'Rate card not found.' });
  }

  // Validate and apply each field individually
  if (basePrice != null) {
    const v = validatePositiveNumber(basePrice);
    if (v === null) return res.status(400).json({ error: 'basePrice must be a positive number.' });
    rateCard.basePrice = v;
  }
  if (baseWeightKg != null) {
    const v = validatePositiveNumber(baseWeightKg);
    if (v === null) return res.status(400).json({ error: 'baseWeightKg must be a positive number.' });
    rateCard.baseWeightKg = v;
  }
  if (perKgRate != null) {
    const v = validatePositiveNumber(perKgRate);
    if (v === null) return res.status(400).json({ error: 'perKgRate must be a positive number.' });
    rateCard.perKgRate = v;
  }
  if (codSurchargeFlat != null) {
    const v = parseFloat(codSurchargeFlat);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'codSurchargeFlat must be a non-negative number.' });
    rateCard.codSurchargeFlat = v;
  }
  if (codSurchargePct != null) {
    const v = parseFloat(codSurchargePct);
    if (isNaN(v) || v < 0 || v > 100) return res.status(400).json({ error: 'codSurchargePct must be between 0 and 100.' });
    rateCard.codSurchargePct = v;
  }
  if (baseDistanceKm != null) {
    const v = validatePositiveNumber(baseDistanceKm);
    if (v === null) return res.status(400).json({ error: 'baseDistanceKm must be a positive number.' });
    rateCard.baseDistanceKm = v;
  }
  if (perKmRateDistance != null) {
    const v = validatePositiveNumber(perKmRateDistance);
    if (v === null) return res.status(400).json({ error: 'perKmRateDistance must be a positive number.' });
    rateCard.perKmRateDistance = v;
  }

  writeDb(db);
  res.json(rateCard);
});

module.exports = router;
