/**
 * Calculates the Haversine distance between two sets of GPS coordinates in kilometers.
 */
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Detects which zone a coordinate belongs to.
 * Returns the zone ID, or null if outside all zones.
 * If multiple zones cover the coordinate, returns the one whose center is closer.
 */
function detectZone(lat, lng, zones) {
  let detectedZoneId = null;
  let minDistance = Infinity;
  
  for (const zone of zones) {
    const distance = getHaversineDistance(lat, lng, zone.lat, zone.lng);
    if (distance <= zone.radiusKm) {
      if (distance < minDistance) {
        minDistance = distance;
        detectedZoneId = zone.id;
      }
    }
  }
  
  return detectedZoneId;
}

/**
 * Calculates delivery charges based on dimensions, weight, zones, and payment parameters.
 */
function calculateDeliveryCharge(params) {
  const {
    pickupLat,
    pickupLng,
    dropLat,
    dropLng,
    length, // cm
    width,  // cm
    height, // cm
    actualWeight, // kg
    orderType, // 'B2B' or 'B2C'
    paymentType, // 'Prepaid' or 'COD'
    zones,
    rateCards
  } = params;

  const numLength = parseFloat(length);
  const numWidth = parseFloat(width);
  const numHeight = parseFloat(height);
  const numWeight = parseFloat(actualWeight);

  if (isNaN(numLength) || numLength <= 0) {
    throw new Error('Length must be a valid positive number.');
  }
  if (isNaN(numWidth) || numWidth <= 0) {
    throw new Error('Width must be a valid positive number.');
  }
  if (isNaN(numHeight) || numHeight <= 0) {
    throw new Error('Height must be a valid positive number.');
  }
  if (isNaN(numWeight) || numWeight <= 0) {
    throw new Error('Weight must be a valid positive number.');
  }

  // 1. Detect Zones
  const pickupZoneId = detectZone(pickupLat, pickupLng, zones);
  const dropZoneId = detectZone(dropLat, dropLng, zones);

  // Determine Zone Type:
  // INTRA if both are in the same zone.
  // INTER if they are in different zones, or if one or both are outside zones.
  const zoneType = (pickupZoneId && dropZoneId && pickupZoneId === dropZoneId) ? 'INTRA' : 'INTER';

  // 2. Volumetric Weight Calculation: L * B * H / 5000
  const volumetricWeight = (numLength * numWidth * numHeight) / 5000;

  // Billable Weight: Higher of actual vs volumetric
  const billingWeight = Math.max(numWeight, volumetricWeight);

  // 3. Find matching rate card
  const rateCard = rateCards.find(
    rc => rc.orderType === orderType && rc.zoneType === zoneType
  );

  if (!rateCard) {
    throw new Error(`No rate card found for Order Type: ${orderType}, Zone Type: ${zoneType}`);
  }

  // 4. Compute delivery charge
  const basePrice = rateCard.basePrice;
  const baseWeightKg = rateCard.baseWeightKg;
  const perKgRate = rateCard.perKgRate;

  const extraWeight = Math.max(0, billingWeight - baseWeightKg);
  const deliveryCharge = basePrice + (extraWeight * perKgRate);

  // 5. COD Surcharge (if applicable)
  let codCharge = 0;
  if (paymentType === 'COD') {
    const flatSurcharge = rateCard.codSurchargeFlat;
    const pctSurcharge = rateCard.codSurchargePct;
    codCharge = flatSurcharge + (deliveryCharge * (pctSurcharge / 100));
  }

  // Round values to 2 decimal places
  const roundedVolumetricWeight = Math.round(volumetricWeight * 100) / 100;
  const roundedBillingWeight = Math.round(billingWeight * 100) / 100;
  const roundedDeliveryCharge = Math.round(deliveryCharge * 100) / 100;
  const roundedCodCharge = Math.round(codCharge * 100) / 100;
  const totalCharge = Math.round((roundedDeliveryCharge + roundedCodCharge) * 100) / 100;

  return {
    pickupZoneId,
    dropZoneId,
    zoneType,
    volumetricWeight: roundedVolumetricWeight,
    billingWeight: roundedBillingWeight,
    deliveryCharge: roundedDeliveryCharge,
    codCharge: roundedCodCharge,
    totalCharge,
    rateCardId: rateCard.id
  };
}

/**
 * Finds the nearest available agent to a pickup location.
 * Returns the agent profile and distance, or null if no agents are available.
 */
function findNearestAvailableAgent(pickupLat, pickupLng, agents) {
  const availableAgents = agents.filter(agt => agt.status === 'AVAILABLE');
  if (availableAgents.length === 0) return null;

  let nearestAgent = null;
  let minDistance = Infinity;

  for (const agent of availableAgents) {
    const distance = getHaversineDistance(pickupLat, pickupLng, agent.currentLat, agent.currentLng);
    if (distance < minDistance) {
      minDistance = distance;
      nearestAgent = agent;
    }
  }

  return {
    agent: nearestAgent,
    distanceKm: Math.round(minDistance * 100) / 100
  };
}

module.exports = {
  getHaversineDistance,
  detectZone,
  calculateDeliveryCharge,
  findNearestAvailableAgent
};
