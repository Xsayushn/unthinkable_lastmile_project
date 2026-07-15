# Last-Mile Delivery Tracker

A modern, responsive delivery management and tracking platform built for Pune operations. This project implements role-based dashboards (Customer, Admin, Delivery Agent), circular zone mapping, dynamic volumetric weight calculations, B2B/B2C rate card config, and automated nearest-agent assignment.

---

## Setup & Running Guide

### Prerequisites
- [Node.js](https://nodejs.org/) (v16.0.0 or higher recommended)
- `npm` (Node Package Manager)

### Installation
1. Clone or extract the project source code.
2. Open terminal/command prompt in the project directory:
   ```bash
   npm install
   ```

### Running the Application Locally
To start the Express server and serve the front-end dashboard:
```bash
npm start
```
Once started, open [http://localhost:3000](http://localhost:3000) in your web browser.

### Live Deployment
The application is also deployed and accessible live at:
[https://unthinkable-lastmile-project.onrender.com/](https://unthinkable-lastmile-project.onrender.com/)


### Running Automated Pricing Tests
We have built an automated test runner for the logistics and pricing formulas scaled for Pune geofences:
```bash
npm test
```

---

## Demo Accounts & Test Credentials

Use these credentials on the AWS-style sign-in screen to access different platform views:

| Role | Username / Email Alias | Password | Purpose / Features |
|---|---|---|---|
| **Admin** | `admin` or `admin@tracker.com` | `admin123` | Control panel, switch active views, edit rate cards, and inspect system logs |
| **Customer (B2B)** | `customer` or `customer@tracker.com` | `customer123` | Tata Logistics view: book deliveries, calculate rates, and view live timeline tracking |
| **Customer (B2C)** | `ayush` or `ayush@tracker.com` | `tracker123` | Ayush view: place orders and reschedule failed delivery attempts |
| **Agent 1** | `agent1` or `agent1@tracker.com` | `tracker123` | Ramesh Kumar view: mark orders as Picked Up, In Transit, and update simulator GPS coordinates |
| **Agent 2** | `agent2` or `agent2@tracker.com` | `tracker123` | Suresh Singh view: view Hinjawadi queue and mark orders Delivered or Failed |

---

## Environment Configuration

A sample environment configuration file `.env.example` is provided in the project root. Create a copy named `.env` to configure variables:

```env
PORT=3000
JWT_SECRET=lastmile-secret-key-98765
```
*(No complex configurations or databases are required; everything runs on local Node.js static serving and file-based JSON storage).*

---

## Database Schema (`db.json`)

The application uses a lightweight local JSON database (`db.json`) seeded on startup with Pune NCR parameters:

### 1. `User` Schema
- `id` (String): Unique user identifier.
- `name` (String): User's full name.
- `email` (String): User's email.
- `passwordHash` (String): Salted password hash.
- `role` (String): Role of user (`admin` | `customer` | `agent`).
- `isVerified` (Boolean): User account verification status (defaults to `true` for Customers, `false` for Agents).
- `createdAt` (String): Timestamp.

### 2. `AgentProfile` Schema
- `id` (String): Agent unique identifier.
- `userId` (String): Maps to user ID.
- `name` (String): Name of agent.
- `status` (String): Duty status (`AVAILABLE` | `BUSY` | `OFFLINE`).
- `currentLat` (Number): Active latitude.
- `currentLng` (Number): Active longitude.

### 3. `Zone` Schema
- `id` (String): Circular zone identifier.
- `name` (String): Display name.
- `lat` (Number): Center point latitude coordinate.
- `lng` (Number): Center point longitude coordinate.
- `radiusKm` (Number): Circular radius size in kilometers.
- `description` (String): Summary notes.

### 4. `RateCard` Schema
- `id` (String): Rate identifier.
- `orderType` (String): Client contract tier (`B2B` | `B2C`).
- `zoneType` (String): Route type (`INTRA` | `INTER`).
- `basePrice` (Number): Fixed cost for base weight allowance (in ₹).
- `baseWeightKg` (Number): Maximum weight covered under the base price.
- `perKgRate` (Number): Cost per incremental kilogram exceeding the base weight (in ₹).
- `codSurchargeFlat` (Number): Flat fee for Cash on Delivery orders (in ₹).
- `codSurchargePct` (Number): Percentage surcharge of the delivery fee for COD.

---

## API Documentation

Authentication is supported via HTTP-Only session-isolated tokens.

### Authentication
* `POST /api/auth/register`: Register new user (Customers default to verified, Agents default to unverified and require admin approval).
* `POST /api/auth/login`: Authenticate and return JWT token.
* `POST /api/auth/logout`: Clear token.
* `GET /api/auth/me`: Retrieve currently logged-in user profile.

### Circular Zones
* `GET /api/zones`: List all zones.
* `POST /api/zones` (Admin Only): Create a new circular zone.
* `DELETE /api/zones/:id` (Admin Only): Delete an existing zone.

### Rate Cards
* `GET /api/rates`: List all configured rate cards.
* `PUT /api/rates/:id` (Admin Only): Edit rate values (Base Price, Incremental rates, COD Surcharges).

### Orders
* `POST /api/orders/estimate`: Returns a pricing calculation breakdown based on package dimensions, weight, coordinates, order type, and payment type. Does not save to DB.
* `POST /api/orders`: Place a new delivery order. Auto-calculates charges, logs history, and fires mock customer notifications.
* `GET /api/orders`: Fetch orders. Filtered by role context:
  - Customers view only their placed orders.
  - Agents view only their assigned orders.
  - Admins view all system orders (supports query parameter filters `?status=...&zoneId=...&agentId=...`).
* `GET /api/orders/:id/history`: Returns the specific order and its chronological immutable status history.
* `POST /api/orders/:id/assign` (Admin Only): Allocates agent. Accepts request payload `{"agentId": "..."}` or `{"auto": true}` (trigger auto-assignment logic).
* `POST /api/orders/:id/status`: Transition delivery status. Used by agent on the road or admin override.
* `POST /api/orders/:id/reschedule`: Capture reschedule date. Resets status, frees old agent, and triggers auto-assignment to a new agent.

### Delivery Agents
* `GET /api/agents`: Retrieve all agents (returns all agents with `isVerified` status for Admins, and only verified agents for Customers/Agents).
* `POST /api/agents/:id/verify` (Admin Only): Verify/Approve a pending agent account.
* `POST /api/agents/:id/location`: Update active agent GPS coordinates and duty availability status (`AVAILABLE`, `BUSY`, `OFFLINE`).

### Notifications
* `GET /api/notifications`: Retrieve full logs of sent mock Email/SMS notification logs.

---

## Rate Calculation Logic & Pricing Engine

The rate calculation engine performs the following steps:

1. **Volumetric Weight Calculation**:
   $$\text{Volumetric Weight (kg)} = \frac{L(\text{cm}) \times W(\text{cm}) \times H(\text{cm})}{5000}$$
2. **Billable Weight Selection**:
   $$\text{Billable Weight} = \max(\text{Actual Weight}, \text{Volumetric Weight})$$
3. **Geographic Zone Classification**:
   - Compares coordinates against registered zones using the *Haversine formula*.
   - If both pickup and dropoff points fall inside the *same* zone (e.g. both inside Zone A), the order is classified as `INTRA-ZONE`.
   - Otherwise, it is classified as `INTER-ZONE`.
4. **Rate Matrix Lookup**:
   - Matches the Order Type (`B2B` or `B2C`) and Zone Classification (`INTRA` or `INTER`) to fetch the corresponding Rate Card.
5. **Cost Calculation**:
   - Delivery Charge is calculated as:
     $$\text{Delivery Charge (₹)} = \text{Base Price} + (\max(0, \text{Billable Weight} - \text{Base Weight})) \times \text{Incremental Rate}$$
6. **Payment Surcharges**:
   - If the Payment Type is `COD` (Cash on Delivery), the surcharge is added:
     $$\text{COD Charge (₹)} = \text{Flat Surcharge} + \left(\text{Delivery Charge} \times \frac{\text{Surcharge Percentage}}{100}\right)$$
7. **Total Pricing**:
   $$\text{Total Price (₹)} = \text{Delivery Charge} + \text{COD Surcharge}$$
