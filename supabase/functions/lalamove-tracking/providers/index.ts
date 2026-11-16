import { getLalamoveTracking } from "./lalamove.ts";
import type { LalamoveEnvironment } from "../../_shared/lalamove-environment.ts";

export type DeliveryTrackingProvider = "lalamove" | "99" | "uber";

export async function getProviderTracking(
  provider: DeliveryTrackingProvider,
  apiKey: string,
  apiSecret: string,
  orderId: string,
  environment: LalamoveEnvironment = "sandbox",
) {
  switch (provider) {
    case "lalamove":
      return await getLalamoveTracking(apiKey, apiSecret, orderId, environment);
    case "99":
    case "uber":
      throw new Error("PROVIDER_NOT_CONFIGURED");
  }
}
