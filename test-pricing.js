const { detectZone, calculateDeliveryCharge, findNearestAvailableAgent, getHaversineDistance } = require('./utils');

// Mock Zones (Pune NCR)
const mockZones = [
  {
    id: 'zone_a',
    name: 'Zone A (Pune Central / Shaniwar Wada)',
    lat: 18.5204, // Shaniwar Wada center
    lng: 73.8567,
    radiusKm: 5.0
  },
  {
    id: 'zone_b',
    name: 'Zone B (Hinjawadi Phase 1 / IT Park)',
    lat: 18.5913, // Hinjawadi center
    lng: 73.7389,
    radiusKm: 4.0
  }
];

// Mock Rate Cards (INR ₹ Values)
const mockRateCards = [
  {
    id: 'rate_b2b_intra',
    orderType: 'B2B',
    zoneType: 'INTRA',
    basePrice: 100.0,
    baseWeightKg: 5.0,
    perKgRate: 15.0,
    codSurchargeFlat: 50.0,
    codSurchargePct: 1.0
  },
  {
    id: 'rate_b2b_inter',
    orderType: 'B2B',
    zoneType: 'INTER',
    basePrice: 250.0,
    baseWeightKg: 5.0,
    perKgRate: 25.0,
    codSurchargeFlat: 100.0,
    codSurchargePct: 2.0
  },
  {
    id: 'rate_b2c_intra',
    orderType: 'B2C',
    zoneType: 'INTRA',
    basePrice: 50.0,
    baseWeightKg: 2.0,
    perKgRate: 10.0,
    codSurchargeFlat: 20.0,
    codSurchargePct: 1.5
  },
  {
    id: 'rate_b2c_inter',
    orderType: 'B2C',
    zoneType: 'INTER',
    basePrice: 120.0,
    baseWeightKg: 2.0,
    perKgRate: 20.0,
    codSurchargeFlat: 40.0,
    codSurchargePct: 3.0
  }
];

// Mock Agents (Pune NCR)
const mockAgents = [
  {
    id: 'agt_1',
    name: 'Ramesh Kumar (Pune Central)',
    status: 'AVAILABLE',
    currentLat: 18.5200, // Near Shaniwar Wada
    currentLng: 73.8560
  },
  {
    id: 'agt_2',
    name: 'Suresh Singh (Hinjawadi/West)',
    status: 'AVAILABLE',
    currentLat: 18.5910, // Near Hinjawadi
    currentLng: 73.7380
  },
  {
    id: 'agt_3',
    name: 'Amit Patel (Offline)',
    status: 'OFFLINE',
    currentLat: 18.5089, // Hadapsar area
    currentLng: 73.9259
  }
];

// Test Runner
function runTests() {
  console.log('Running Last-Mile Delivery Tracker Test Suite (Indian Standard)...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // Test 1: Haversine distance Pune Central to Hinjawadi
  const d = getHaversineDistance(18.5204, 73.8567, 18.5913, 73.7389);
  assert(Math.abs(d - 14.7) < 0.3, `Distance Pune Central to Hinjawadi should be ~14.7 km (got ${d.toFixed(2)} km)`);

  // Test 2: Zone detection
  const insideA = detectZone(18.5200, 73.8560, mockZones); // Shaniwar Wada
  assert(insideA === 'zone_a', `Pune Central coordinate should map to Zone A (got ${insideA})`);

  const insideB = detectZone(18.5910, 73.7380, mockZones); // Hinjawadi
  assert(insideB === 'zone_b', `Hinjawadi coordinate should map to Zone B (got ${insideB})`);

  const outside = detectZone(18.5089, 73.9259, mockZones); // Hadapsar
  assert(outside === null, `Hadapsar coordinate should be outside any zone (got ${outside})`);

  // Test 3: Volumetric & Base Charge pricing (B2C Intra, Under weight, Prepaid)
  const price1 = calculateDeliveryCharge({
    pickupLat: 18.5200, pickupLng: 73.8560, // Zone A
    dropLat: 18.5250, dropLng: 73.8510,     // Zone A
    length: 10, width: 10, height: 10,       // Volumetric = 0.2kg
    actualWeight: 1.5,                       // Billable = 1.5kg
    orderType: 'B2C',
    paymentType: 'Prepaid',
    zones: mockZones,
    rateCards: mockRateCards
  });
  assert(price1.zoneType === 'INTRA', 'Pickup/Drop in Zone A should be INTRA zone');
  assert(price1.volumetricWeight === 0.2, `Volumetric weight should be 0.2kg (got ${price1.volumetricWeight})`);
  assert(price1.billingWeight === 1.5, 'Billing weight should be actual weight (1.5kg)');
  assert(price1.deliveryCharge === 50.0, `Base charge for B2C Intra should be ₹50.00 (got ₹${price1.deliveryCharge})`);
  assert(price1.codCharge === 0.0, `COD charge should be ₹0.00 for Prepaid (got ₹${price1.codCharge})`);
  assert(price1.totalCharge === 50.0, `Total charge should be ₹50.00 (got ₹${price1.totalCharge})`);

  // Test 4: Pricing with Volumetric billing weight and COD surcharge (B2C Intra, Over weight, COD)
  // L x B x H = 40x40x40 = 64000 / 5000 = 12.8 kg. Actual weight = 5 kg. Billable = 12.8 kg
  // Rate: base = 50.0 (up to 2kg), extra weight = 10.8 kg @ 10.0/kg = 108.00. Delivery charge = 158.00
  // COD: flat = 20.00, pct = 1.5% of 158.00 = 2.37. COD charge = 22.37
  // Total: 158.00 + 22.37 = 180.37
  const price2 = calculateDeliveryCharge({
    pickupLat: 18.5200, pickupLng: 73.8560, // Zone A
    dropLat: 18.5250, dropLng: 73.8510,     // Zone A
    length: 40, width: 40, height: 40,       // Volumetric = 12.8kg
    actualWeight: 5.0,                       // Billable = 12.8kg
    orderType: 'B2C',
    paymentType: 'COD',
    zones: mockZones,
    rateCards: mockRateCards
  });
  assert(price2.billingWeight === 12.8, `Billing weight should be volumetric weight (12.8kg)`);
  assert(price2.deliveryCharge === 158.0, `Delivery charge should be ₹158.00 (got ₹${price2.deliveryCharge})`);
  assert(price2.codCharge === 22.37, `COD charge should be ₹22.37 (got ₹${price2.codCharge})`);
  assert(price2.totalCharge === 180.37, `Total charge should be ₹180.37 (got ₹${price2.totalCharge})`);

  // Test 5: B2B Inter-zone pricing (Pune Central to Hinjawadi)
  // Actual weight = 8kg, base = 5kg. Extra weight = 3kg.
  // Inter-zone base price = 250.00, per kg = 25.00. Delivery charge = 250 + 3 * 25 = 325.00
  const price3 = calculateDeliveryCharge({
    pickupLat: 18.5200, pickupLng: 73.8560, // Zone A
    dropLat: 18.5910, dropLng: 73.7380,     // Zone B
    length: 10, width: 10, height: 10,
    actualWeight: 8.0,
    orderType: 'B2B',
    paymentType: 'Prepaid',
    zones: mockZones,
    rateCards: mockRateCards
  });
  assert(price3.zoneType === 'INTER', 'Zone A to Zone B should be INTER-zone');
  assert(price3.deliveryCharge === 325.0, `Delivery charge should be ₹325.00 (got ₹${price3.deliveryCharge})`);

  // Test 6: Auto Assignment
  // Pickup near Pune Central (18.5204, 73.8567)
  const assignResult = findNearestAvailableAgent(18.5204, 73.8567, mockAgents);
  assert(assignResult !== null, 'Assignment result should not be null');
  assert(assignResult.agent.id === 'agt_1', `Should assign Ramesh Kumar (agt_1) since he is closest (got ${assignResult.agent.name})`);
  assert(assignResult.distanceKm < 0.3, `Distance should be less than 0.3 km (got ${assignResult.distanceKm} km)`);

  console.log(`\nTest results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All tests passed successfully!');
  }
}

runTests();
