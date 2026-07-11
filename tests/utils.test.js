/**
 * tests/utils.test.js
 * Unit tests for all utility functions in utils.js
 * Covers: Haversine distance, zone detection, pricing engine, agent assignment
 */

const {
  getHaversineDistance,
  detectZone,
  calculateDeliveryCharge,
  findNearestAvailableAgent
} = require('../utils');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockZones = [
  { id: 'zone_a', name: 'Pune Central', lat: 18.5204, lng: 73.8567, radiusKm: 5.0 },
  { id: 'zone_b', name: 'Hinjawadi',    lat: 18.5913, lng: 73.7389, radiusKm: 4.0 }
];

const mockRateCards = [
  { id: 'rate_b2b_intra', orderType: 'B2B', zoneType: 'INTRA', basePrice: 100.0, baseWeightKg: 5.0, perKgRate: 15.0,  codSurchargeFlat: 50.0,  codSurchargePct: 1.0, baseDistanceKm: 10, perKmRateDistance: 5 },
  { id: 'rate_b2b_inter', orderType: 'B2B', zoneType: 'INTER', basePrice: 250.0, baseWeightKg: 5.0, perKgRate: 25.0,  codSurchargeFlat: 100.0, codSurchargePct: 2.0, baseDistanceKm: 15, perKmRateDistance: 10 },
  { id: 'rate_b2c_intra', orderType: 'B2C', zoneType: 'INTRA', basePrice: 50.0,  baseWeightKg: 2.0, perKgRate: 10.0,  codSurchargeFlat: 20.0,  codSurchargePct: 1.5, baseDistanceKm: 5, perKmRateDistance: 3 },
  { id: 'rate_b2c_inter', orderType: 'B2C', zoneType: 'INTER', basePrice: 120.0, baseWeightKg: 2.0, perKgRate: 20.0,  codSurchargeFlat: 40.0,  codSurchargePct: 3.0, baseDistanceKm: 10, perKmRateDistance: 6 }
];

const mockAgents = [
  { id: 'agt_1', name: 'Ramesh',    status: 'AVAILABLE', currentLat: 18.5200, currentLng: 73.8560 },
  { id: 'agt_2', name: 'Suresh',    status: 'AVAILABLE', currentLat: 18.5910, currentLng: 73.7380 },
  { id: 'agt_3', name: 'Amit',      status: 'OFFLINE',   currentLat: 18.5089, currentLng: 73.9259 }
];

// ── Haversine Distance ────────────────────────────────────────────────────────

describe('getHaversineDistance()', () => {
  it('returns ~14.7 km between Pune Central and Hinjawadi', () => {
    const d = getHaversineDistance(18.5204, 73.8567, 18.5913, 73.7389);
    expect(Math.abs(d - 14.7)).toBeLessThan(0.3);
  });

  it('returns 0 for identical coordinates', () => {
    expect(getHaversineDistance(18.5204, 73.8567, 18.5204, 73.8567)).toBe(0);
  });

  it('returns a positive value for any two distinct points', () => {
    const d = getHaversineDistance(0, 0, 1, 1);
    expect(d).toBeGreaterThan(0);
  });
});

// ── Zone Detection ────────────────────────────────────────────────────────────

describe('detectZone()', () => {
  it('detects Zone A for Pune Central coordinates', () => {
    expect(detectZone(18.5200, 73.8560, mockZones)).toBe('zone_a');
  });

  it('detects Zone B for Hinjawadi coordinates', () => {
    expect(detectZone(18.5910, 73.7380, mockZones)).toBe('zone_b');
  });

  it('returns null for coordinates outside all zones (Hadapsar)', () => {
    expect(detectZone(18.5089, 73.9259, mockZones)).toBeNull();
  });

  it('returns null for empty zone list', () => {
    expect(detectZone(18.5200, 73.8560, [])).toBeNull();
  });
});

// ── Pricing Engine ────────────────────────────────────────────────────────────

const baseParams = {
  pickupLat: 18.5200, pickupLng: 73.8560,
  dropLat: 18.5250,   dropLng: 73.8510,
  zones: mockZones, rateCards: mockRateCards
};

describe('calculateDeliveryCharge() — B2C Intra, Prepaid', () => {
  const params = {
    ...baseParams,
    length: 10, width: 10, height: 10,   // volumetric = 0.2 kg
    actualWeight: 1.5, orderType: 'B2C', paymentType: 'Prepaid'
  };
  let result;
  beforeAll(() => { result = calculateDeliveryCharge(params); });

  it('classifies as INTRA zone', ()       => expect(result.zoneType).toBe('INTRA'));
  it('calculates volumetric weight 0.2 kg', () => expect(result.volumetricWeight).toBe(0.2));
  it('uses actual weight as billing weight', () => expect(result.billingWeight).toBe(1.5));
  it('charges base price ₹50 (no extra weight)', () => expect(result.deliveryCharge).toBe(50.0));
  it('has zero COD charge for Prepaid', ()  => expect(result.codCharge).toBe(0.0));
  it('total equals delivery charge', ()    => expect(result.totalCharge).toBe(50.0));
});

describe('calculateDeliveryCharge() — B2C Intra, COD, volumetric billing', () => {
  // 40×40×40 / 5000 = 12.8 kg. Actual = 5 kg. Billable = 12.8
  // Delivery = 50 + (10.8 * 10) = 158. COD = 20 + 158*0.015 = 22.37. Total = 180.37
  const params = {
    ...baseParams,
    length: 40, width: 40, height: 40,
    actualWeight: 5.0, orderType: 'B2C', paymentType: 'COD'
  };
  let result;
  beforeAll(() => { result = calculateDeliveryCharge(params); });

  it('uses volumetric weight (12.8 kg) as billing weight', () => expect(result.billingWeight).toBe(12.8));
  it('delivery charge is ₹158.00', ()   => expect(result.deliveryCharge).toBe(158.0));
  it('COD surcharge is ₹22.37', ()      => expect(result.codCharge).toBe(22.37));
  it('total charge is ₹180.37', ()      => expect(result.totalCharge).toBe(180.37));
});

describe('calculateDeliveryCharge() — B2B Inter-zone', () => {
  // Zone A → Zone B. Weight 8kg. Extra = 3kg @ ₹25/kg. Charge = 250 + 75 = 325
  const params = {
    ...baseParams,
    dropLat: 18.5910, dropLng: 73.7380,
    length: 10, width: 10, height: 10,
    actualWeight: 8.0, orderType: 'B2B', paymentType: 'Prepaid'
  };
  let result;
  beforeAll(() => { result = calculateDeliveryCharge(params); });

  it('classifies as INTER zone', ()      => expect(result.zoneType).toBe('INTER'));
  it('delivery charge is ₹325.00', ()   => expect(result.deliveryCharge).toBe(325.0));
});

describe('calculateDeliveryCharge() — B2C Inter-zone with extra distance', () => {
  // B2C Inter-zone: basePrice = 120.0, baseWeight = 2kg, baseDistance = 10km, perKmRateDistance = 6.
  // Weight 1.5kg (no extra weight). Distance = 200km.
  // Extra distance = 190km @ 6/km = 1140.0. Total delivery charge = 120.0 + 1140.0 = 1260.0.
  // Prepaid: cod = 0, total = 1260.0.
  const params = {
    ...baseParams,
    dropLat: 18.5200 + 2.0, dropLng: 73.8560 + 0.0, // >200km away
    length: 10, width: 10, height: 10,
    actualWeight: 1.5, orderType: 'B2C', paymentType: 'Prepaid'
  };
  let result;
  beforeAll(() => { result = calculateDeliveryCharge(params); });

  it('calculates extra distance charge', () => {
    expect(result.distanceCharge).toBeGreaterThan(1000);
    expect(result.totalCharge).toBe(result.deliveryCharge);
  });
});


describe('calculateDeliveryCharge() — Negative cases', () => {
  it('throws on zero length', () => {
    expect(() => calculateDeliveryCharge({ ...baseParams, length: 0, width: 10, height: 10, actualWeight: 1, orderType: 'B2C', paymentType: 'Prepaid' }))
      .toThrow(/length/i);
  });

  it('throws on negative weight', () => {
    expect(() => calculateDeliveryCharge({ ...baseParams, length: 10, width: 10, height: 10, actualWeight: -1, orderType: 'B2C', paymentType: 'Prepaid' }))
      .toThrow(/weight/i);
  });

  it('throws when no matching rate card exists', () => {
    expect(() => calculateDeliveryCharge({ ...baseParams, length: 10, width: 10, height: 10, actualWeight: 1, orderType: 'UNKNOWN', paymentType: 'Prepaid' }))
      .toThrow(/rate card/i);
  });
});

// ── Agent Assignment ──────────────────────────────────────────────────────────

describe('findNearestAvailableAgent()', () => {
  it('assigns Ramesh (agt_1) as nearest to Pune Central', () => {
    const result = findNearestAvailableAgent(18.5204, 73.8567, mockAgents);
    expect(result).not.toBeNull();
    expect(result.agent.id).toBe('agt_1');
    expect(result.distanceKm).toBeLessThan(0.3);
  });

  it('assigns Suresh (agt_2) as nearest to Hinjawadi', () => {
    const result = findNearestAvailableAgent(18.5913, 73.7389, mockAgents);
    expect(result).not.toBeNull();
    expect(result.agent.id).toBe('agt_2');
  });

  it('returns null when all agents are offline/busy', () => {
    const busyAgents = mockAgents.map(a => ({ ...a, status: 'OFFLINE' }));
    expect(findNearestAvailableAgent(18.5204, 73.8567, busyAgents)).toBeNull();
  });

  it('returns null for empty agent list', () => {
    expect(findNearestAvailableAgent(18.5204, 73.8567, [])).toBeNull();
  });

  it('ignores OFFLINE agents', () => {
    const result = findNearestAvailableAgent(18.5089, 73.9259, mockAgents);
    // agt_3 is OFFLINE and closest geographically but should be skipped
    expect(result).not.toBeNull();
    expect(result.agent.id).not.toBe('agt_3');
  });
});
