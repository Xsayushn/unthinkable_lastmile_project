const fs   = require('fs');
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

  const salt           = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync('tracker123', salt);
  const adminPassword  = bcrypt.hashSync('admin123', salt);
  const custPassword   = bcrypt.hashSync('customer123', salt);

  db.users = [
    { id: 'usr_admin',  name: 'System Admin',           email: 'admin@tracker.com',    passwordHash: adminPassword,  role: 'admin',    createdAt: new Date().toISOString() },
    { id: 'usr_cust1',  name: 'Tata Logistics (B2B)',   email: 'customer@tracker.com', passwordHash: custPassword,   role: 'customer', createdAt: new Date().toISOString() },
    { id: 'usr_cust2',  name: 'Aditi Sharma (B2C)',     email: 'aditi@tracker.com',    passwordHash: hashedPassword, role: 'customer', createdAt: new Date().toISOString() },
    { id: 'usr_agent1', name: 'Ramesh Kumar (Pune Central)', email: 'agent1@tracker.com', passwordHash: hashedPassword, role: 'agent', createdAt: new Date().toISOString() },
    { id: 'usr_agent2', name: 'Suresh Singh (Hinjawadi/West)', email: 'agent2@tracker.com', passwordHash: hashedPassword, role: 'agent', createdAt: new Date().toISOString() },
    { id: 'usr_agent3', name: 'Amit Patel (Offline)',   email: 'agent3@tracker.com',   passwordHash: hashedPassword, role: 'agent',    createdAt: new Date().toISOString() },
    { id: 'usr_agent4', name: 'Ayush (Online)',          email: 'agent4@tracker.com',   passwordHash: hashedPassword, role: 'agent',    createdAt: new Date().toISOString() }
  ];

  db.agents = [
    { id: 'agt_1', userId: 'usr_agent1', name: 'Ramesh Kumar', status: 'AVAILABLE', currentLat: 18.5200, currentLng: 73.8560 },
    { id: 'agt_2', userId: 'usr_agent2', name: 'Suresh Singh', status: 'AVAILABLE', currentLat: 18.5910, currentLng: 73.7380 },
    { id: 'agt_3', userId: 'usr_agent3', name: 'Amit Patel',   status: 'OFFLINE',   currentLat: 18.5089, currentLng: 73.9259 },
    { id: 'agt_4', userId: 'usr_agent4', name: 'Ayush',        status: 'AVAILABLE', currentLat: 18.5089, currentLng: 73.9259 }
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
    { id: 'rate_b2b_intra', orderType: 'B2B', zoneType: 'INTRA', basePrice: 100.0, baseWeightKg: 5.0, perKgRate: 15.0, codSurchargeFlat: 50.0,  codSurchargePct: 1.0 },
    { id: 'rate_b2b_inter', orderType: 'B2B', zoneType: 'INTER', basePrice: 250.0, baseWeightKg: 5.0, perKgRate: 25.0, codSurchargeFlat: 100.0, codSurchargePct: 2.0 },
    { id: 'rate_b2c_intra', orderType: 'B2C', zoneType: 'INTRA', basePrice: 50.0,  baseWeightKg: 2.0, perKgRate: 10.0, codSurchargeFlat: 20.0,  codSurchargePct: 1.5 },
    { id: 'rate_b2c_inter', orderType: 'B2C', zoneType: 'INTER', basePrice: 120.0, baseWeightKg: 2.0, perKgRate: 20.0, codSurchargeFlat: 40.0,  codSurchargePct: 3.0 }
  ];

  db.orders = [];
  db.orderHistory = [];
  db.notificationLogs = [];

  writeDb(db);
  console.log('Database seeded successfully in Indian standard!');
}

module.exports = { readDb, writeDb, invalidateCache, seedDatabase };
