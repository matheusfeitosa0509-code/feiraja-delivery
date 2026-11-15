export type DeliveryAddress = {
  street: string; number: string; neighborhood: string;
  complement?: string; reference?: string;
};
export type QuoteItem = { product_id: string; quantity: number };
export type ProductWeight = {
  id: string; delivery_unit_weight_kg: number | null; delivery_bulky: boolean;
  sale_unit: string | null;
};
export type QuoteResult = { vehicle: "MOTO" | "CAR"; weightKg: number; fee: number; validUntil: string };

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
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("INVALID_QUOTE_PRICE");
  return Math.ceil(parsed);
}

export function formatDropoff(address: DeliveryAddress): string {
  const street = String(address?.street || "").trim();
  const number = String(address?.number || "").trim();
  const neighborhood = String(address?.neighborhood || "").trim();
  if (!street || !number || !neighborhood || street.length > 160 || number.length > 30 || neighborhood.length > 100) {
    throw new Error("INVALID_ADDRESS");
  }
  const complement = String(address.complement || "").trim().slice(0, 100);
  const reference = String(address.reference || "").trim().slice(0, 160);
  return [street + ", " + number, complement, neighborhood, reference, "Manaus - AM, Brasil"].filter(Boolean).join(", ");
}

export function buildQuotationBody(serviceType: "LALAGO" | "CAR", dropoff: string) {
  return { data: { serviceType, language: "pt_BR", stops: [
    { address: "Av. Lourenço da Silva Braga, 700 - Centro, Manaus - AM, Brasil" },
    { address: dropoff },
  ] } };
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
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!apiKey.startsWith("pk_test") || !apiSecret.startsWith("sk_test")) throw new Error("SANDBOX_CREDENTIALS_REQUIRED");
  const path = "/v3/quotations";
  const url = "https://rest.sandbox.lalamove.com" + path;
  const body = JSON.stringify(buildQuotationBody(serviceType, dropoff));
  const timestamp = String(Date.now());
  const raw = timestamp + "\\r\\nPOST\\r\\n" + path + "\\r\\n\\r\\n" + body;
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
