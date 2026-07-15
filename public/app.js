// Global App State
let currentUser = null;
let zones = [];

// XSS Sanitizer Helper
function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
let rateCards = [];
let agents = [];
let orders = [];
let activeOrderHistoryId = null;

// Map state
let map = null;
let pickupMarker = null;
let dropMarker = null;
let agentMarkers = {};
let zoneCircles = [];
let pinMode = null;

// Coordinates (Pune NCR defaults)
let pickupCoord = [18.5204, 73.8567]; // Shaniwar Wada, Pune Central
let dropCoord = [18.5913, 73.7389];  // Hinjawadi Phase 1

// API Helper
async function apiRequest(url, method = 'GET', body = null) {
  const token = sessionStorage.getItem('token');
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  } catch (error) {
    console.error(`API Error (${method} ${url}):`, error);
    showToast(error.message, 'error');
    throw error;
  }
}

// Toast Alert — announces to screen readers via aria-live region
function showToast(message, type = 'success') {
  // Announce to screen readers first
  const liveRegion = document.getElementById('toast-live-region');
  if (liveRegion) {
    liveRegion.textContent = '';
    // Slight delay forces screen readers to re-announce even identical messages
    setTimeout(() => { liveRegion.textContent = message; }, 50);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.innerHTML = `
    <div class="toast-body">
      <span>${message}</span>
    </div>
  `;
  document.body.appendChild(toast);
  
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    left: '24px',
    backgroundColor: type === 'success' ? 'var(--status-delivered)' : 'var(--status-failed)',
    color: 'white',
    padding: '0.75rem 1.25rem',
    borderRadius: '8px',
    boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
    zIndex: '9999',
    fontSize: '0.85rem',
    fontWeight: '600',
    transition: 'all 0.3s ease',
    transform: 'translateY(100px)',
    opacity: '0'
  });
  
  setTimeout(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  }, 10);

  setTimeout(() => {
    toast.style.transform = 'translateY(100px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Initialize Leaflet Map (centered in Pune Central)
function initMap() {
  if (map) return;

  map = L.map('map-container', {
    zoomControl: true,
    attributionControl: false
  }).setView([18.5204, 73.8567], 12);

  // CartoDB Dark Matter tile provider
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(map);

  const pickupIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  const dropIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  pickupMarker = L.marker(pickupCoord, { icon: pickupIcon, draggable: true }).addTo(map);
  dropMarker = L.marker(dropCoord, { icon: dropIcon, draggable: true }).addTo(map);

  pickupMarker.bindPopup('<b>Pickup Point</b>').openPopup();
  dropMarker.bindPopup('<b>Drop-off Point</b>');

  // Marker drag end listeners
  pickupMarker.on('dragend', function () {
    const latlng = pickupMarker.getLatLng();
    pickupCoord = [latlng.lat, latlng.lng];
    document.getElementById('pickup-coord-text').innerText = `Lat: ${latlng.lat.toFixed(4)}, Lng: ${latlng.lng.toFixed(4)}`;
    updatePricingEstimate();
  });

  dropMarker.on('dragend', function () {
    const latlng = dropMarker.getLatLng();
    dropCoord = [latlng.lat, latlng.lng];
    document.getElementById('drop-coord-text').innerText = `Lat: ${latlng.lat.toFixed(4)}, Lng: ${latlng.lng.toFixed(4)}`;
    updatePricingEstimate();
  });

  // Map click listener
  map.on('click', function (e) {
    const { lat, lng } = e.latlng;
    
    if (pinMode === 'pickup') {
      pickupCoord = [lat, lng];
      pickupMarker.setLatLng(pickupCoord);
      document.getElementById('pickup-coord-text').innerText = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
      updatePricingEstimate();
    } else if (pinMode === 'drop') {
      dropCoord = [lat, lng];
      dropMarker.setLatLng(dropCoord);
      document.getElementById('drop-coord-text').innerText = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
      updatePricingEstimate();
    } else if (pinMode === 'agent-move') {
      if (currentUser && currentUser.role === 'agent') {
        updateAgentLocation(lat, lng);
      }
    }
  });
}

// Redraw Pune geofence circles
function drawZones() {
  zoneCircles.forEach(circle => map.removeLayer(circle));
  zoneCircles = [];

  zones.forEach(zone => {
    const color = zone.id === 'zone_a' ? 'var(--color-primary)' : 'var(--color-accent)';
    
    const circle = L.circle([zone.lat, zone.lng], {
      color: color,
      fillColor: color,
      fillOpacity: 0.08,
      radius: zone.radiusKm * 1000,
      interactive: false
    }).addTo(map);
    zoneCircles.push(circle);
  });
}

// Draw agent markers
function drawAgents() {
  Object.values(agentMarkers).forEach(marker => map.removeLayer(marker));
  agentMarkers = {};

  const agentIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  agents.forEach(agent => {
    if (agent.status === 'OFFLINE') return;
    
    const statusText = agent.status === 'AVAILABLE' ? 'Available' : 'On Delivery';
    const marker = L.marker([agent.currentLat, agent.currentLng], { icon: agentIcon }).addTo(map);
    
    marker.bindPopup(`
      <div style="font-family: var(--font-family); font-size:0.75rem;">
        <h4>${agent.name}</h4>
        <p>Status: <b>${statusText}</b></p>
      </div>
    `);
    
    agentMarkers[agent.id] = marker;
  });
}

// Check session on startup
async function checkSession() {
  try {
    const data = await apiRequest('/api/auth/me');
    if (data.user) {
      currentUser = data.user;
      renderDashboard();
    } else {
      showLoginScreen();
    }
  } catch (error) {
    showLoginScreen();
  }
}

// Show login container
function showLoginScreen() {
  currentUser = null;
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  document.getElementById('login-container').style.display = 'grid';
  document.getElementById('dashboard-container').style.display = 'none';
  const form = document.getElementById('aws-login-form');
  if (form) form.reset();
}

// Toggle Admin On-Behalf customer dropdown
async function updateOnBehalfDropdownState(activeView) {
  const group = document.getElementById('group-on-behalf');
  if (!group) return;

  if (currentUser?.role === 'admin' && activeView === 'customer') {
    group.style.display = 'flex';
    try {
      const customers = await apiRequest('/api/customers');
      const select = document.getElementById('booking-on-behalf-select');
      if (select) {
        select.innerHTML = customers.map(c => 
          `<option value="${c.id}">${escapeHTML(c.name)} (${escapeHTML(c.email)})</option>`
        ).join('');
      }
    } catch (e) {
      console.error('Error fetching customers:', e);
    }
  } else {
    group.style.display = 'none';
  }
}

// Show dashboard container and load role panels
function renderDashboard() {
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('dashboard-container').style.display = 'block';

  document.getElementById('display-user-name').innerText = currentUser.name;
  document.getElementById('display-user-role').innerText = currentUser.role;

  // Show only relevant role workspace panel
  document.querySelectorAll('.role-workspace').forEach(ws => {
    ws.classList.remove('active');
  });

  const activeWs = document.getElementById(`workspace-${currentUser.role}`);
  if (activeWs) activeWs.classList.add('active');

  // Handle Admin Workspace Switcher
  const switcher = document.getElementById('admin-workspace-switcher');
  if (currentUser.role === 'admin') {
    switcher.style.display = 'flex';
    // Reset switcher buttons active state
    document.querySelectorAll('.btn-switch-view').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === 'admin');
    });
  } else {
    switcher.style.display = 'none';
  }

  // Trigger leaflet map setup
  initMap();
  
  if (currentUser.role === 'customer') {
    setPinMode('pickup');
  } else {
    setPinMode(null);
  }

  updateOnBehalfDropdownState(currentUser.role);
  refreshAllData();
}

function setPinMode(mode) {
  pinMode = mode;
  const btnPickup = document.getElementById('btn-pick-pickup');
  const btnDrop = document.getElementById('btn-pick-drop');
  
  if (btnPickup) btnPickup.classList.toggle('active', mode === 'pickup');
  if (btnDrop) btnDrop.classList.toggle('active', mode === 'drop');
}

// Refresh operations data
async function refreshAllData() {
  if (!currentUser) return;

  try {
    // 1. Fetch Zones & Draw
    zones = await apiRequest('/api/zones');
    drawZones();

    // 2. Fetch Agents & Draw
    agents = await apiRequest('/api/agents');
    drawAgents();

    // 3. Fetch Rate Cards
    rateCards = await apiRequest('/api/rates');
    
    // 4. Fill UI
    populateAdminFilters();
    renderRateCardsEditor();
    renderZonesList();

    // 5. Fetch Orders
    orders = await apiRequest('/api/orders');
    renderOrders();

    // 6. Notifications
    await updateNotificationLogs();

    // 7. Update Agent view fields
    if (currentUser.role === 'agent' || currentUser.role === 'admin') {
      const targetUserId = currentUser.role === 'agent' ? currentUser.id : (agents[0]?.userId);
      const profile = agents.find(a => a.userId === targetUserId);
      if (profile) {
        const latDisplay = document.getElementById('agent-lat-display');
        const lngDisplay = document.getElementById('agent-lng-display');
        const dutyStatus = document.getElementById('agent-duty-status');
        if (latDisplay) latDisplay.innerText = profile.currentLat.toFixed(4);
        if (lngDisplay) lngDisplay.innerText = profile.currentLng.toFixed(4);
        if (dutyStatus) dutyStatus.value = profile.status;
      }
    }

    updatePricingEstimate();
  } catch (error) {
    console.error('Error refreshing state:', error);
  }
}

// Real-time Pricing Preview engine
async function updatePricingEstimate() {
  if (currentUser?.role !== 'customer' && currentUser?.role !== 'admin') return;

  const length = document.getElementById('pkg-length').value;
  const width = document.getElementById('pkg-width').value;
  const height = document.getElementById('pkg-height').value;
  const weight = document.getElementById('pkg-weight').value;
  const orderType = document.getElementById('order-type').value;
  const paymentType = document.getElementById('payment-type').value;

  try {
    const result = await apiRequest('/api/orders/estimate', 'POST', {
      pickupLat: pickupCoord[0],
      pickupLng: pickupCoord[1],
      dropLat: dropCoord[0],
      dropLng: dropCoord[1],
      length,
      width,
      height,
      actualWeight: weight,
      orderType,
      paymentType
    });

    // Calculate Haversine distance
    const lat1 = pickupCoord[0];
    const lon1 = pickupCoord[1];
    const lat2 = dropCoord[0];
    const lon2 = dropCoord[1];
    
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;

    document.getElementById('calc-vol-weight').innerText = `${result.volumetricWeight.toFixed(2)} kg`;
    document.getElementById('calc-charge-weight').innerText = `${result.billingWeight.toFixed(2)} kg`;
    document.getElementById('calc-distance').innerText = `${distanceKm.toFixed(2)} km`;
    document.getElementById('calc-zone-type').innerText = result.zoneType + (result.pickupZoneId ? ` (${result.pickupZoneId.toUpperCase()})` : ' (OUTSIDE)');
    document.getElementById('calc-delivery-charge').innerText = `₹${result.deliveryCharge.toFixed(2)}`;
    
    const codRow = document.getElementById('calc-cod-row');
    if (paymentType === 'COD') {
      codRow.style.display = 'flex';
      document.getElementById('calc-cod-charge').innerText = `₹${result.codCharge.toFixed(2)}`;
    } else {
      codRow.style.display = 'none';
    }
    
    document.getElementById('calc-total-charge').innerText = `₹${result.totalCharge.toFixed(2)}`;
  } catch (error) {
    // Incomplete inputs
  }
}

// Populate Admin UI dropdown filters
function populateAdminFilters() {
  if (currentUser?.role !== 'admin') return;

  const zoneFilter = document.getElementById('admin-filter-zone');
  const agentFilter = document.getElementById('admin-filter-agent');

  const prevZone = zoneFilter.value;
  const prevAgent = agentFilter.value;

  zoneFilter.innerHTML = '<option value="">All Zones</option>';
  zones.forEach(z => {
    zoneFilter.innerHTML += `<option value="${z.id}">${z.name}</option>`;
  });

  agentFilter.innerHTML = '<option value="">All Agents</option>';
  agents.forEach(a => {
    agentFilter.innerHTML += `<option value="${a.id}">${a.name}</option>`;
  });

  zoneFilter.value = prevZone;
  agentFilter.value = prevAgent;
}

function renderRateCardsEditor() {
  const container = document.getElementById('rates-editor-container');
  if (!container) return;

  container.innerHTML = '';

  rateCards.forEach(rc => {
    const card = document.createElement('div');
    card.className = 'rate-editor-card';
    card.innerHTML = `
      <div class="rate-card-title">
        <strong>${rc.orderType}</strong> <span>${rc.zoneType}</span>
      </div>
      <form class="rate-card-form" data-id="${rc.id}">
        <div class="rate-inputs-row">
          <div class="form-group">
            <label>Base Price (₹)</label>
            <input type="number" step="1" name="basePrice" value="${rc.basePrice}">
          </div>
          <div class="form-group">
            <label>Base Weight (kg)</label>
            <input type="number" step="0.1" name="baseWeightKg" value="${rc.baseWeightKg}">
          </div>
        </div>
        <div class="rate-inputs-row">
          <div class="form-group">
            <label>Per Kg Rate (₹)</label>
            <input type="number" step="1" name="perKgRate" value="${rc.perKgRate}">
          </div>
          <div class="form-group">
            <label>COD Surcharge (₹)</label>
            <input type="number" step="1" name="codSurchargeFlat" value="${rc.codSurchargeFlat}">
          </div>
        </div>
        <div class="rate-inputs-row">
          <div class="form-group">
            <label>COD Percentage (%)</label>
            <input type="number" step="0.1" name="codSurchargePct" value="${rc.codSurchargePct}">
          </div>
          <div class="form-group">
            <label>Base Distance (km)</label>
            <input type="number" step="0.1" name="baseDistanceKm" value="${rc.baseDistanceKm || 10}">
          </div>
        </div>
        <div class="rate-inputs-row">
          <div class="form-group">
            <label>Per Km (Distance) (₹)</label>
            <input type="number" step="0.1" name="perKmRateDistance" value="${rc.perKmRateDistance || 5}">
          </div>
          <button type="submit" class="btn btn-secondary btn-small" style="align-self: flex-end; height: 32px; width: 100%;">
            <i data-lucide="save"></i> Save Rates
          </button>
        </div>
      </form>
    `;
    container.appendChild(card);
  });

  lucide.createIcons({ attrs: { class: 'lucide' } });

  document.querySelectorAll('.rate-card-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rcId = form.dataset.id;
      const formData = new FormData(form);
      const payload = {
        basePrice: parseFloat(formData.get('basePrice')),
        baseWeightKg: parseFloat(formData.get('baseWeightKg')),
        perKgRate: parseFloat(formData.get('perKgRate')),
        codSurchargeFlat: parseFloat(formData.get('codSurchargeFlat')),
        codSurchargePct: parseFloat(formData.get('codSurchargePct')),
        baseDistanceKm: parseFloat(formData.get('baseDistanceKm')),
        perKmRateDistance: parseFloat(formData.get('perKmRateDistance'))
      };

      try {
        await apiRequest(`/api/rates/${rcId}`, 'PUT', payload);
        showToast('Rate card values modified successfully!');
        refreshAllData();
      } catch (error) {}
    });
  });
}

// Render Zones List
function renderZonesList() {
  const tbody = document.querySelector('#admin-zones-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (zones.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: var(--text-muted); padding: 1rem;">No zones registered in the system. Add one above.</td></tr>';
  } else {
    zones.forEach(zone => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHTML(zone.name)}</strong><br><span style="font-size:0.72rem;color:var(--text-muted);">${escapeHTML(zone.description || '')}</span></td>
        <td>${zone.lat.toFixed(4)}, ${zone.lng.toFixed(4)}</td>
        <td>${zone.radiusKm} km</td>
        <td>
          <div style="display: flex; gap: 5px;">
            <button class="btn btn-secondary btn-small btn-view-zone-on-map" data-lat="${zone.lat}" data-lng="${zone.lng}">
              <i data-lucide="map-pin"></i> Center Map
            </button>
            <button class="btn btn-danger btn-small btn-delete-zone" data-id="${zone.id}">
              <i data-lucide="trash-2"></i> Delete
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  lucide.createIcons();

  document.querySelectorAll('.btn-view-zone-on-map').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.lat);
      const lng = parseFloat(btn.dataset.lng);
      map.setView([lat, lng], 12);
    });
  });

  document.querySelectorAll('.btn-delete-zone').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete this circular zone?')) {
        try {
          await apiRequest(`/api/zones/${btn.dataset.id}`, 'DELETE');
          showToast('Zone removed from registry.');
          refreshAllData();
        } catch (error) {}
      }
    });
  });
}

// Render Orders lists
function renderOrders() {
  updateAdminMetrics();

  // 1. Customer Orders
  const custTable = document.querySelector('#customer-orders-table tbody');
  if (custTable && (currentUser?.role === 'customer' || currentUser?.role === 'admin')) {
    custTable.innerHTML = '';
    const custOrders = currentUser.role === 'customer'
      ? orders.filter(o => o.customerId === currentUser.id)
      : orders;
    
    if (custOrders.length === 0) {
      custTable.innerHTML = '<tr><td colspan="8" class="text-center">No orders found. Book a delivery to start.</td></tr>';
    } else {
      custOrders.forEach(o => {
        const tr = document.createElement('tr');
        const badge = getStatusBadge(o.status);
        const actionBtn = o.status === 'Failed' 
          ? `<button class="btn btn-primary btn-small btn-reschedule" data-id="${o.id}"><i data-lucide="calendar"></i> Reschedule</button>` 
          : `<button class="btn btn-secondary btn-small btn-view-history" data-id="${o.id}"><i data-lucide="eye"></i> Track</button>`;
          
        tr.innerHTML = `
          <td><strong style="color:var(--color-primary);">${o.id}</strong></td>
          <td>${new Date(o.createdAt).toLocaleDateString()}</td>
          <td><span title="${escapeHTML(o.pickupAddress)}">Pickup</span> &rarr; <span title="${escapeHTML(o.dropAddress)}">Drop</span></td>
          <td>${o.orderType} (${o.billingWeight}kg)</td>
          <td><strong>₹${o.totalCharge.toFixed(2)}</strong></td>
          <td>${badge}</td>
          <td>${o.agentName ? escapeHTML(o.agentName) : '<span style="color:var(--text-muted);">Allocating...</span>'}</td>
          <td>${actionBtn}</td>
        `;
        custTable.appendChild(tr);
      });
    }
  }

  // 2. Admin Orders
  const adminTable = document.querySelector('#admin-orders-table tbody');
  if (adminTable && currentUser?.role === 'admin') {
    adminTable.innerHTML = '';
    
    if (orders.length === 0) {
      adminTable.innerHTML = '<tr><td colspan="7" class="text-center">No delivery logs recorded in the system.</td></tr>';
    } else {
      orders.forEach(o => {
        const tr = document.createElement('tr');
        const badge = getStatusBadge(o.status);
        
        let assignmentControl = '';
        if (o.status === 'Placed' || o.status === 'Rescheduled') {
          assignmentControl = `
            <button class="btn btn-primary btn-small btn-assign-modal-open" data-id="${o.id}">
              <i data-lucide="user-plus"></i> Allocate Agent
            </button>
          `;
        } else {
          assignmentControl = `<span style="font-size:0.78rem;font-weight:500;">${escapeHTML(o.agentName || 'Unassigned')}</span>`;
        }

        tr.innerHTML = `
          <td><strong style="color:var(--color-primary);">${o.id}</strong></td>
          <td>${escapeHTML(o.customerName || 'Customer')}<br><span style="font-size:0.72rem;color:var(--text-muted);">${escapeHTML(o.customerEmail || '')}</span></td>
          <td>${o.orderType} (${o.billingWeight}kg)</td>
          <td><strong>₹${o.totalCharge.toFixed(2)}</strong></td>
          <td>
            <select class="admin-override-select" data-id="${o.id}">
              <option value="Placed" ${o.status === 'Placed' ? 'selected' : ''}>Placed</option>
              <option value="Assigned" ${o.status === 'Assigned' ? 'selected' : ''}>Assigned</option>
              <option value="Picked Up" ${o.status === 'Picked Up' ? 'selected' : ''}>Picked Up</option>
              <option value="In Transit" ${o.status === 'In Transit' ? 'selected' : ''}>In Transit</option>
              <option value="Out for Delivery" ${o.status === 'Out for Delivery' ? 'selected' : ''}>Out for Delivery</option>
              <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
              <option value="Failed" ${o.status === 'Failed' ? 'selected' : ''}>Failed</option>
              <option value="Rescheduled" ${o.status === 'Rescheduled' ? 'selected' : ''}>Rescheduled</option>
            </select>
          </td>
          <td>${assignmentControl}</td>
          <td>
            <button class="btn btn-secondary btn-small btn-view-history" data-id="${o.id}"><i data-lucide="clock"></i> History</button>
          </td>
        `;
        adminTable.appendChild(tr);
      });
    }
  }

  // 3. Agent Tasks
  const agentTasksContainer = document.getElementById('agent-orders-container');
  if (agentTasksContainer && currentUser?.role === 'agent') {
    agentTasksContainer.innerHTML = '';
    
    const activeAgent = agents.find(a => a.userId === currentUser.id);
    const agentOrders = orders.filter(o => o.agentId === (activeAgent ? activeAgent.id : null));

    if (agentOrders.length === 0) {
      agentTasksContainer.innerHTML = `
        <div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.8rem;">
          <p>No active delivery runs assigned to your queue.</p>
        </div>
      `;
    } else {
      agentOrders.forEach(o => {
        const card = document.createElement('div');
        card.className = 'agent-order-card';
        const badge = getStatusBadge(o.status);
        
        let actionsHtml = '';
        if (o.status === 'Assigned') {
          actionsHtml = `<button class="btn btn-primary btn-small btn-agent-status" data-id="${o.id}" data-status="Picked Up">Mark Picked Up</button>`;
        } else if (o.status === 'Picked Up') {
          actionsHtml = `<button class="btn btn-primary btn-small btn-agent-status" data-id="${o.id}" data-status="In Transit">Mark In Transit</button>`;
        } else if (o.status === 'In Transit') {
          actionsHtml = `<button class="btn btn-primary btn-small btn-agent-status" data-id="${o.id}" data-status="Out for Delivery">Mark Out for Delivery</button>`;
        } else if (o.status === 'Out for Delivery') {
          actionsHtml = `
            <button class="btn btn-primary btn-small btn-agent-status" data-id="${o.id}" data-status="Delivered">Mark Delivered</button>
            <button class="btn btn-danger btn-small btn-agent-failed-open" data-id="${o.id}">Mark Failed</button>
          `;
        }

        card.innerHTML = `
          <div class="agent-card-header">
            <span class="agent-card-id">${o.id}</span>
            ${badge}
          </div>
          <div class="agent-card-details">
            <div><span>Pickup:</span> <strong>${escapeHTML(o.pickupAddress)}</strong></div>
            <div><span>Dropoff:</span> <strong>${escapeHTML(o.dropAddress)}</strong></div>
            <div><span>Bill Weight:</span> <strong>${o.billingWeight} kg</strong></div>
            <div><span>COD / Amount:</span> <strong>${o.paymentType} (₹${o.totalCharge.toFixed(2)})</strong></div>
          </div>
          <div class="agent-card-actions">
            ${actionsHtml}
            <button class="btn btn-secondary btn-small btn-view-history" data-id="${o.id}"><i data-lucide="clock"></i> History</button>
          </div>
        `;
        agentTasksContainer.appendChild(card);
      });
    }
  }

  // 4. Admin Agent Registry Table
  const agentTable = document.querySelector('#admin-agents-table tbody');
  if (agentTable && currentUser?.role === 'admin') {
    agentTable.innerHTML = '';
    if (agents.length === 0) {
      agentTable.innerHTML = '<tr><td colspan="7" class="text-center" style="color: var(--text-muted); padding: 1rem;">No delivery agents registered in the registry.</td></tr>';
    } else {
      agents.forEach(a => {
        const statusBadge = a.status === 'AVAILABLE' 
          ? '<span class="badge badge-delivered">AVAILABLE</span>' 
          : (a.status === 'BUSY' ? '<span class="badge badge-intransit">BUSY</span>' : '<span class="badge badge-failed">OFFLINE</span>');
          
        const verifyBadge = a.isVerified 
          ? '<span class="badge badge-delivered">Verified</span>' 
          : '<span class="badge badge-failed">Pending</span>';

        const verifyButton = !a.isVerified 
          ? `<button class="btn btn-primary btn-small btn-verify-agent" data-id="${a.id}"><i data-lucide="shield-check"></i> Verify</button>` 
          : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${a.id}</strong></td>
          <td>${a.name}</td>
          <td>${statusBadge}</td>
          <td>${verifyBadge}</td>
          <td>${a.currentLat.toFixed(6)}</td>
          <td>${a.currentLng.toFixed(6)}</td>
          <td>
            <div style="display: flex; gap: 5px;">
              ${verifyButton}
              <button class="btn btn-secondary btn-small btn-view-agent-on-map" data-lat="${a.currentLat}" data-lng="${a.currentLng}">
                <i data-lucide="map-pin"></i> Center Map
              </button>
            </div>
          </td>
        `;
        agentTable.appendChild(tr);
      });
    }
  }

  lucide.createIcons();
  setupOrderActionListeners();
}

// Action button click handlers
function setupOrderActionListeners() {
  document.querySelectorAll('.btn-view-history').forEach(btn => {
    btn.addEventListener('click', () => {
      openTrackingHistory(btn.dataset.id);
    });
  });

  document.querySelectorAll('.btn-reschedule').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('reschedule-order-id').value = btn.dataset.id;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      document.getElementById('reschedule-date').value = tomorrow.toISOString().split('T')[0];
      openModal('reschedule-modal');
    });
  });

  document.querySelectorAll('.btn-assign-modal-open').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      document.getElementById('assign-order-id').value = orderId;
      
      const select = document.getElementById('assign-agent-select');
      select.innerHTML = '';
      
      const available = agents.filter(a => a.status === 'AVAILABLE');
      if (available.length === 0) {
        select.innerHTML = '<option value="">No agents available</option>';
      } else {
        available.forEach(a => {
          select.innerHTML += `<option value="${a.id}">${a.name}</option>`;
        });
      }

      openModal('assign-modal');
    });
  });

  document.querySelectorAll('.admin-override-select').forEach(select => {
    select.addEventListener('change', async () => {
      const orderId = select.dataset.id;
      const status = select.value;
      
      try {
        await apiRequest(`/api/orders/${orderId}/status`, 'POST', {
          status,
          notes: 'Status overridden manually by Admin override dashboard.'
        });
        showToast(`Order status updated to ${status}`);
        refreshAllData();
      } catch (error) {
        refreshAllData();
      }
    });
  });

  document.querySelectorAll('.btn-agent-status').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      const status = btn.dataset.status;
      try {
        await apiRequest(`/api/orders/${orderId}/status`, 'POST', { status });
        showToast(`Updated order status to: ${status}`);
        refreshAllData();
      } catch (error) {}
    });
  });

  document.querySelectorAll('.btn-agent-failed-open').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = prompt('Please enter failure reason:');
      if (reason === null) return;
      
      const orderId = btn.dataset.id;
      try {
        await apiRequest(`/api/orders/${orderId}/status`, 'POST', { 
          status: 'Failed',
          notes: reason || 'Delivery attempted but failed.'
        });
        showToast('Order marked Failed.');
        refreshAllData();
      } catch (error) {}
    });
  });

  document.querySelectorAll('.btn-view-agent-on-map').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.lat);
      const lng = parseFloat(btn.dataset.lng);
      map.setView([lat, lng], 14);
    });
  });

  document.querySelectorAll('.btn-verify-agent').forEach(btn => {
    btn.addEventListener('click', async () => {
      const agentId = btn.dataset.id;
      try {
        await apiRequest(`/api/agents/${agentId}/verify`, 'POST');
        showToast('Agent verified successfully.');
        refreshAllData();
      } catch (error) {}
    });
  });
}

// Load and show tracking timeline
async function openTrackingHistory(orderId) {
  try {
    const result = await apiRequest(`/api/orders/${orderId}/history`);
    const { order, history } = result;

    activeOrderHistoryId = orderId;
    document.getElementById('history-order-id').innerText = order.id;
    document.getElementById('history-route-text').innerText = `${order.pickupAddress} → ${order.dropAddress}`;
    
    const badge = getStatusBadge(order.status);
    const badgeContainer = document.getElementById('history-status-badge');
    badgeContainer.className = 'badge';
    badgeContainer.innerHTML = badge;

    const timelineContainer = document.getElementById('history-timeline-events');
    timelineContainer.innerHTML = '';

    history.forEach((h, index) => {
      const timeStr = new Date(h.timestamp).toLocaleString();
      const isActive = index === history.length - 1;
      
      const item = document.createElement('div');
      item.className = `timeline-item ${isActive ? 'active' : ''}`;
      item.innerHTML = `
        <div class="timeline-dot"></div>
        <div class="timeline-time">${timeStr}</div>
        <div class="timeline-status">${h.status}</div>
        <div class="timeline-actor">By ${h.actorRole.toUpperCase()}</div>
        ${h.notes ? `<div class="timeline-notes">${escapeHTML(h.notes)}</div>` : ''}
      `;
      timelineContainer.appendChild(item);
    });

    document.getElementById('order-history-panel').style.display = 'flex';
    
    const bounds = L.latLngBounds([order.pickupLat, order.pickupLng], [order.dropLat, order.dropLng]);
    map.fitBounds(bounds, { padding: [50, 50] });

  } catch (error) {}
}

// Badge html helpers
function getStatusBadge(status) {
  let cls = 'badge-placed';
  switch (status) {
    case 'Assigned': cls = 'badge-assigned'; break;
    case 'Picked Up': cls = 'badge-pickedup'; break;
    case 'In Transit': cls = 'badge-intransit'; break;
    case 'Out for Delivery': cls = 'badge-out'; break;
    case 'Delivered': cls = 'badge-delivered'; break;
    case 'Failed': cls = 'badge-failed'; break;
    case 'Rescheduled': cls = 'badge-rescheduled'; break;
  }
  return `<span class="badge ${cls}">${status}</span>`;
}

// Set Admin dashboard values
function updateAdminMetrics() {
  if (currentUser?.role !== 'admin') return;
  
  document.getElementById('metric-total-orders').innerText = orders.length;
  document.getElementById('metric-total-zones').innerText = zones.length;
  
  const activeAgts = agents.filter(a => a.status === 'AVAILABLE').length;
  document.getElementById('metric-active-agents').innerText = activeAgts;
  
  const pending = orders.filter(o => o.status === 'Placed' || o.status === 'Rescheduled').length;
  document.getElementById('metric-pending-orders').innerText = pending;
}

// Fetch simulated SMS and Email logs
async function updateNotificationLogs() {
  try {
    const logs = await apiRequest('/api/notifications');
    const container = document.getElementById('notification-logs-container');
    if (!container) return;

    container.innerHTML = '';
    if (logs.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:0.7rem;padding:0.4rem;">Inbox empty. Logs will appear here.</div>';
      return;
    }

    logs.forEach(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      const div = document.createElement('div');
      div.className = `console-log-item ${log.type}`;
      div.innerHTML = `
        <div class="console-log-meta">
          <span class="console-log-type">${log.type} &rarr; ${log.recipient}</span>
          <span>${time}</span>
        </div>
        <div class="console-log-msg">${log.message}</div>
      `;
      container.appendChild(div);
    });
  } catch (error) {}
}

// Update Agent Location coordinates
async function updateAgentLocation(lat, lng) {
  let targetAgentId = null;
  if (currentUser.role === 'agent') {
    const profile = agents.find(a => a.userId === currentUser.id);
    if (profile) targetAgentId = profile.id;
  } else if (currentUser.role === 'admin') {
    if (agents.length > 0) targetAgentId = agents[0].id;
  }

  if (!targetAgentId) {
    showToast('No active agent profile to simulate location for.', 'error');
    return;
  }

  try {
    await apiRequest(`/api/agents/${targetAgentId}/location`, 'POST', {
      lat,
      lng
    });
    showToast(`Simulated coordinate location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    setPinMode(null);
    const btnAgentMode = document.getElementById('btn-agent-pin-mode');
    if (btnAgentMode) btnAgentMode.classList.remove('active');
    refreshAllData();
  } catch (error) {}
}

// ─── Accessibility Utilities ───────────────────────────────────────────────────

/**
 * Returns all keyboard-focusable elements within a container.
 */
function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
}

/**
 * Trap focus within a modal element.
 * @param {HTMLElement} modal
 * @param {KeyboardEvent} e
 */
function trapFocus(modal, e) {
  const focusable = getFocusableElements(modal);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  if (e.key === 'Tab') {
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  }
}

// Track which element triggered a modal open (to restore focus on close)
let _lastFocusedElement = null;

/**
 * Open a modal: add .active, set ARIA, focus first element, save trigger.
 */
function openModal(modalId) {
  _lastFocusedElement = document.activeElement;
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('active');
  modal.removeAttribute('aria-hidden');
  const focusable = getFocusableElements(modal);
  if (focusable.length > 0) focusable[0].focus();
}

/**
 * Close a modal: remove .active, set ARIA hidden, restore focus.
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  if (_lastFocusedElement) { _lastFocusedElement.focus(); _lastFocusedElement = null; }
}

// --- DOM INTERACTION HANDLERS ---
document.addEventListener('DOMContentLoaded', () => {
  // Read session state on launch
  checkSession();

  // Workspace Switcher clicks (Admin View toggles)
  document.querySelectorAll('.btn-switch-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = btn.dataset.view;
      
      document.querySelectorAll('.btn-switch-view').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      document.querySelectorAll('.role-workspace').forEach(ws => ws.classList.remove('active'));
      const targetWs = document.getElementById(`workspace-${view}`);
      if (targetWs) targetWs.classList.add('active');
      
      if (view === 'customer') {
        setPinMode('pickup');
        updatePricingEstimate();
      } else {
        setPinMode(null);
      }
      updateOnBehalfDropdownState(view);
    });
  });

  // Toggle between login and register
  document.getElementById('link-show-signup').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('signin-section').style.display = 'none';
    document.getElementById('signup-section').style.display = 'block';
  });

  document.getElementById('link-show-signin').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('signup-section').style.display = 'none';
    document.getElementById('signin-section').style.display = 'block';
  });

  // AWS IAM Login Form Submit
  document.getElementById('aws-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const data = await apiRequest('/api/auth/login', 'POST', { email, password });
      showToast(data.message);
      
      // Store token and user inside sessionStorage for isolated multiple tabs support
      sessionStorage.setItem('token', data.token);
      sessionStorage.setItem('user', JSON.stringify(data.user));
      
      currentUser = data.user;
      renderDashboard();
    } catch (error) {}
  });

  // AWS IAM Register Form Submit
  document.getElementById('aws-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const role = document.getElementById('register-role').value;

    try {
      const data = await apiRequest('/api/auth/register', 'POST', { name, email, password, role });
      showToast(data.message);
      
      if (role === 'agent') {
        // Clear form and go back to sign in
        document.getElementById('aws-register-form').reset();
        document.getElementById('signup-section').style.display = 'none';
        document.getElementById('signin-section').style.display = 'block';
      } else {
        // Customer registers and logs in immediately
        sessionStorage.setItem('token', data.token);
        sessionStorage.setItem('user', JSON.stringify(data.user));
        
        currentUser = data.user;
        renderDashboard();
      }
    } catch (error) {}
  });

  // Logout Trigger
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      await apiRequest('/api/auth/logout', 'POST');
      // Clear tab-isolated authentication state
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      showToast('Signed out of LastMile Logistics successfully');
      showLoginScreen();
    } catch (error) {}
  });

  // Show password checkbox toggler
  document.getElementById('aws-show-password').addEventListener('change', (e) => {
    const pwdInput = document.getElementById('login-password');
    pwdInput.type = e.target.checked ? 'text' : 'password';
  });

  // Click selectors toggle listeners
  document.getElementById('btn-pick-pickup').addEventListener('click', () => setPinMode('pickup'));
  document.getElementById('btn-pick-drop').addEventListener('click', () => setPinMode('drop'));

  // Recalculates price on typing
  ['pkg-length', 'pkg-width', 'pkg-height', 'pkg-weight', 'order-type', 'payment-type'].forEach(id => {
    document.getElementById(id).addEventListener('change', updatePricingEstimate);
    document.getElementById(id).addEventListener('input', updatePricingEstimate);
  });

  // Customer order form submit
  document.getElementById('order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const pickupAddress = document.getElementById('pickup-address').value;
    const dropAddress = document.getElementById('drop-address').value;
    const length = document.getElementById('pkg-length').value;
    const width = document.getElementById('pkg-width').value;
    const height = document.getElementById('pkg-height').value;
    const weight = document.getElementById('pkg-weight').value;
    const orderType = document.getElementById('order-type').value;
    const paymentType = document.getElementById('payment-type').value;

    const payload = {
      pickupAddress,
      pickupLat: pickupCoord[0],
      pickupLng: pickupCoord[1],
      dropAddress,
      dropLat: dropCoord[0],
      dropLng: dropCoord[1],
      length,
      width,
      height,
      actualWeight: weight,
      orderType,
      paymentType
    };

    if (currentUser?.role === 'admin') {
      const select = document.getElementById('booking-on-behalf-select');
      if (select && select.value) {
        payload.onBehalfOfCustomerId = select.value;
      }
    }

    try {
      const order = await apiRequest('/api/orders', 'POST', payload);
      showToast(`Order #${order.id} placed successfully!`);
      refreshAllData();
      document.querySelector('.orders-panel').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {}
  });

  // Tab switching
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Create new zone submit
  document.getElementById('admin-zone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('zone-name').value;
    const lat = parseFloat(document.getElementById('zone-lat').value);
    const lng = parseFloat(document.getElementById('zone-lng').value);
    const radiusKm = parseFloat(document.getElementById('zone-radius').value);
    const description = document.getElementById('zone-desc').value;

    try {
      await apiRequest('/api/zones', 'POST', { name, lat, lng, radiusKm, description });
      showToast('Circular zone added successfully.');
      document.getElementById('admin-zone-form').reset();
      refreshAllData();
    } catch (error) {}
  });

  // Refresh admin list
  document.getElementById('btn-refresh-admin-orders').addEventListener('click', refreshAllData);

  // Admin filter dropdowns
  ['admin-filter-status', 'admin-filter-zone', 'admin-filter-agent'].forEach(id => {
    document.getElementById(id).addEventListener('change', async () => {
      const status = document.getElementById('admin-filter-status').value;
      const zoneId = document.getElementById('admin-filter-zone').value;
      const agentId = document.getElementById('admin-filter-agent').value;

      let url = '/api/orders?';
      if (status) url += `status=${status}&`;
      if (zoneId) url += `zoneId=${zoneId}&`;
      if (agentId) url += `agentId=${agentId}&`;

      try {
        orders = await apiRequest(url);
        renderOrders();
      } catch (error) {}
    });
  });

  // Agent duty toggle
  document.getElementById('agent-duty-status').addEventListener('change', async (e) => {
    let targetAgentId = null;
    if (currentUser.role === 'agent') {
      const profile = agents.find(a => a.userId === currentUser.id);
      if (profile) targetAgentId = profile.id;
    } else if (currentUser.role === 'admin') {
      if (agents.length > 0) targetAgentId = agents[0].id;
    }

    if (!targetAgentId) return;

    try {
      await apiRequest(`/api/agents/${targetAgentId}/location`, 'POST', {
        status: e.target.value
      });
      showToast(`Duty status: ${e.target.value}`);
      refreshAllData();
    } catch (error) {}
  });

  // Agent location pinpoint toggle
  document.getElementById('btn-agent-pin-mode').addEventListener('click', (e) => {
    if (pinMode === 'agent-move') {
      setPinMode(null);
      e.target.classList.remove('active');
    } else {
      setPinMode('agent-move');
      e.target.classList.add('active');
      showToast('Click on the map to relocate yourself.');
    }
  });

  // Modal closings — use closeModal() to restore focus on close
  document.getElementById('btn-close-history').addEventListener('click', () => {
    document.getElementById('order-history-panel').style.display = 'none';
    activeOrderHistoryId = null;
    if (_lastFocusedElement) { _lastFocusedElement.focus(); _lastFocusedElement = null; }
  });

  document.getElementById('btn-close-modal').addEventListener('click', () => {
    closeModal('reschedule-modal');
  });

  document.getElementById('btn-close-assign-modal').addEventListener('click', () => {
    closeModal('assign-modal');
  });

  // Global: Escape key closes open modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const rescheduleModal = document.getElementById('reschedule-modal');
      const assignModal     = document.getElementById('assign-modal');
      const historyPanel    = document.getElementById('order-history-panel');
      if (rescheduleModal?.classList.contains('active')) closeModal('reschedule-modal');
      else if (assignModal?.classList.contains('active'))     closeModal('assign-modal');
      else if (historyPanel?.style.display === 'flex') {
        historyPanel.style.display = 'none';
        activeOrderHistoryId = null;
        if (_lastFocusedElement) { _lastFocusedElement.focus(); _lastFocusedElement = null; }
      }
    }

    // Tab-trap inside open modals
    const rescheduleModal = document.getElementById('reschedule-modal');
    const assignModal     = document.getElementById('assign-modal');
    if (rescheduleModal?.classList.contains('active')) trapFocus(rescheduleModal, e);
    else if (assignModal?.classList.contains('active'))     trapFocus(assignModal, e);
  });

  // Customer reschedule submit
  document.getElementById('reschedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderId = document.getElementById('reschedule-order-id').value;
    const date = document.getElementById('reschedule-date').value;

    try {
      await apiRequest(`/api/orders/${orderId}/reschedule`, 'POST', { rescheduleDate: date });
      closeModal('reschedule-modal');
      showToast('Order rescheduled. Agent auto-allocation triggered.');
      refreshAllData();
      if (activeOrderHistoryId === orderId) {
        openTrackingHistory(orderId);
      }
    } catch (error) {}
  });

  // Admin Manual Allocate agent submit
  document.getElementById('assign-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderId = document.getElementById('assign-order-id').value;
    const agentId = document.getElementById('assign-agent-select').value;

    if (!agentId) {
      showToast('Please select a valid delivery agent.', 'error');
      return;
    }

    try {
      await apiRequest(`/api/orders/${orderId}/assign`, 'POST', { agentId });
      closeModal('assign-modal');
      showToast('Agent allocated successfully.');
      refreshAllData();
    } catch (error) {}
  });

  // Admin auto allocate agent
  document.getElementById('btn-trigger-auto-assign').addEventListener('click', async () => {
    const orderId = document.getElementById('assign-order-id').value;
    try {
      await apiRequest(`/api/orders/${orderId}/assign`, 'POST', { auto: true });
      closeModal('assign-modal');
      showToast('Agent auto-allocated based on closest physical distance.');
      refreshAllData();
    } catch (error) {}
  });

  // Pollers
  setInterval(async () => {
    if (currentUser) await updateNotificationLogs();
  }, 3500);

  setInterval(async () => {
    if (!currentUser) return;
    try {
      orders = await apiRequest('/api/orders');
      agents = await apiRequest('/api/agents');
      renderOrders();
      
      if (activeOrderHistoryId) {
        const result = await apiRequest(`/api/orders/${activeOrderHistoryId}/history`);
        const timelineContainer = document.getElementById('history-timeline-events');
        
        const badge = getStatusBadge(result.order.status);
        const badgeContainer = document.getElementById('history-status-badge');
        badgeContainer.className = 'badge';
        badgeContainer.innerHTML = badge;

        timelineContainer.innerHTML = '';
        result.history.forEach((h, index) => {
          const timeStr = new Date(h.timestamp).toLocaleString();
          const isActive = index === result.history.length - 1;
          const item = document.createElement('div');
          item.className = `timeline-item ${isActive ? 'active' : ''}`;
          item.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-time">${timeStr}</div>
            <div class="timeline-status">${h.status}</div>
            <div class="timeline-actor">By ${h.actorRole.toUpperCase()}</div>
            ${h.notes ? `<div class="timeline-notes">${escapeHTML(h.notes)}</div>` : ''}
          `;
          timelineContainer.appendChild(item);
        });
      }
    } catch (error) {}
  }, 4500);
});
