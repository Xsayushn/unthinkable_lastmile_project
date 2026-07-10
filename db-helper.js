const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, 'db.json');

// Default database template
const defaultDb = {
  users: [],
  agents: [],
  zones: [],
  rateCards: [],
  orders: [],
  orderHistory: [],
  notificationLogs: []
};

// Read database
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      writeDb(defaultDb);
      return defaultDb;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database file:', error);
    return defaultDb;
  }
}

// Write database
function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing database file:', error);
  }
}

// Seed helper to initialize database with mock data if empty
async function seedDatabase() {
  const db = readDb();

  // Check if seeding is already done (by checking if users exist)
  if (db.users && db.users.length > 0) {
    return;
  }

  console.log('Seeding database with Indian standards and Pune NCR locations...');

  // Hash passwords
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync('tracker123', salt);
  const adminPassword = bcrypt.hashSync('admin123', salt);
  const customerPassword = bcrypt.hashSync('customer123', salt);

  // 1. Seed Users
  db.users = [
    {
      id: 'usr_admin',
      name: 'System Admin',
      email: 'admin@tracker.com',
      passwordHash: adminPassword,
      role: 'admin',
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_cust1',
      name: 'Tata Logistics (B2B)',
      email: 'customer@tracker.com',
      passwordHash: customerPassword,
      role: 'customer',
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_cust2',
      name: 'Aditi Sharma (B2C)',
      email: 'aditi@tracker.com',
      passwordHash: hashedPassword,
      role: 'customer',
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_agent1',
      name: 'Ramesh Kumar (Pune Central)',
      email: 'agent1@tracker.com',
      passwordHash: hashedPassword,
      role: 'agent',
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_agent2',
      name: 'Suresh Singh (Hinjawadi/West)',
      email: 'agent2@tracker.com',
      passwordHash: hashedPassword,
      role: 'agent',
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_agent3',
      name: 'Amit Patel (Offline)',
      email: 'agent3@tracker.com',
      passwordHash: hashedPassword,
      role: 'agent',
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_agent4',
      name: 'Ayush(Online)',
      email: 'agent4@tracker.com',
      passwordHash: hashedPassword,
      role: 'agent',
      createdAt: new Date().toISOString()
    }
  ];

  // 2. Seed Agent Profiles
  db.agents = [
    {
      id: 'agt_1',
      userId: 'usr_agent1',
      name: 'Ramesh Kumar',
      status: 'AVAILABLE', // AVAILABLE, BUSY, OFFLINE
      currentLat: 18.5200, // Near Shaniwar Wada
      currentLng: 73.8560
    },
    {
      id: 'agt_2',
      userId: 'usr_agent2',
      name: 'Suresh Singh ',
      status: 'AVAILABLE',
      currentLat: 18.5910, // Near Hinjawadi Sec 1
      currentLng: 73.7380
    },
    {
      id: 'agt_3',
      userId: 'usr_agent3',
      name: 'Amit Patel ',
      status: 'OFFLINE',
      currentLat: 18.5089, // Hadapsar area
      currentLng: 73.9259
    },
    {
      id: 'agt_4',
      userId: 'usr_agent4',
      name: 'Ayush ',
      status: 'AVAILABLE',
      currentLat: 18.5089, // Hadapsar area
      currentLng: 73.9259
    }
  ];

  // 3. Seed Zones (Pune NCR)
  db.zones = [
    {
      id: 'zone_a',
      name: 'Zone A (Pune Central / Shaniwar Wada)',
      lat: 18.5204, // Shaniwar Wada center
      lng: 73.8567,
      radiusKm: 5.0,
      description: 'Pune Central, Shaniwar Wada, Shivaji Nagar and surrounding hubs'
    },
    {
      id: 'zone_b',
      name: 'Zone B (Hinjawadi Phase 1 / IT Park)',
      lat: 18.5913, // Hinjawadi IT Park center
      lng: 73.7389,
      radiusKm: 4.0,
      description: 'Hinjawadi IT Park Phase 1, Phase 2, and Wakad boundary'
    }
  ];

  // 4. Seed Rate Cards (INR ₹ Values)
  db.rateCards = [
    {
      id: 'rate_b2b_intra',
      orderType: 'B2B',
      zoneType: 'INTRA',
      basePrice: 100.0,      // ₹100
      baseWeightKg: 5.0,
      perKgRate: 15.0,        // ₹15 per kg incremental
      codSurchargeFlat: 50.0, // ₹50
      codSurchargePct: 1.0    // 1%
    },
    {
      id: 'rate_b2b_inter',
      orderType: 'B2B',
      zoneType: 'INTER',
      basePrice: 250.0,      // ₹250
      baseWeightKg: 5.0,
      perKgRate: 25.0,        // ₹25 per kg incremental
      codSurchargeFlat: 100.0,// ₹100
      codSurchargePct: 2.0    // 2%
    },
    {
      id: 'rate_b2c_intra',
      orderType: 'B2C',
      zoneType: 'INTRA',
      basePrice: 50.0,       // ₹50
      baseWeightKg: 2.0,
      perKgRate: 10.0,        // ₹10 per kg incremental
      codSurchargeFlat: 20.0, // ₹20
      codSurchargePct: 1.5    // 1.5%
    },
    {
      id: 'rate_b2c_inter',
      orderType: 'B2C',
      zoneType: 'INTER',
      basePrice: 120.0,      // ₹120
      baseWeightKg: 2.0,
      perKgRate: 20.0,        // ₹20 per kg incremental
      codSurchargeFlat: 40.0, // ₹40
      codSurchargePct: 3.0    // 3%
    }
  ];

  // Seed default structures
  db.orders = [];
  db.orderHistory = [];
  db.notificationLogs = [];

  writeDb(db);
  console.log('Database seeded successfully in Indian standard!');
}

module.exports = {
  readDb,
  writeDb,
  seedDatabase
};
