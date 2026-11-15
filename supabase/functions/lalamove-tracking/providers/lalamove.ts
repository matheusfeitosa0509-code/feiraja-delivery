import { getLalamoveDriverDetails, getLalamoveOrderDetails, mapLalamoveStatus } from "../../_shared/lalamove-dispatch.ts";
import { publicDriverDetails, normalizeTrackingCoordinates } from "../../_shared/lalamove-tracking.ts";

export async function getLalamoveTracking(apiKey: string, apiSecret: string, lalamoveOrderId: string) {
  const orderResult = await getLalamoveOrderDetails(apiKey, apiSecret, lalamoveOrderId);
  if (!orderResult.response.ok) throw new Error("LALAMOVE_ORDER_DETAILS_FAILED");
  const order = orderResult.payload || {};
  const status = mapLalamoveStatus("ORDER_STATUS_CHANGED", String(order.status || ""));
  if (!status) throw new Error("LALAMOVE_STATUS_UNKNOWN");
  const stops = Array.isArray(order.stops) ? order.stops : [];
  const store = normalizeTrackingCoordinates(stops[0]?.coordinates);
  const customer = normalizeTrackingCoordinates(stops[1]?.coordinates);
  const driverId = String(order.driverId || order.driver?.driverId || "");
  let driver = publicDriverDetails(order.driver);
  if (driverId && !["delivered", "cancelled", "rejected", "expired"].includes(status)) {
    try {
      const driverResult = await getLalamoveDriverDetails(apiKey, apiSecret, lalamoveOrderId, driverId);
      if (driverResult.response.ok) driver = publicDriverDetails(driverResult.payload) || driver;
    } catch {
      // Lalamove may return 403 until the driver reaches the pickup point.
    }
  }
  return {
    provider: "lalamove",
    status,
    driver_assigned: !!driverId,
    store,
    customer,
    driver,
    tracking_url: String(order.shareLink || ""),
  };
}
