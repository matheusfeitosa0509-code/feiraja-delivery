import { lalamoveBaseUrl, type LalamoveEnvironment } from "./lalamove-environment.ts";

export type DeliveryCoordinates = { lat: string; lng: string };
export type DeliveryAddress = {
  street: string; number: string; neighborhood: string; postal_code?: string;
  complement?: string; reference?: string;
};
export type QuoteItem = { product_id: string; quantity: number };
export type ProductWeight = {
  id: string; delivery_unit_weight_kg: number | null; delivery_bulky: boolean;
  sale_unit: string | null;
};
export type QuoteResult = { vehicle: "MOTO" | "CAR"; weightKg: number; fee: number; validUntil: string };

export function hasMultipleDeliveryAddresses(input: unknown): boolean {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const pattern = /(?:\\b(?:rua|avenida|travessa|alameda|rodovia|estrada)\\b|\\b(?:r|av|tv)\\.)[\\s\\S]{0,80}\\b\\d{1,5}\\b/i;
  return pattern.test(String(value.complement || "")) || pattern.test(String(value.reference || ""));
}

export function normalizeConfirmedDeliveryCoordinates(input: unknown): DeliveryCoordinates | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const lat = Number(value.lat), lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
}

export async function resolveDeliveryDropoffCoordinates(
  input: unknown,
  fallback: () => Promise<DeliveryCoordinates>,
): Promise<{ coordinates: DeliveryCoordinates; source: "confirmed_pin" | "geocoded_fallback" }> {
  const confirmed = normalizeConfirmedDeliveryCoordinates(input);
  if (confirmed) return { coordinates: confirmed, source: "confirmed_pin" };
  return { coordinates: await fallback(), source: "geocoded_fallback" };
}

export function estimateLoad(items: QuoteItem[], products: ProductWeight[]) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new Error("INVALID_ITEMS");
  const byId = new Map(products.map((p) => [p.id, p]));
  let weightKg = 0;
  let bulky = false;
  for (const item of items) {
    if (!item || typeof item.product_id !== "string" || !Number.isFinite(item.quantity) ||
      item.quantity <= 0 || item.quantity > 1000) throw new Error("INVALID_ITEMS");
    const product = byId.get(item.product_id);
    if (!product) throw new Error("INVALID_ITEMS");
    const unit = String(product.sale_unit || "").trim().toLowerCase();
    const isKg = ["kg", "quilo", "quilograma"].includes(unit);
    const unitWeight = product.delivery_unit_weight_kg == null ? 1 : Number(product.delivery_unit_weight_kg);
    weightKg += isKg ? item.quantity : unitWeight * item.quantity;
    bulky ||= product.delivery_bulky === true;
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) throw new Error("INVALID_ITEMS");
  return { weightKg: Math.round(weightKg * 1000) / 1000, bulky };
}

export function chooseVehicle(weightKg: number, bulky: boolean, motoLimitKg: number): "MOTO" | "CAR" {
  return !bulky && weightKg <= motoLimitKg ? "MOTO" : "CAR";
}

export function roundFeeUpToReal(amount: unknown): number {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("INVALID_QUOTE_PRICE");
  return Math.ceil(parsed);
}

export function formatDropoff(address: DeliveryAddress): string {
  const street = String(address?.street || "").trim();
  const number = String(address?.number || "").trim();
  const neighborhood = String(address?.neighborhood || "").trim();
  if (!street || !number || !neighborhood || street.length > 160 || number.length > 30 || neighborhood.length > 100) {
    throw new Error("INVALID_ADDRESS");
  }
  // Lalamove recebe apenas o endereço postal; POIs/referências permanecem no objeto salvo para o entregador.
  return [street + ", " + number, neighborhood, "Manaus - AM, Brasil"].filter(Boolean).join(", ");
}

export function buildQuotationBody(
  serviceType: "LALAGO" | "CAR",
  dropoff: string,
  coordinates: { origin: DeliveryCoordinates; dropoff: DeliveryCoordinates },
  scheduleAt?: string,
) {
  if (scheduleAt && (!scheduleAt.endsWith("Z") || !Number.isFinite(Date.parse(scheduleAt)))) {
    throw new Error("INVALID_SCHEDULE_TIME");
  }
  return { data: { ...(scheduleAt ? { scheduleAt } : {}), serviceType, language: "pt_BR", stops: [
    { coordinates: coordinates.origin, address: "Av. Lourenço da Silva Braga, 700 - Centro, Manaus - AM, Brasil" },
    { coordinates: coordinates.dropoff, address: dropoff },
  ] } };
}

export function classifyLalamoveQuoteError(status: number, payload: any): {
  code: string; upstreamCode: string; detail: string;
} {
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  const upstreamCode = String(payload?.message || first?.id || "");
  const detail = String(first?.detail || "");
  if (upstreamCode === "ERR_OUT_OF_SERVICE_AREA") return { code: "LALAMOVE_OUT_OF_SERVICE_AREA", upstreamCode, detail };
  if (upstreamCode === "ERR_INVALID_SCHEDULE_TIME") return { code: "LALAMOVE_INVALID_SCHEDULE_TIME", upstreamCode, detail };
  if (upstreamCode === "ERR_INVALID_SERVICE_TYPE") return { code: "LALAMOVE_INVALID_SERVICE_TYPE", upstreamCode, detail };
  if (upstreamCode === "ERR_INVALID_MARKET") return { code: "LALAMOVE_INVALID_MARKET", upstreamCode, detail };
  if (upstreamCode === "ERR_REVERSE_GEOCODE_FAILURE") return { code: "LALAMOVE_REVERSE_GEOCODE_FAILURE", upstreamCode, detail };
  if (upstreamCode === "ERR_INVALID_FIELD") {
    if (/coordinates\/(?:lat|lng)/i.test(detail)) return { code: "LALAMOVE_INVALID_COORDINATES", upstreamCode, detail };
    if (/\/address/i.test(detail)) return { code: "LALAMOVE_INVALID_ADDRESS", upstreamCode, detail };
    return { code: "LALAMOVE_INVALID_REQUEST", upstreamCode, detail };
  }
  if (status === 429) return { code: "LALAMOVE_RATE_LIMIT", upstreamCode, detail };
  if (status === 422) return { code: "LALAMOVE_INVALID_REQUEST", upstreamCode, detail };
  return { code: "LALAMOVE_QUOTE_FAILED", upstreamCode, detail };
}

export function parseQuotation(data: any, vehicle: "MOTO" | "CAR", weightKg: number): QuoteResult {
  const expiresAt = String(data?.expiresAt || "");
  const expiresMs = Date.parse(expiresAt);
  const total = data?.priceBreakdown?.total ?? data?.total;
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now() || String(data?.priceBreakdown?.currency || "BRL").toUpperCase() !== "BRL") {
    throw new Error("INVALID_QUOTE_RESPONSE");
  }
  return { vehicle, weightKg, fee: roundFeeUpToReal(total), validUntil: new Date(expiresMs).toISOString() };
}

export function isQuoteAllowed(deliveryActive: boolean, isAdmin: boolean): boolean {
  return deliveryActive || isAdmin;
}

export async function requestSandboxQuotation(
  apiKey: string, apiSecret: string, serviceType: "LALAGO" | "CAR", dropoff: string,
  coordinates: { origin: DeliveryCoordinates; dropoff: DeliveryCoordinates },
  fetcher: typeof fetch = fetch,
  environment: LalamoveEnvironment = "sandbox",
  scheduleAt?: string,
): Promise<Response> {
  const keyPrefix = environment === "producao" ? "pk_prod" : "pk_test";
  const secretPrefix = environment === "producao" ? "sk_prod" : "sk_test";
  if (!apiKey.startsWith(keyPrefix) || !apiSecret.startsWith(secretPrefix)) {
    throw new Error(environment === "producao" ? "PRODUCTION_CREDENTIALS_REQUIRED" : "SANDBOX_CREDENTIALS_REQUIRED");
  }
  const path = "/v3/quotations";
  const url = lalamoveBaseUrl(environment) + path;
  const body = JSON.stringify(buildQuotationBody(serviceType, dropoff, coordinates, scheduleAt));
  const timestamp = String(Date.now());
  const raw = timestamp + "\r\nPOST\r\n" + path + "\r\n\r\n" + body;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const signature = Array.from(new Uint8Array(signed), (b) => b.toString(16).padStart(2, "0")).join("");
  return await fetcher(url, {
    method: "POST",
    headers: {
      "Authorization": "hmac " + apiKey + ":" + timestamp + ":" + signature,
      "Market": "BR", "Request-ID": crypto.randomUUID(),
      "Content-Type": "application/json; charset=utf-8", "Accept": "application/json",
    },
    body,
    signal: AbortSignal.timeout(12000),
  });
}


export function startParallelVehicleQuotes<T>(
  selectedVehicle: "MOTO" | "CAR",
  quote: (vehicle: "MOTO" | "CAR") => Promise<T>,
): { selected: Promise<T>; background: Promise<T> } {
  const moto = Promise.resolve().then(() => quote("MOTO"));
  const car = Promise.resolve().then(() => quote("CAR"));
  const allQuotes = Promise.all([moto, car]);
  return selectedVehicle === "MOTO"
    ? { selected: moto, background: allQuotes.then(([, carQuote]) => carQuote) }
    : { selected: car, background: allQuotes.then(([motoQuote]) => motoQuote) };
}

export async function retryLalamove429(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher(input, init);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) return response;
    const retryAfter = Number(response.headers.get("Retry-After") || 0);
    const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, 1000) : [250, 500][attempt];
    await sleep(delay);
  }
  throw new Error("LALAMOVE_RETRY_EXHAUSTED");
}
