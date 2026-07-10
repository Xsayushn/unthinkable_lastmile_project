# System Design: Last-Mile Delivery Tracker (Pune Edition)

This document details the system design, algorithms, and models powering the Last-Mile Delivery Tracker in Rupees (₹) currency and Pune geography.

---

## 1. Rate Calculation Engine

The Rate Calculation Engine calculates shipping costs by analyzing package dimensions, weight, geographic routes, contract tiers, and payment methods. 

```
[Package L x W x H] ------> [Volumetric Weight = (L*W*H)/5000]
                                      |
[Actual Weight] ------------> [Select Max(Actual, Volumetric)]
                                      |
                                      v
                               [Billing Weight]
                                      |
[Route coordinates] --------> [Zone Detection (Haversine)]
                                      v
                              [INTRA vs INTER Zone]
                                      |
[Order Contract: B2B/B2C] ---> [Query Rate Cards] -------> [Base + Incremental Charge (₹)]
                                                                    |
[Payment: COD vs Prepaid] --> [Add COD Surcharges] --------> [Total Delivery Cost (₹)]
```

### Volumetric Weight & Billing Weight
The engine implements the standard dim-factor density calculation:
$$\text{Volumetric Weight (kg)} = \frac{L \times W \times H}{5000}$$
$$\text{Billing Weight (kg)} = \max(\text{Actual Weight}, \text{Volumetric Weight})$$

### Rate Cards & Custom Adjustments
Contracts differ by tier. The system maintains four independent rate cards scaled in Indian Rupees (₹) (B2B/B2C, Intra/Inter).
Each card models base prices, incremental rates, and Cash on Delivery (COD) surcharges. Admins can adjust these rate settings live via API.

---

## 2. Circular Zone Detection (Geofencing)

Zones represent circular geofences defined by a center coordinate $(\text{latitude}, \text{longitude})$ and a radius $R$ in kilometers.
To identify if coordinates reside inside a zone, the system calculates the shortest distance using the **Haversine formula**:

$$d = 2r \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)}\right)$$

- If distance $d \le \text{Zone Radius}$, the coordinate is inside that zone.
- Overlapping points resolve to the closer zone center.
- **Intra-zone vs Inter-zone**: An order is classified as `INTRA-ZONE` if and only if both pickup and dropoff points fall inside the *same* zone; otherwise, it defaults to `INTER-ZONE`.

---

## 3. Auto-Assignment & Agent Proximity

Efficient operations minimize driver travel time. The system models the delivery agent registry with active coordinates and status (`AVAILABLE`, `BUSY`, `OFFLINE`).

### Proximity Algorithm
When an order is created or rescheduled, the system triggers agent allocation:
1. **Filtering**: Selects active agents whose status is strictly `AVAILABLE`.
2. **Proximity Calculation**: Computes the Haversine distance from the agent to the order's pickup coordinate.
3. **Allocation**: Assigns the closest agent.
4. **Consistency**: Operations are executed in synchronous blocks, naturally preventing concurrent state conflicts:
   - Assigns `agentId` and `agentName` to the Order.
   - Sets Order status to `Assigned` and Agent status to `BUSY`.

---

## 4. Failed Delivery Exception Recovery (Reschedule Flow)

If an agent marks a delivery status as `Failed` (e.g., customer absent):
1. **Release**: The agent's status immediately reverts to `AVAILABLE`. The order is flagged with `rescheduleRequired: true`.
2. **Alert**: Mock email and SMS alerts notify the customer to reschedule.
3. **Rescheduling**: The customer selects a new date. The order resets to `Rescheduled`, clearing old agent references.
4. **Re-assignment**: Proximity auto-assignment runs again, allocating the closest available agent for the new schedule.
5. **Observability**: Every lifecycle stage writes an immutable audit record in `OrderHistory` for monitoring.
