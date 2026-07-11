const express = require('express');
const crypto = require('crypto');

const { readDb, writeDb } = require('../db-helper');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { calculateDeliveryCharge, findNearestAvailableAgent } = require('../utils');
const {
  sanitizeString,
  validateLat,
  validateLng,
  validatePositiveNumber
} = require('../middleware/validate');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Logs an immutable order history entry to the DB object.
 */
function logOrderHistory(db, orderId, status, actorId, actorRole, notes = '') {
  db.orderHistory.push({
    id: 'his_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
    orderId,
    status,
    actorId,
    actorRole,
    notes,
    timestamp: new Date().toISOString()
  });
}

/**
 * Appends mock Email + SMS notification logs to the DB object.
 */
function sendNotification(db, order, status, notes = '') {
  let message = '';
  switch (status) {
    case 'Placed':
      message = `Your order #${order.id} has been placed. Payment: ${order.paymentType}. Amount: ₹${order.totalCharge.toFixed(2)}.`;
      break;
    case 'Assigned':
      message = `Your order #${order.id} has been assigned to delivery agent ${notes}.`;
      break;
    case 'Picked Up':
      message = `Agent ${order.agentName || 'assigned'} has picked up your order #${order.id}.`;
      break;
    case 'In Transit':
      message = `Your order #${order.id} is in transit.`;
      break;
    case 'Out for Delivery':
      message = `Your order #${order.id} is out for delivery! Our agent is on their way.`;
      break;
    case 'Delivered':
      message = `Your order #${order.id} has been delivered. Thank you!`;
      break;
    case 'Failed':
      message = `Delivery failed for order #${order.id}. Reason: ${notes || 'Unknown'}. Please log in to reschedule.`;
      break;
    case 'Rescheduled':
      message = `Your order #${order.id} has been rescheduled to ${order.rescheduleDate}. A new agent is being assigned.`;
      break;
    default:
      message = `Order #${order.id} status updated to: ${status}.`;
  }

  const base = {
    orderId: order.id,
    customerId: order.customerId,
    timestamp: new Date().toISOString()
  };

  db.notificationLogs.push(
    {
      ...base,
      id: 'ntf_email_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
      type: 'EMAIL',
      message,
      recipient: order.customerEmail || 'customer@tracker.com'
    },
    {
      ...base,
      id: 'ntf_sms_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8),
      type: 'SMS',
      message: `Delivery Update: ${message}`,
      recipient: '+91 9876543210'
    }
  );

  console.log(`[NOTIFICATION] Order #${order.id} (${status}) → ${message}`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// 1. POST /api/orders/estimate — Pricing estimate (no auth required, no DB write)
router.post('/estimate', (req, res) => {
  const pickupLat = validateLat(req.body.pickupLat);
  const pickupLng = validateLng(req.body.pickupLng);
  const dropLat   = validateLat(req.body.dropLat);
  const dropLng   = validateLng(req.body.dropLng);
  const length    = validatePositiveNumber(req.body.length);
  const width     = validatePositiveNumber(req.body.width);
  const height    = validatePositiveNumber(req.body.height);
  const actualWeight = validatePositiveNumber(req.body.actualWeight);
  const { orderType, paymentType } = req.body;

  if (pickupLat === null || pickupLng === null || dropLat === null || dropLng === null) {
    return res.status(400).json({ error: 'Invalid or missing coordinates.' });
  }
  if (length === null || width === null || height === null || actualWeight === null) {
    return res.status(400).json({ error: 'Dimensions and weight must be positive numbers.' });
  }
  if (!['B2B', 'B2C'].includes(orderType)) {
    return res.status(400).json({ error: 'orderType must be B2B or B2C.' });
  }
  if (!['Prepaid', 'COD'].includes(paymentType)) {
    return res.status(400).json({ error: 'paymentType must be Prepaid or COD.' });
  }

  try {
    const db = readDb();
    const result = calculateDeliveryCharge({
      pickupLat, pickupLng, dropLat, dropLng,
      length, width, height, actualWeight,
      orderType, paymentType,
      zones: db.zones, rateCards: db.rateCards
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 2. POST /api/orders — Create a new order (authenticated customers/admins)
router.post('/', authenticateToken, (req, res) => {
  const {
    pickupAddress, dropAddress,
    orderType, paymentType,
    onBehalfOfCustomerId
  } = req.body;

  const pickupLat = validateLat(req.body.pickupLat);
  const pickupLng = validateLng(req.body.pickupLng);
  const dropLat   = validateLat(req.body.dropLat);
  const dropLng   = validateLng(req.body.dropLng);
  const length    = validatePositiveNumber(req.body.length);
  const width     = validatePositiveNumber(req.body.width);
  const height    = validatePositiveNumber(req.body.height);
  const actualWeight = validatePositiveNumber(req.body.actualWeight);
  const cleanPickupAddr = sanitizeString(pickupAddress, 300);
  const cleanDropAddr   = sanitizeString(dropAddress, 300);

  if (pickupLat === null || pickupLng === null || dropLat === null || dropLng === null) {
    return res.status(400).json({ error: 'Invalid or missing coordinates.' });
  }
  if (length === null || width === null || height === null || actualWeight === null) {
    return res.status(400).json({ error: 'Dimensions and weight must be positive numbers.' });
  }
  if (!cleanPickupAddr) return res.status(400).json({ error: 'Pickup address is required.' });
  if (!cleanDropAddr)   return res.status(400).json({ error: 'Drop address is required.' });
  if (!['B2B', 'B2C'].includes(orderType)) {
    return res.status(400).json({ error: 'orderType must be B2B or B2C.' });
  }
  if (!['Prepaid', 'COD'].includes(paymentType)) {
    return res.status(400).json({ error: 'paymentType must be Prepaid or COD.' });
  }

  const db = readDb();

  let customerId    = req.user.id;
  let customerEmail = req.user.email;
  let customerName  = req.user.name;

  if (req.user.role === 'admin') {
    const targetId = onBehalfOfCustomerId || db.users.find(u => u.role === 'customer')?.id;
    const targetCust = db.users.find(u => u.id === targetId);
    if (targetCust) {
      customerId    = targetCust.id;
      customerEmail = targetCust.email;
      customerName  = targetCust.name;
    }
  } else if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Only authenticated customers or admins can create orders.' });
  }

  try {
    const pricing = calculateDeliveryCharge({
      pickupLat, pickupLng, dropLat, dropLng,
      length, width, height, actualWeight,
      orderType, paymentType,
      zones: db.zones, rateCards: db.rateCards
    });

    const orderId = 'ord_' + crypto.randomUUID().replace(/-/g, '').substring(0, 8);
    const newOrder = {
      id: orderId,
      customerId, customerName, customerEmail,
      pickupAddress: cleanPickupAddr,
      pickupLat, pickupLng,
      dropAddress: cleanDropAddr,
      dropLat, dropLng,
      length, width, height, actualWeight,
      volumetricWeight: pricing.volumetricWeight,
      billingWeight: pricing.billingWeight,
      orderType, paymentType,
      deliveryCharge: pricing.deliveryCharge,
      codCharge: pricing.codCharge,
      totalCharge: pricing.totalCharge,
      pickupZoneId: pricing.pickupZoneId,
      dropZoneId: pricing.dropZoneId,
      zoneType: pricing.zoneType,
      status: 'Placed',
      agentId: null,
      agentName: null,
      rescheduleDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.orders.push(newOrder);
    logOrderHistory(db, orderId, 'Placed', req.user.id, req.user.role, 'Order created and pricing confirmed.');
    sendNotification(db, newOrder, 'Placed');
    writeDb(db);

    res.status(201).json(newOrder);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 3. GET /api/orders — Fetch orders (role-filtered, paginated)
router.get('/', authenticateToken, (req, res) => {
  const db = readDb();
  let orders = db.orders;

  // Role-based filtering
  if (req.user.role === 'customer') {
    orders = orders.filter(o => o.customerId === req.user.id);
  } else if (req.user.role === 'agent') {
    const agentProfile = db.agents.find(a => a.userId === req.user.id);
    orders = agentProfile ? orders.filter(o => o.agentId === agentProfile.id) : [];
  }

  // Admin query filters
  if (req.user.role === 'admin') {
    const { status, zoneId, agentId } = req.query;
    if (status)  orders = orders.filter(o => o.status === status);
    if (zoneId)  orders = orders.filter(o => o.pickupZoneId === zoneId || o.dropZoneId === zoneId);
    if (agentId) orders = orders.filter(o => o.agentId === agentId);
  }

  // Sort by date descending
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Pagination (additive — backward compatible when no params passed)
  const page  = parseInt(req.query.page, 10) || null;
  const limit = parseInt(req.query.limit, 10) || null;

  if (page && limit) {
    const total = orders.length;
    const start = (page - 1) * limit;
    const paginated = orders.slice(start, start + limit);
    return res.json({ orders: paginated, total, page, limit, pages: Math.ceil(total / limit) });
  }

  // No pagination: cap at 200 to prevent accidental large responses
  res.json(orders.slice(0, 200));
});

// 4. GET /api/orders/:id/history — Get order with full history
router.get('/:id/history', authenticateToken, (req, res) => {
  const db = readDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  // Role-based access
  if (req.user.role === 'customer' && order.customerId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  if (req.user.role === 'agent') {
    const agentProfile = db.agents.find(a => a.userId === req.user.id);
    if (!agentProfile || order.agentId !== agentProfile.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
  }

  const history = db.orderHistory
    .filter(h => h.orderId === req.params.id)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json({ order, history });
});

// 5. POST /api/orders/:id/assign — Assign agent (Admin only)
router.post('/:id/assign', authenticateToken, requireAdmin, (req, res) => {
  const { agentId, auto } = req.body;
  const db = readDb();

  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  let selectedAgent = null;
  let methodNote = '';

  if (auto) {
    const assignmentResult = findNearestAvailableAgent(order.pickupLat, order.pickupLng, db.agents);
    if (!assignmentResult) {
      return res.status(400).json({ error: 'No available delivery agents found nearby.' });
    }
    selectedAgent = assignmentResult.agent;
    methodNote = `Auto-assigned nearest agent (distance: ${assignmentResult.distanceKm} km).`;
  } else {
    if (!agentId) return res.status(400).json({ error: 'Please specify an agentId for manual assignment.' });
    selectedAgent = db.agents.find(a => a.id === agentId);
    if (!selectedAgent) return res.status(404).json({ error: 'Agent profile not found.' });
    if (selectedAgent.status !== 'AVAILABLE') {
      return res.status(400).json({ error: `Selected agent is currently ${selectedAgent.status.toLowerCase()}.` });
    }
    methodNote = 'Manually assigned by admin.';
  }

  const oldAgentId = order.agentId;
  order.agentId = selectedAgent.id;
  order.agentName = selectedAgent.name;
  order.status = 'Assigned';
  order.updatedAt = new Date().toISOString();

  if (oldAgentId) {
    const oldAgent = db.agents.find(a => a.id === oldAgentId);
    if (oldAgent) oldAgent.status = 'AVAILABLE';
  }
  selectedAgent.status = 'BUSY';

  logOrderHistory(db, order.id, 'Assigned', req.user.id, req.user.role, methodNote);
  sendNotification(db, order, 'Assigned', selectedAgent.name);
  writeDb(db);

  res.json({ message: 'Agent allocated successfully.', order });
});

// 6. POST /api/orders/:id/status — Update order status (agent/admin)
router.post('/:id/status', authenticateToken, (req, res) => {
  const { status, notes } = req.body;
  const allowedStatuses = ['Picked Up', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}.` });
  }

  const db = readDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (req.user.role === 'customer') {
    return res.status(403).json({ error: 'Customers cannot update order status.' });
  }

  if (req.user.role === 'agent') {
    const agentProfile = db.agents.find(a => a.userId === req.user.id);
    if (!agentProfile || order.agentId !== agentProfile.id) {
      return res.status(403).json({ error: 'You are not assigned to this order.' });
    }
  }

  const oldStatus = order.status;
  order.status = status;
  order.updatedAt = new Date().toISOString();

  if (status === 'Delivered' || status === 'Failed') {
    if (order.agentId) {
      const agent = db.agents.find(a => a.id === order.agentId);
      if (agent) agent.status = 'AVAILABLE';
    }
    if (status === 'Failed') order.rescheduleRequired = true;
  }

  const noteText = notes ? sanitizeString(notes, 300) : `Status updated from ${oldStatus}.`;
  logOrderHistory(db, order.id, status, req.user.id, req.user.role, noteText || `Status updated from ${oldStatus}.`);
  sendNotification(db, order, status, noteText);
  writeDb(db);

  res.json({ message: 'Order status updated successfully.', order });
});

// 7. POST /api/orders/:id/reschedule — Customer reschedule
router.post('/:id/reschedule', authenticateToken, (req, res) => {
  const { rescheduleDate } = req.body;

  if (!rescheduleDate || typeof rescheduleDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rescheduleDate)) {
    return res.status(400).json({ error: 'Please provide a valid reschedule date (YYYY-MM-DD).' });
  }

  const db = readDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (req.user.role === 'customer' && order.customerId !== req.user.id) {
    return res.status(403).json({ error: 'Access forbidden.' });
  }
  if (order.status !== 'Failed' && !order.rescheduleRequired) {
    return res.status(400).json({ error: 'Order does not require rescheduling.' });
  }

  const oldAgentId = order.agentId;
  order.status = 'Rescheduled';
  order.rescheduleDate = rescheduleDate;
  order.rescheduleRequired = false;
  order.agentId = null;
  order.agentName = null;
  order.updatedAt = new Date().toISOString();

  if (oldAgentId) {
    const oldAgent = db.agents.find(a => a.id === oldAgentId);
    if (oldAgent) oldAgent.status = 'AVAILABLE';
  }

  logOrderHistory(db, order.id, 'Rescheduled', req.user.id, req.user.role, `Rescheduled for ${rescheduleDate}. Reassignment pending.`);
  sendNotification(db, order, 'Rescheduled');

  // Immediately trigger nearest-agent auto-assignment
  const assignmentResult = findNearestAvailableAgent(order.pickupLat, order.pickupLng, db.agents);
  if (assignmentResult) {
    const newAgent = assignmentResult.agent;
    order.agentId   = newAgent.id;
    order.agentName  = newAgent.name;
    order.status     = 'Assigned';
    newAgent.status  = 'BUSY';

    logOrderHistory(db, order.id, 'Assigned', 'system', 'system',
      `Auto-assigned new agent ${newAgent.name} (distance: ${assignmentResult.distanceKm} km) for rescheduled delivery.`);
    sendNotification(db, order, 'Assigned', newAgent.name);
  }

  writeDb(db);
  res.json({ message: 'Order rescheduled successfully.', order });
});

module.exports = router;
