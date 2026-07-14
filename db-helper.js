const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// DB_FILE is evaluated lazily so DB_PATH env variable set before require() still works
function getDbFile() {
  return process.env.DB_PATH || path.join(__dirname, 'db.json');
}

// Default database structure
const defaultDb = {
  users: [],
  agents: [],
  zones: [],
  rateCards: [],
  orders: [],
  orderHistory: [],
  notificationLogs: []
};

// ─── In-Memory Cache ──────────────────────────────────────────────────────────
// Cache the parsed DB object and only re-read if the file's mtime has changed.
let _cache = null;
let _cacheMtime = null;

/**
 * Read database — returns cached version unless file has changed on disk.
 * @returns {object}
 */
function readDb() {
  const DB_FILE = getDbFile();
  try {
    if (!fs.existsSync(DB_FILE)) {
      writeDb(defaultDb);
      _cache = JSON.parse(JSON.stringify(defaultDb));
      return _cache;
    }

    const stat = fs.statSync(DB_FILE);
    const mtime = stat.mtimeMs;

    // Return cached version if file hasn't been modified
    if (_cache && _cacheMtime === mtime) {
      return _cache;
    }

    // Re-read and re-parse
    const data = fs.readFileSync(DB_FILE, 'utf8');
    _cache = JSON.parse(data);
    _cacheMtime = mtime;
    return _cache;
  } catch (error) {
    console.error('Error reading database file:', error);
    return JSON.parse(JSON.stringify(defaultDb));
  }
}

/**
 * Write database to disk and invalidate the in-memory cache.
 * @param {object} data
 */
function writeDb(data) {
  const DB_FILE = getDbFile();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    // Update cache with written data so next readDb() doesn't re-read unnecessarily
    _cache = data;
    const stat = fs.statSync(DB_FILE);
    _cacheMtime = stat.mtimeMs;
  } catch (error) {
    console.error('Error writing database file:', error);
    // Invalidate cache on write error to force re-read
    _cache = null;
    _cacheMtime = null;
  }
}

/**
 * Invalidate the in-memory cache. Call this if db.json is modified externally.
 */
function invalidateCache() {
  _cache = null;
  _cacheMtime = null;
}

// ─── Database Seeding ─────────────────────────────────────────────────────────

/**
 * Seeds the database with Indian-standard mock data if empty.
 */
async function seedDatabase() {
  const db = readDb();
  if (db.users && db.users.length > 0) return;

  console.log('Seeding database with Indian standards and Pune NCR locations...');

  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync('tracker123', salt);
  const adminPassword = bcrypt.hashSync('admin123', salt);
  const custPassword = bcrypt.hashSync('customer123', salt);

  db.users = [
    { id: 'usr_admin', name: 'System Admin', email: 'admin@tracker.com', passwordHash: adminPassword, role: 'admin', createdAt: new Date().toISOString() },
    { id: 'usr_cust1', name: 'Tata Logistics (B2B)', email: 'customer@tracker.com', passwordHash: custPassword, role: 'customer', createdAt: new Date().toISOString() },
    { id: 'usr_cust2', name: 'Ayush (B2C)', email: 'ayush@tracker.com', passwordHash: hashedPassword, role: 'customer', createdAt: new Date().toISOString() },
    { id: 'usr_agent1', name: 'Ramesh Kumar (Pune Central)', email: 'agent1@tracker.com', passwordHash: hashedPassword, role: 'agent', createdAt: new Date().toISOString() },
    { id: 'usr_agent2', name: 'Suresh Singh (Hinjawadi/West)', email: 'agent2@tracker.com', passwordHash: hashedPassword, role: 'agent', createdAt: new Date().toISOString() },
    { id: 'usr_agent3', name: 'Amit Patel (Offline)', email: 'agent3@tracker.com', passwordHash: hashedPassword, role: 'agent', createdAt: new Date().toISOString() }
  ];

  db.agents = [
    { id: 'agt_1', userId: 'usr_agent1', name: 'Ramesh Kumar', status: 'AVAILABLE', currentLat: 18.5200, currentLng: 73.8560 },
    { id: 'agt_2', userId: 'usr_agent2', name: 'Suresh Singh', status: 'AVAILABLE', currentLat: 18.5910, currentLng: 73.7380 },
    { id: 'agt_3', userId: 'usr_agent3', name: 'Amit Patel', status: 'OFFLINE', currentLat: 18.5089, currentLng: 73.9259 }
  ];

  db.zones = [
    {
      id: 'zone_a', name: 'Zone A (Pune Central / Shaniwar Wada)',
      lat: 18.5204, lng: 73.8567, radiusKm: 5.0,
      description: 'Pune Central, Shaniwar Wada, Shivaji Nagar and surrounding hubs'
    },
    {
      id: 'zone_b', name: 'Zone B (Hinjawadi Phase 1 / IT Park)',
      lat: 18.5913, lng: 73.7389, radiusKm: 4.0,
      description: 'Hinjawadi IT Park Phase 1, Phase 2, and Wakad boundary'
    }
  ];

  db.rateCards = [
    { id: 'rate_b2b_intra', orderType: 'B2B', zoneType: 'INTRA', basePrice: 100.0, baseWeightKg: 5.0, perKgRate: 15.0, codSurchargeFlat: 50.0, codSurchargePct: 1.0, baseDistanceKm: 10, perKmRateDistance: 5 },
    { id: 'rate_b2b_inter', orderType: 'B2B', zoneType: 'INTER', basePrice: 250.0, baseWeightKg: 5.0, perKgRate: 25.0, codSurchargeFlat: 100.0, codSurchargePct: 2.0, baseDistanceKm: 15, perKmRateDistance: 10 },
    { id: 'rate_b2c_intra', orderType: 'B2C', zoneType: 'INTRA', basePrice: 50.0, baseWeightKg: 2.0, perKgRate: 10.0, codSurchargeFlat: 20.0, codSurchargePct: 1.5, baseDistanceKm: 5, perKmRateDistance: 3 },
    { id: 'rate_b2c_inter', orderType: 'B2C', zoneType: 'INTER', basePrice: 120.0, baseWeightKg: 2.0, perKgRate: 20.0, codSurchargeFlat: 40.0, codSurchargePct: 3.0, baseDistanceKm: 10, perKmRateDistance: 6 }
  ];

  db.orders = [
    {
      id: 'ord_sample1',
      customerId: 'usr_cust2',
      customerName: 'Ayush (B2C)',
      customerEmail: 'ayush@tracker.com',
      pickupAddress: 'Shaniwar Wada, Shivaji Nagar, Pune',
      pickupLat: 18.5204,
      pickupLng: 73.8567,
      dropAddress: 'Swargate Bus Station, Pune',
      dropLat: 18.5018,
      dropLng: 73.8629,
      length: 20,
      width: 20,
      height: 15,
      actualWeight: 1.5,
      volumetricWeight: 1.2,
      billingWeight: 1.5,
      orderType: 'B2C',
      paymentType: 'Prepaid',
      deliveryCharge: 50.00,
      codCharge: 0.00,
      totalCharge: 50.00,
      pickupZoneId: 'zone_a',
      dropZoneId: 'zone_a',
      zoneType: 'INTRA',
      status: 'Placed',
      agentId: null,
      agentName: null,
      rescheduleDate: null,
      createdAt: '2026-07-14T10:00:00.000Z',
      updatedAt: '2026-07-14T10:00:00.000Z'
    },
    {
      id: 'ord_sample2',
      customerId: 'usr_cust1',
      customerName: 'Tata Logistics (B2B)',
      customerEmail: 'customer@tracker.com',
      pickupAddress: 'Pune Central Mall, Pune',
      pickupLat: 18.5304,
      pickupLng: 73.8340,
      dropAddress: 'Hinjawadi Phase 1, IT Park, Pune',
      dropLat: 18.5913,
      dropLng: 73.7389,
      length: 30,
      width: 30,
      height: 30,
      actualWeight: 6.0,
      volumetricWeight: 5.4,
      billingWeight: 6.0,
      orderType: 'B2B',
      paymentType: 'COD',
      deliveryCharge: 265.00,
      codCharge: 105.00,
      totalCharge: 370.00,
      pickupZoneId: 'zone_a',
      dropZoneId: 'zone_b',
      zoneType: 'INTER',
      status: 'In Transit',
      agentId: 'agt_1',
      agentName: 'Ramesh Kumar',
      rescheduleDate: null,
      createdAt: '2026-07-14T11:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z'
    },
    {
      id: 'ord_sample3',
      customerId: 'usr_cust2',
      customerName: 'Ayush (B2C)',
      customerEmail: 'ayush@tracker.com',
      pickupAddress: 'Shaniwar Wada, Shivaji Nagar, Pune',
      pickupLat: 18.5204,
      pickupLng: 73.8567,
      dropAddress: 'Hinjawadi Phase 1, IT Park, Pune',
      dropLat: 18.5913,
      dropLng: 73.7389,
      length: 15,
      width: 15,
      height: 10,
      actualWeight: 1.0,
      volumetricWeight: 0.45,
      billingWeight: 1.0,
      orderType: 'B2C',
      paymentType: 'Prepaid',
      deliveryCharge: 120.00,
      codCharge: 0.00,
      totalCharge: 120.00,
      pickupZoneId: 'zone_a',
      dropZoneId: 'zone_b',
      zoneType: 'INTER',
      status: 'Delivered',
      agentId: 'agt_2',
      agentName: 'Suresh Singh',
      rescheduleDate: null,
      createdAt: '2026-07-14T08:00:00.000Z',
      updatedAt: '2026-07-14T09:30:00.000Z'
    },
    {
      id: 'ord_sample4',
      customerId: 'usr_cust1',
      customerName: 'Tata Logistics (B2B)',
      customerEmail: 'customer@tracker.com',
      pickupAddress: 'Hinjawadi Phase 1, IT Park, Pune',
      pickupLat: 18.5913,
      pickupLng: 73.7389,
      dropAddress: 'Swargate Bus Station, Pune',
      dropLat: 18.5018,
      dropLng: 73.8629,
      length: 40,
      width: 40,
      height: 30,
      actualWeight: 10.0,
      volumetricWeight: 9.6,
      billingWeight: 10.0,
      orderType: 'B2B',
      paymentType: 'Prepaid',
      deliveryCharge: 325.00,
      codCharge: 0.00,
      totalCharge: 325.00,
      pickupZoneId: 'zone_b',
      dropZoneId: null,
      zoneType: 'INTER',
      status: 'Failed',
      agentId: 'agt_1',
      agentName: 'Ramesh Kumar',
      rescheduleDate: null,
      createdAt: '2026-07-14T07:00:00.000Z',
      updatedAt: '2026-07-14T08:45:00.000Z'
    }
  ];

  db.orderHistory = [
    {
      id: 'his_sample1_1',
      orderId: 'ord_sample1',
      status: 'Placed',
      actorId: 'usr_cust2',
      actorRole: 'customer',
      notes: 'Order created and pricing confirmed.',
      timestamp: '2026-07-14T10:00:00.000Z'
    },
    {
      id: 'his_sample2_1',
      orderId: 'ord_sample2',
      status: 'Placed',
      actorId: 'usr_cust1',
      actorRole: 'customer',
      notes: 'Order created and pricing confirmed.',
      timestamp: '2026-07-14T11:00:00.000Z'
    },
    {
      id: 'his_sample2_2',
      orderId: 'ord_sample2',
      status: 'Assigned',
      actorId: 'usr_admin',
      actorRole: 'admin',
      notes: 'Manually assigned by admin.',
      timestamp: '2026-07-14T11:15:00.000Z'
    },
    {
      id: 'his_sample2_3',
      orderId: 'ord_sample2',
      status: 'Picked Up',
      actorId: 'usr_agent1',
      actorRole: 'agent',
      notes: 'Package picked up from client.',
      timestamp: '2026-07-14T11:45:00.000Z'
    },
    {
      id: 'his_sample2_4',
      orderId: 'ord_sample2',
      status: 'In Transit',
      actorId: 'usr_agent1',
      actorRole: 'agent',
      notes: 'Package in transit to drop location.',
      timestamp: '2026-07-14T12:00:00.000Z'
    },
    {
      id: 'his_sample3_1',
      orderId: 'ord_sample3',
      status: 'Placed',
      actorId: 'usr_cust2',
      actorRole: 'customer',
      notes: 'Order created and pricing confirmed.',
      timestamp: '2026-07-14T08:00:00.000Z'
    },
    {
      id: 'his_sample3_2',
      orderId: 'ord_sample3',
      status: 'Assigned',
      actorId: 'usr_admin',
      actorRole: 'admin',
      notes: 'Allocated nearest available agent.',
      timestamp: '2026-07-14T08:05:00.000Z'
    },
    {
      id: 'his_sample3_3',
      orderId: 'ord_sample3',
      status: 'Picked Up',
      actorId: 'usr_agent2',
      actorRole: 'agent',
      notes: 'Status updated from Assigned.',
      timestamp: '2026-07-14T08:30:00.000Z'
    },
    {
      id: 'his_sample3_4',
      orderId: 'ord_sample3',
      status: 'In Transit',
      actorId: 'usr_agent2',
      actorRole: 'agent',
      notes: 'Status updated from Picked Up.',
      timestamp: '2026-07-14T08:50:00.000Z'
    },
    {
      id: 'his_sample3_5',
      orderId: 'ord_sample3',
      status: 'Out for Delivery',
      actorId: 'usr_agent2',
      actorRole: 'agent',
      notes: 'Out for final delivery leg.',
      timestamp: '2026-07-14T09:15:00.000Z'
    },
    {
      id: 'his_sample3_6',
      orderId: 'ord_sample3',
      status: 'Delivered',
      actorId: 'usr_agent2',
      actorRole: 'agent',
      notes: 'Package handed over to customer.',
      timestamp: '2026-07-14T09:30:00.000Z'
    },
    {
      id: 'his_sample4_1',
      orderId: 'ord_sample4',
      status: 'Placed',
      actorId: 'usr_cust1',
      actorRole: 'customer',
      notes: 'Order created and pricing confirmed.',
      timestamp: '2026-07-14T07:00:00.000Z'
    },
    {
      id: 'his_sample4_2',
      orderId: 'ord_sample4',
      status: 'Assigned',
      actorId: 'usr_admin',
      actorRole: 'admin',
      notes: 'Assigned by admin.',
      timestamp: '2026-07-14T07:10:00.000Z'
    },
    {
      id: 'his_sample4_3',
      orderId: 'ord_sample4',
      status: 'Picked Up',
      actorId: 'usr_agent1',
      actorRole: 'agent',
      notes: 'Status updated from Assigned.',
      timestamp: '2026-07-14T07:40:00.000Z'
    },
    {
      id: 'his_sample4_4',
      orderId: 'ord_sample4',
      status: 'In Transit',
      actorId: 'usr_agent1',
      actorRole: 'agent',
      notes: 'Status updated from Picked Up.',
      timestamp: '2026-07-14T08:00:00.000Z'
    },
    {
      id: 'his_sample4_5',
      orderId: 'ord_sample4',
      status: 'Out for Delivery',
      actorId: 'usr_agent1',
      actorRole: 'agent',
      notes: 'Status updated from In Transit.',
      timestamp: '2026-07-14T08:30:00.000Z'
    },
    {
      id: 'his_sample4_6',
      orderId: 'ord_sample4',
      status: 'Failed',
      actorId: 'usr_agent1',
      actorRole: 'agent',
      notes: 'Customer not reachable at drop location after 3 attempts.',
      timestamp: '2026-07-14T08:45:00.000Z'
    }
  ];

  db.notificationLogs = [
    {
      id: 'ntf_sample1_email',
      orderId: 'ord_sample1',
      customerId: 'usr_cust2',
      type: 'EMAIL',
      message: 'Your order #ord_sample1 has been placed. Payment: Prepaid. Amount: ₹50.00.',
      recipient: 'ayush@tracker.com',
      timestamp: '2026-07-14T10:00:05.000Z'
    },
    {
      id: 'ntf_sample2_email',
      orderId: 'ord_sample2',
      customerId: 'usr_cust1',
      type: 'EMAIL',
      message: 'Your order #ord_sample2 has been placed. Payment: COD. Amount: ₹370.00.',
      recipient: 'customer@tracker.com',
      timestamp: '2026-07-14T11:00:05.000Z'
    }
  ];

  writeDb(db);
  console.log('Database seeded successfully in Indian standard!');
}

module.exports = { readDb, writeDb, invalidateCache, seedDatabase };
