import { geocodeManausAddress } from "../_shared/geocoding.ts";
import {
  chooseVehicle, estimateLoad, formatDropoff, parseQuotation, requestSandboxQuotation,
  type DeliveryAddress, type QuoteItem, type ProductWeight,
} from "../_shared/delivery-quote.ts";

const ORIGIN_ADDRESS = "Av. Lourenço da Silva Braga, 700 - Centro, Manaus - AM, Brasil";

export type CheckoutDeliveryType = "pickup_store" | "pickup_uber" | "delivery";
export type CheckoutPaymentMethod = "pix" | "pix_test" | "cash" | "card_on_delivery";

export function validateCheckoutDelivery(input: {
  deliveryType: string;
  paymentMethod: string;
  isAdmin: boolean;
  deliveryActive: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!["pickup_store", "pickup_uber", "delivery"].includes(input.deliveryType)) {
    return { ok: false, status: 400, error: "Modalidade inválida. Escolha retirada, Receber com seu Uber ou Entrega Feira On." };
  }
  if (input.paymentMethod === "pix_test" && !input.isAdmin) {
    return { ok: false, status: 403, error: "Pix de teste disponível somente para administradores." };
  }
  if (input.deliveryType === "delivery") {
    if (!input.deliveryActive && !input.isAdmin) {
      return { ok: false, status: 403, error: "A Entrega Feira On está temporariamente desativada." };
    }
    if (!["pix", "pix_test"].includes(input.paymentMethod)) {
      return { ok: false, status: 400, error: "Entrega Feira On aceita somente Pix." };
    }
  }
  if (input.deliveryType === "pickup_uber" && !["pix", "pix_test"].includes(input.paymentMethod)) {
    return { ok: false, status: 400, error: "Na modalidade Receber com seu Uber, o pagamento é somente por Pix." };
  }
  return { ok: true };
}

export async function calculateServerDelivery(input: {
  items: QuoteItem[];
  products: ProductWeight[];
  address: DeliveryAddress;
  motoLimitKg: number;
  apiKey: string;
  apiSecret: string;
  geocodingApiKey: string;
  geocodeFetcher?: typeof fetch;
  fetcher?: typeof fetch;
}) {
  const dropoff = formatDropoff(input.address);
  const load = estimateLoad(input.items, input.products);
  const vehicle = chooseVehicle(load.weightKg, load.bulky, input.motoLimitKg);
  const serviceType = vehicle === "MOTO" ? "LALAGO" : "CAR";
  const [originCoordinates, dropoffCoordinates] = await Promise.all([
    geocodeManausAddress(ORIGIN_ADDRESS, input.geocodingApiKey, input.geocodeFetcher || fetch),
    geocodeManausAddress(dropoff, input.geocodingApiKey, input.geocodeFetcher || fetch),
  ]);
  const response = await requestSandboxQuotation(
    input.apiKey, input.apiSecret, serviceType, dropoff,
    { origin: originCoordinates, dropoff: dropoffCoordinates }, input.fetcher || fetch,
  );
  const payload = await response.json().catch(() => ({}));
  const upstreamCode = String(payload?.message || "");
  if (upstreamCode === "ERR_OUT_OF_SERVICE_AREA") throw new Error("OUT_OF_SERVICE_AREA");
  if (upstreamCode === "ERR_REVERSE_GEOCODE_FAILURE") throw new Error("LALAMOVE_REVERSE_GEOCODE_FAILURE");
  if (!response.ok) throw new Error(response.status === 429 ? "LALAMOVE_RATE_LIMIT" : "LALAMOVE_QUOTE_FAILED");
  const quote = parseQuotation(payload?.data, vehicle, load.weightKg);
  return {
    vehicle: quote.vehicle,
    weightKg: quote.weightKg,
    fee: quote.fee,
    validUntil: quote.validUntil,
    address: input.address,
    formattedAddress: dropoff,
  };
}

// The client-supplied delivery fee is intentionally not an input to this function.
export function orderTotals(subtotalCents: number, serverDeliveryFee: number, deliveryType: string) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0 ||
      !Number.isSafeInteger(serverDeliveryFee) || serverDeliveryFee < 0) {
    throw new Error("INVALID_ORDER_TOTAL");
  }
  const feeCents = deliveryType === "delivery" ? serverDeliveryFee * 100 : 0;
  const totalCents = subtotalCents + feeCents;
  if (!Number.isSafeInteger(totalCents) || totalCents > 10000000) throw new Error("INVALID_ORDER_TOTAL");
  return { deliveryFee: feeCents / 100, totalCents, total: totalCents / 100 };
}
