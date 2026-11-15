import { getLalamoveTracking } from "./lalamove.ts";

export type DeliveryTrackingProvider = "lalamove" | "99" | "uber";

export async function getProviderTracking(
  provider: DeliveryTrackingProvider,
  apiKey: string,
  apiSecret: string,
  orderId: string,
) {
  switch (provider) {
    case "lalamove":
      return await getLalamoveTracking(apiKey, apiSecret, orderId);
    case "99":
    case "uber":
      throw new Error("PROVIDER_NOT_CONFIGURED");
  }
}
