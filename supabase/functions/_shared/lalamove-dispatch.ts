export type Vehicle = "MOTO" | "CAR";
export type LalamoveStatus = "searching" | "assigned" | "enroute_pickup" | "picked_up" | "delivered" | "cancelled";

export function quoteFee(data: any): { fee: number; expiresAt: string } {
  const raw = data?.priceBreakdown?.total ?? data?.total;
  const amount = Number(raw);
  const currency = String(data?.priceBreakdown?.currency || "BRL").toUpperCase();
  const expiresAt = String(data?.expiresAt || "");
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(amount) || amount < 0 || currency !== "BRL" ||
      !Number.isFinite(expiresMs) || expiresMs <= Date.now() || !data?.quotationId ||
      !Array.isArray(data?.stops) || data.stops.length < 2 ||
      !data.stops[0]?.stopId || !data.stops[1]?.stopId) {
    throw new Error("INVALID_QUOTE_RESPONSE");
  }
  return { fee: Math.round(amount * 100) / 100, expiresAt: new Date(expiresMs).toISOString() };
}

export function priceDifference(currentFee: number, chargedFee: number): number {
  if (!Number.isFinite(currentFee) || !Number.isFinite(chargedFee)) throw new Error("INVALID_PRICE");
  return Math.round((currentFee - chargedFee) * 100) / 100;
}

export function canStartDispatch(state: string | null | undefined): boolean {
  return !["creating", "created"].includes(String(state || ""));
}

export function canCancelLalamove(status: string | null | undefined, updatedAt: string | null | undefined, now = Date.now()): boolean {
  const current = String(status || "");
  if (current === "searching") return true;
  if (!["assigned", "enroute_pickup"].includes(current)) return false;
  const matchedAt = Date.parse(String(updatedAt || ""));
  return Number.isFinite(matchedAt) && now >= matchedAt && now - matchedAt < 5 * 60 * 1000;
}

export function mapLalamoveStatus(eventType: string, rawStatus: string): LalamoveStatus | null {
  const status = String(rawStatus || "").toUpperCase();
  if (eventType === "DRIVER_ASSIGNED") return "assigned";
  if (status === "ASSIGNING_DRIVER") return "searching";
  if (status === "ON_GOING") return "assigned";
  if (status === "PICKED_UP") return "picked_up";
  if (status === "COMPLETED") return "delivered";
  if (["CANCELED", "CANCELLED", "REJECTED", "EXPIRED"].includes(status)) return "cancelled";
  return null;
}

export function normalizeBrazilPhone(input: unknown): string {
  const digits = String(input || "").replace(/\D/g, "");
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (!/^\d{10,11}$/.test(national)) throw new Error("INVALID_PHONE");
  return "+55" + national;
}

export function buildLalamoveOrderBody(input: {
  quote: any;
  orderId: string;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  remarks: string;
}) {
  const stops = input.quote?.stops;
  if (!input.quote?.quotationId || !Array.isArray(stops) || stops.length < 2 ||
      !stops[0]?.stopId || !stops[1]?.stopId) throw new Error("INVALID_STORED_QUOTE");
  const senderName = String(input.senderName || "").trim().slice(0, 80);
  const recipientName = String(input.recipientName || "").trim().slice(0, 80);
  if (!senderName || !recipientName || !input.orderId) throw new Error("INVALID_CONTACT");
  return {
    data: {
      quotationId: String(input.quote.quotationId),
      sender: {
        stopId: String(stops[0].stopId),
        name: senderName,
        phone: normalizeBrazilPhone(input.senderPhone),
      },
      recipients: [{
        stopId: String(stops[1].stopId),
        name: recipientName,
        phone: normalizeBrazilPhone(input.recipientPhone),
        remarks: String(input.remarks || "").slice(0, 1500),
      }],
      isPODEnabled: true,
      metadata: { orderId: String(input.orderId), storeName: "Feira On Delivery" },
    },
  };
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signApiRequest(apiKey: string, apiSecret: string, method: string, path: string, body = "") {
  const timestamp = String(Date.now());
  const signature = await hmacHex(apiSecret, timestamp + "\r\n" + method.toUpperCase() + "\r\n" + path + "\r\n\r\n" + body);
  return {
    timestamp,
    headers: {
      Authorization: "hmac " + apiKey + ":" + timestamp + ":" + signature,
      Market: "BR",
      "Request-ID": crypto.randomUUID(),
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
  };
}

export async function createLalamoveOrder(
  apiKey: string, apiSecret: string, body: unknown, fetcher: typeof fetch = fetch,
): Promise<{ response: Response; payload: any }> {
  const path = "/v3/orders";
  const serialized = JSON.stringify(body);
  const signed = await signApiRequest(apiKey, apiSecret, "POST", path, serialized);
  const response = await fetcher("https://rest.sandbox.lalamove.com" + path, {
    method: "POST", headers: signed.headers, body: serialized, signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function cancelLalamoveOrder(
  apiKey: string, apiSecret: string, orderId: string, fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) throw new Error("INVALID_LALAMOVE_ORDER_ID");
  const path = "/v3/orders/" + encodeURIComponent(orderId);
  const signed = await signApiRequest(apiKey, apiSecret, "DELETE", path);
  return await fetcher("https://rest.sandbox.lalamove.com" + path, {
    method: "DELETE", headers: signed.headers, signal: AbortSignal.timeout(12000),
  });
}

export async function verifyWebhookSignature(input: {
  apiKey: string; apiSecret: string; path: string; payload: any;
}): Promise<boolean> {
  const payload = input.payload;
  if (!payload || payload.apiKey !== input.apiKey || !payload.timestamp ||
      !payload.signature || !payload.data || typeof payload.data !== "object") return false;
  const signature = String(payload.signature).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const raw = String(payload.timestamp) + "\r\nPOST\r\n" + input.path +
    "\r\n\r\n" + JSON.stringify(payload.data);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.apiSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = new Uint8Array(signature.match(/.{2}/g)!.map((part) => parseInt(part, 16)));
  return await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(raw));
}

export async function makeWebhookSignature(apiSecret: string, timestamp: string, path: string, data: unknown) {
  return await hmacHex(apiSecret, timestamp + "\r\nPOST\r\n" + path + "\r\n\r\n" + JSON.stringify(data));
}
