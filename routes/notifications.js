const express = require('express');

const { readDb } = require('../db-helper');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — Fetch notification logs (authenticated, role-filtered)
router.get('/', authenticateToken, (req, res) => {
  const db = readDb();
  let logs = db.notificationLogs;

  // Customers see only their own notifications
  if (req.user.role === 'customer') {
    logs = logs.filter(l => l.customerId === req.user.id);
  }

  // Agents see only notifications for their assigned orders
  if (req.user.role === 'agent') {
    const agentProfile = db.agents.find(a => a.userId === req.user.id);
    if (agentProfile) {
      const agentOrderIds = new Set(
        db.orders
          .filter(o => o.agentId === agentProfile.id)
          .map(o => o.id)
      );
      logs = logs.filter(l => agentOrderIds.has(l.orderId));
    } else {
      logs = [];
    }
  }

  // Admins see all (capped at 100 most recent)
  const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(sortedLogs.slice(0, 100));
});

module.exports = router;
