const fs = require('fs');
const path = require('path');

// Inline .env file loader
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...values] = trimmed.split('=');
        const val = values.join('=').trim();
        process.env[key.trim()] = val.replace(/^["']|["']$/g, '');
      }
    });
  }
} catch (e) {
  console.warn('Could not load .env file:', e.message);
}

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { readDb, writeDb, seedDatabase } = require('./db-helper');
const { calculateDeliveryCharge, findNearestAvailableAgent } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lastmile-secret-key-98765';

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Seed database on startup
seedDatabase().catch(console.error);

// Authentication Middleware (Strict JWT Check)
function authenticateToken(req, res, next) {
  const token = req.cookies.token || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Please log in first.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

// Helper to log notifications (Rupee symbol & standard Indian format)
function sendNotification(db, order, status, notes = '') {
  let message = '';
  switch (status) {
    case 'Placed':
      message = `Your order #${order.id} has been placed successfully. Payment: ${order.paymentType}. Amount: ₹${order.totalCharge.toFixed(2)}.`;
      break;
    case 'Assigned':
      message = `Your order #${order.id} has been assigned to delivery agent ${notes}.`;
      break;
    case 'Picked Up':
      message = `Delivery agent ${order.agentName || 'assigned'} has picked up your order #${order.id}. It is now in transit.`;
      break;
    case 'In Transit':
      message = `Your order #${order.id} is in transit.`;
      break;
    case 'Out for Delivery':
      message = `Your order #${order.id} is out for delivery! Our agent is on their way.`;
      break;
    case 'Delivered':
      message = `Hooray! Your order #${order.id} has been delivered successfully. Thank you!`;
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

  // Create Email Notification Log
  const emailLog = {
    id: 'ntf_email_' + Math.random().toString(36).substring(2, 9),
    orderId: order.id,
    customerId: order.customerId,
    type: 'EMAIL',
    message,
    recipient: order.customerEmail || 'customer@tracker.com',
    timestamp: new Date().toISOString()
  };
  
  // Create SMS Notification Log
  const smsLog = {
    id: 'ntf_sms_' + Math.random().toString(36).substring(2, 9),
    orderId: order.id,
    customerId: order.customerId,
    type: 'SMS',
    message: `Delivery Update: ${message}`,
    recipient: '+91 9876543210',
    timestamp: new Date().toISOString()
  };

  db.notificationLogs.push(emailLog, smsLog);
  console.log(`[SMS/EMAIL SENT] Order #${order.id} (${status}) -> ${message}`);
}

// Helper to log order history (immutable)
function logOrderHistory(db, orderId, status, actorId, actorRole, notes = '') {
  const historyEntry = {
    id: 'his_' + Math.random().toString(36).substring(2, 9),
    orderId,
    status,
    actorId,
    actorRole,
    notes,
    timestamp: new Date().toISOString()
  };
  db.orderHistory.push(historyEntry);
}

// --- AUTHENTICATION APIS ---

app.post('/api/auth/register', (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'Please provide all details' });
  }

  // Restrict self-registration role (Admin cannot be self-registered publicly)
  let userRole = role;
  if (userRole === 'admin') {
    return res.status(400).json({ error: 'Self-registration as admin is forbidden.' });
  }
  if (userRole !== 'customer' && userRole !== 'agent') {
    userRole = 'customer'; // Default fallback
  }

  const db = readDb();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  const userId = 'usr_' + Math.random().toString(36).substring(2, 9);
  
  const newUser = {
    id: userId,
    name,
    email: email.toLowerCase(),
    passwordHash,
    role: userRole,
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);

  // If user is a delivery agent, create an agent profile (centered in Pune)
  if (userRole === 'agent') {
    db.agents.push({
      id: 'agt_' + Math.random().toString(36).substring(2, 9),
      userId: userId,
      name: name,
      status: 'AVAILABLE',
      currentLat: 18.5204 + (Math.random() - 0.5) * 0.05, // Offset from Shaniwar Wada, Pune
      currentLng: 73.8567 + (Math.random() - 0.5) * 0.05
    });
  }

  writeDb(db);

  // Create JWT token
  const token = jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role, name: newUser.name }, JWT_SECRET, { expiresIn: '24h' });
  res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax' });
  
  res.status(201).json({
    message: 'User registered successfully',
    token: token,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email/Username and password required' });
  }

  let emailToLook = email.toLowerCase().trim();
  // Map username aliases to emails for convenience
  if (emailToLook === 'admin' || emailToLook === 'usr_admin') emailToLook = 'admin@tracker.com';
  if (emailToLook === 'customer' || emailToLook === 'usr_cust1') emailToLook = 'customer@tracker.com';
  if (emailToLook === 'aditi' || emailToLook === 'usr_cust2') emailToLook = 'aditi@tracker.com';
  if (emailToLook === 'agent1' || emailToLook === 'usr_agent1') emailToLook = 'agent1@tracker.com';
  if (emailToLook === 'agent2' || emailToLook === 'usr_agent2') emailToLook = 'agent2@tracker.com';

  const db = readDb();
  const user = db.users.find(u => u.email.toLowerCase() === emailToLook);
  
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: 'Invalid email/username or password' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
  res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax' });

  res.json({
    message: 'Login successful',
    token: token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});


// --- ZONES APIS (Admin Only) ---

app.get('/api/zones', (req, res) => {
  const db = readDb();
  res.json(db.zones);
});

app.post('/api/zones', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Admin only.' });
  }

  const { name, lat, lng, radiusKm, description } = req.body;
  if (!name || lat == null || lng == null || !radiusKm) {
    return res.status(400).json({ error: 'Invalid zone data.' });
  }

  const db = readDb();
  const newZone = {
    id: 'zone_' + Math.random().toString(36).substring(2, 9),
    name,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    radiusKm: parseFloat(radiusKm),
    description: description || ''
  };

  db.zones.push(newZone);
  writeDb(db);
  res.status(201).json(newZone);
});

app.delete('/api/zones/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Admin only.' });
  }

  const db = readDb();
  const initialLength = db.zones.length;
  db.zones = db.zones.filter(z => z.id !== req.params.id);
  
  if (db.zones.length === initialLength) {
    return res.status(404).json({ error: 'Zone not found' });
  }

  writeDb(db);
  res.json({ message: 'Zone deleted successfully' });
});


// Get list of customers (Admin only)
app.get('/api/customers', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Admins only.' });
  }
  const db = readDb();
  const customers = db.users
    .filter(u => u.role === 'customer')
    .map(u => ({ id: u.id, name: u.name, email: u.email }));
  res.json(customers);
});


// --- RATE CARDS APIS (Admin Only) ---

app.get('/api/rates', (req, res) => {
  const db = readDb();
  res.json(db.rateCards);
});

app.put('/api/rates/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Admin only.' });
  }

  const { basePrice, baseWeightKg, perKgRate, codSurchargeFlat, codSurchargePct } = req.body;
  
  const db = readDb();
  const rateCard = db.rateCards.find(rc => rc.id === req.params.id);
  if (!rateCard) {
    return res.status(404).json({ error: 'Rate card not found' });
  }

  if (basePrice != null) rateCard.basePrice = parseFloat(basePrice);
  if (baseWeightKg != null) rateCard.baseWeightKg = parseFloat(baseWeightKg);
  if (perKgRate != null) rateCard.perKgRate = parseFloat(perKgRate);
  if (codSurchargeFlat != null) rateCard.codSurchargeFlat = parseFloat(codSurchargeFlat);
  if (codSurchargePct != null) rateCard.codSurchargePct = parseFloat(codSurchargePct);

  writeDb(db);
  res.json(rateCard);
});


// --- ORDER APIS ---

// 1. Calculate pricing estimate
app.post('/api/orders/estimate', (req, res) => {
  const { pickupLat, pickupLng, dropLat, dropLng, length, width, height, actualWeight, orderType, paymentType } = req.body;

  try {
    const db = readDb();
    const result = calculateDeliveryCharge({
      pickupLat: parseFloat(pickupLat),
      pickupLng: parseFloat(pickupLng),
      dropLat: parseFloat(dropLat),
      dropLng: parseFloat(dropLng),
      length: parseFloat(length),
      width: parseFloat(width),
      height: parseFloat(height),
      actualWeight: parseFloat(actualWeight),
      orderType,
      paymentType,
      zones: db.zones,
      rateCards: db.rateCards
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 2. Create Order (Authenticated customers or Admins booking on behalf of)
app.post('/api/orders', authenticateToken, (req, res) => {
  const { 
    pickupAddress, pickupLat, pickupLng, 
    dropAddress, dropLat, dropLng, 
    length, width, height, actualWeight, 
    orderType, paymentType, 
    onBehalfOfCustomerId
  } = req.body;

  const db = readDb();
  
  let customerId = req.user.id;
  let customerEmail = req.user.email;
  let customerName = req.user.name;

  if (req.user.role === 'admin') {
    const targetCustId = onBehalfOfCustomerId || (db.users.find(u => u.role === 'customer')?.id);
    const targetCust = db.users.find(u => u.id === targetCustId);
    if (targetCust) {
      customerId = targetCust.id;
      customerEmail = targetCust.email;
      customerName = targetCust.name;
    }
  } else if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Only authenticated customers or admins can create orders.' });
  }

  try {
    // Calculate final rates
    const pricing = calculateDeliveryCharge({
      pickupLat: parseFloat(pickupLat),
      pickupLng: parseFloat(pickupLng),
      dropLat: parseFloat(dropLat),
      dropLng: parseFloat(dropLng),
      length: parseFloat(length),
      width: parseFloat(width),
      height: parseFloat(height),
      actualWeight: parseFloat(actualWeight),
      orderType,
      paymentType,
      zones: db.zones,
      rateCards: db.rateCards
    });

    const orderId = 'ord_' + Math.random().toString(36).substring(2, 9);
    const newOrder = {
      id: orderId,
      customerId,
      customerName,
      customerEmail,
      pickupAddress,
      pickupLat: parseFloat(pickupLat),
      pickupLng: parseFloat(pickupLng),
      dropAddress,
      dropLat: parseFloat(dropLat),
      dropLng: parseFloat(dropLng),
      length: parseFloat(length),
      width: parseFloat(width),
      height: parseFloat(height),
      actualWeight: parseFloat(actualWeight),
      volumetricWeight: pricing.volumetricWeight,
      billingWeight: pricing.billingWeight,
      orderType,
      paymentType,
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
    
    // Log history
    logOrderHistory(db, orderId, 'Placed', req.user.id, req.user.role, 'Order created and pricing confirmed.');
    
    // Send notifications
    sendNotification(db, newOrder, 'Placed');

    writeDb(db);
    res.status(201).json(newOrder);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 3. Get Orders (With Strict Role Restrictions)
app.get('/api/orders', authenticateToken, (req, res) => {
  const db = readDb();
  let orders = db.orders;

  // Filter strictly based on logged in user's role
  if (req.user.role === 'customer') {
    orders = orders.filter(o => o.customerId === req.user.id);
  } else if (req.user.role === 'agent') {
    const agentProfile = db.agents.find(a => a.userId === req.user.id);
    if (agentProfile) {
      orders = orders.filter(o => o.agentId === agentProfile.id);
    } else {
      orders = [];
    }
  }

  // Admin filters
  const { status, zoneId, agentId } = req.query;
  if (req.user.role === 'admin') {
    if (status) {
      orders = orders.filter(o => o.status === status);
    }
    if (zoneId) {
      orders = orders.filter(o => o.pickupZoneId === zoneId || o.dropZoneId === zoneId);
    }
    if (agentId) {
      orders = orders.filter(o => o.agentId === agentId);
    }
  }

  // Sort by date desc
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders);
});

// 4. Get specific order history
app.get('/api/orders/:id/history', authenticateToken, (req, res) => {
  const db = readDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Auth protection
  if (req.user.role === 'customer' && order.customerId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  if (req.user.role === 'agent') {
    const agentProfile = db.agents.find(a => a.userId === req.user.id);
    if (!agentProfile || order.agentId !== agentProfile.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
  }

  const history = db.orderHistory.filter(h => h.orderId === req.params.id);
  history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json({ order, history });
});

// 5. Assign Agent (Admin Only)
app.post('/api/orders/:id/assign', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Admin only.' });
  }

  const { agentId, auto } = req.body;
  const db = readDb();
  
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  let selectedAgent = null;
  let methodNote = '';

  if (auto) {
    const assignmentResult = findNearestAvailableAgent(order.pickupLat, order.pickupLng, db.agents);
    if (!assignmentResult) {
      return res.status(400).json({ error: 'No available delivery agents found nearby.' });
    }
    selectedAgent = assignmentResult.agent;
    methodNote = `Auto-assigned nearest agent (distance: ${assignmentResult.distanceKm} km)`;
  } else {
    if (!agentId) {
      return res.status(400).json({ error: 'Please specify an agentId for manual assignment' });
    }
    selectedAgent = db.agents.find(a => a.id === agentId);
    if (!selectedAgent) {
      return res.status(404).json({ error: 'Agent profile not found.' });
    }
    if (selectedAgent.status !== 'AVAILABLE') {
      return res.status(400).json({ error: `Selected agent is currently ${selectedAgent.status.toLowerCase()}` });
    }
    methodNote = `Manually assigned by admin`;
  }

  const oldAgentId = order.agentId;
  order.agentId = selectedAgent.id;
  order.agentName = selectedAgent.name;
  order.status = 'Assigned';
  order.updatedAt = new Date().toISOString();

  // Free previous agent if any
  if (oldAgentId) {
    const oldAgent = db.agents.find(a => a.id === oldAgentId);
    if (oldAgent) oldAgent.status = 'AVAILABLE';
  }

  selectedAgent.status = 'BUSY';

  logOrderHistory(db, order.id, 'Assigned', req.user.id, req.user.role, methodNote);
  sendNotification(db, order, 'Assigned', selectedAgent.name);

  writeDb(db);
  res.json({ message: 'Agent allocated successfully', order });
});

// 6. Update status (Agents or Admin only)
app.post('/api/orders/:id/status', authenticateToken, (req, res) => {
  const { status, notes } = req.body;
  const allowedStatuses = ['Picked Up', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed'];
  
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status update.' });
  }

  const db = readDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Permission Checks:
  if (req.user.role === 'customer') {
    return res.status(403).json({ error: 'Access forbidden. Customers cannot update status.' });
  }
  
  if (req.user.role === 'agent') {
    const agentProfile = db.agents.find(a => a.userId === req.user.id);
    if (!agentProfile || order.agentId !== agentProfile.id) {
      return res.status(403).json({ error: 'Access forbidden. You are not assigned to this order.' });
    }
  }

  const oldStatus = order.status;
  order.status = status;
  order.updatedAt = new Date().toISOString();

  // Agent availability transitions
  if (status === 'Delivered') {
    if (order.agentId) {
      const agent = db.agents.find(a => a.id === order.agentId);
      if (agent) agent.status = 'AVAILABLE';
    }
  } else if (status === 'Failed') {
    order.rescheduleRequired = true;
    if (order.agentId) {
      const agent = db.agents.find(a => a.id === order.agentId);
      if (agent) agent.status = 'AVAILABLE';
    }
  }

  logOrderHistory(db, order.id, status, req.user.id, req.user.role, notes || `Status updated from ${oldStatus}.`);
  sendNotification(db, order, status, notes);

  writeDb(db);
  res.json({ message: 'Order status updated successfully', order });
});

// 7. Customer Reschedule
app.post('/api/orders/:id/reschedule', authenticateToken, (req, res) => {
  const { rescheduleDate } = req.body;
  if (!rescheduleDate) {
    return res.status(400).json({ error: 'Please select a new date.' });
  }

  const db = readDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Access checks
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

  // Trigger auto-assignment immediately if new closest agent is available
  const assignmentResult = findNearestAvailableAgent(order.pickupLat, order.pickupLng, db.agents);
  if (assignmentResult) {
    const newAgent = assignmentResult.agent;
    order.agentId = newAgent.id;
    order.agentName = newAgent.name;
    order.status = 'Assigned';
    newAgent.status = 'BUSY';
    
    logOrderHistory(db, order.id, 'Assigned', 'system', 'system', `Auto-assigned new agent ${newAgent.name} (distance: ${assignmentResult.distanceKm} km) for rescheduled delivery.`);
    sendNotification(db, order, 'Assigned', newAgent.name);
  }

  writeDb(db);
  res.json({ message: 'Order rescheduled successfully', order });
});


// --- AGENTS APIS ---

// Get active agent list
app.get('/api/agents', authenticateToken, (req, res) => {
  const db = readDb();
  res.json(db.agents);
});

// Update agent location / status
app.post('/api/agents/:id/location', authenticateToken, (req, res) => {
  const { lat, lng, status } = req.body;
  const db = readDb();
  
  const agent = db.agents.find(a => a.id === req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent profile not found.' });
  }

  // Auth check
  if (req.user.role === 'agent') {
    const matchedProfile = db.agents.find(a => a.userId === req.user.id);
    if (!matchedProfile || matchedProfile.id !== agent.id) {
      return res.status(403).json({ error: 'Access forbidden. Can only update your own profile.' });
    }
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden.' });
  }

  if (lat != null) agent.currentLat = parseFloat(lat);
  if (lng != null) agent.currentLng = parseFloat(lng);
  if (status) agent.status = status;

  writeDb(db);
  res.json({ message: 'Agent location/status updated successfully', agent });
});


// --- NOTIFICATION LOG APIS ---

app.get('/api/notifications', authenticateToken, (req, res) => {
  const db = readDb();
  
  let logs = db.notificationLogs;
  // If customer is querying, only show their logs
  if (req.user.role === 'customer') {
    logs = logs.filter(l => l.customerId === req.user.id);
  }

  const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(sortedLogs.slice(0, 50));
});


// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Last-Mile Delivery Tracker Server running on port ${PORT}`);
  console.log(`Address: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
