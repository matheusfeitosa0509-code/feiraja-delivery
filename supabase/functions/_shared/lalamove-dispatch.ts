import { lalamoveBaseUrl, type LalamoveEnvironment } from "./lalamove-environment.ts";

export type Vehicle = "MOTO" | "CAR";
export type LalamoveStatus = "searching" | "assigned" | "enroute_pickup" | "picked_up" | "delivered" | "cancelled" | "rejected" | "expired";

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

export function assertTestProductionDispatchConfirmation(isTestOrder: boolean, environment: string, confirmed: boolean): void {
  if (isTestOrder && environment === "producao" && confirmed !== true) throw new Error("TEST_PRODUCTION_CONFIRMATION_REQUIRED");
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
  if (["CANCELED", "CANCELLED"].includes(status)) return "cancelled";
  if (status === "REJECTED") return "rejected";
  if (status === "EXPIRED") return "expired";
  return null;
}

export function normalizeBrazilPhone(input: unknown): string {
  const digits = String(input || "").replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  const national = withoutCountry.startsWith("0") ? withoutCountry.slice(1) : withoutCountry;
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
  environment: LalamoveEnvironment = "sandbox",
): Promise<{ response: Response; payload: any }> {
  const path = "/v3/orders";
  const serialized = JSON.stringify(body);
  const signed = await signApiRequest(apiKey, apiSecret, "POST", path, serialized);
  const response = await fetcher(lalamoveBaseUrl(environment) + path, {
    method: "POST", headers: signed.headers, body: serialized, signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function getLalamoveOrderDetails(
  apiKey: string, apiSecret: string, orderId: string, fetcher: typeof fetch = fetch,
  environment: LalamoveEnvironment = "sandbox",
): Promise<{ response: Response; payload: any }> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) throw new Error("INVALID_LALAMOVE_ORDER_ID");
  const path = "/v3/orders/" + encodeURIComponent(orderId);
  const signed = await signApiRequest(apiKey, apiSecret, "GET", path);
  const response = await fetcher(lalamoveBaseUrl(environment) + path, {
    method: "GET", headers: signed.headers, signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload: payload?.data || {} };
}

export async function getLalamoveDriverDetails(
  apiKey: string, apiSecret: string, orderId: string, driverId: string, fetcher: typeof fetch = fetch,
  environment: LalamoveEnvironment = "sandbox",
): Promise<{ response: Response; payload: any }> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(orderId) || !/^[A-Za-z0-9_-]{1,80}$/.test(driverId)) {
    throw new Error("INVALID_DRIVER_LOOKUP");
  }
  const path = "/v3/orders/" + encodeURIComponent(orderId) + "/drivers/" + encodeURIComponent(driverId);
  const signed = await signApiRequest(apiKey, apiSecret, "GET", path);
  const response = await fetcher(lalamoveBaseUrl(environment) + path, {
    method: "GET", headers: signed.headers, signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload: payload?.data || {} };
}

export async function cancelLalamoveOrder(
  apiKey: string, apiSecret: string, orderId: string, fetcher: typeof fetch = fetch,
  environment: LalamoveEnvironment = "sandbox",
): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) throw new Error("INVALID_LALAMOVE_ORDER_ID");
  const path = "/v3/orders/" + encodeURIComponent(orderId);
  const signed = await signApiRequest(apiKey, apiSecret, "DELETE", path);
  return await fetcher(lalamoveBaseUrl(environment) + path, {
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

/** True for Lalamove's initial endpoint-connectivity probe (no signed event envelope). */
export function isWebhookVerificationProbe(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const value = payload as Record<string, unknown>;
  return typeof value.apiKey !== "string" || !value.apiKey ||
    (typeof value.timestamp !== "string" && typeof value.timestamp !== "number") ||
    !value.timestamp || typeof value.signature !== "string" || !value.signature ||
    !value.data || typeof value.data !== "object" || Array.isArray(value.data);
}

export function canQuoteLalamove(status: unknown, paymentMethod: unknown, isTestOrder: boolean): boolean {
  const current = String(status || "").trim().toLowerCase();
  if (["cancelada", "cancelado", "pagamento cancelado", "pagamento recusado", "reembolsado", "contestado"].includes(current)) {
    return false;
  }
  if (isTestOrder) return true;
  const paidByPix = String(paymentMethod || "").toLowerCase().includes("pix");
  return paidByPix && ["pagamento confirmado", "preparando", "pronto", "pronto para retirada"].includes(current);
}

export function isLalamoveDispatchReady(status: unknown): boolean {
  return ["preparando", "pronto", "pronto para retirada"].includes(String(status || "").trim().toLowerCase());
}


/** Accept only the legacy service_role JWT for RPCs that validate request.jwt.claim.role. */
export function requireSupabaseServiceRoleJwt(value: unknown): string {
  const token = String(value || "").trim();
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("MISSING_SUPABASE_SERVICE_ROLE_KEY");
  }
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload + "=".repeat((4 - payload.length % 4) % 4)));
    if (claims?.role !== "service_role") throw new Error("wrong role");
  } catch {
    throw new Error("MISSING_SUPABASE_SERVICE_ROLE_KEY");
  }
  return token;
}

/** Keep the quote RPC call contract centralized and testable without contacting Lalamove. */
export async function storeLalamoveQuotes(db: any, payload: Record<string, unknown>) {
  return await db.rpc("service_store_lalamove_quotes", payload);
}

/** Reads Supabase's modern secret-key collection for webhook clients that authenticate via apikey. */
export function requireSupabaseSecretKey(value: unknown): string {
  const raw = String(value || "").trim();
  let key = raw;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      key = String(parsed?.default || "").trim();
    } catch {
      key = "";
    }
  }
  if (!key.startsWith("sb_secret_")) throw new Error("MISSING_SUPABASE_SECRET_KEY");
  return key;
}

/** New secret keys authenticate through apikey; never forward them as Bearer JWTs. */
export function secretKeyFetch(secretKey: string, fetcher: typeof fetch = fetch): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set("apikey", secretKey);
    headers.delete("Authorization");
    return fetcher(input, { ...init, headers });
  };
}

/** Allowlist-only provider diagnostics. Excludes contacts, addresses, signatures and raw payloads. */
export function sanitizeLalamoveErrorPayload(payload: unknown): Record<string,string> {
 const root=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
 const nested=root.error&&typeof root.error==="object"?root.error as Record<string,unknown>:root;
 const output:Record<string,string>={};
 for(const key of ["code","errorCode","message","reason","status"]){
  const value=nested[key]??(nested===root?undefined:root[key]);
  if(typeof value!=="string"&&typeof value!=="number")continue;
  const safe=String(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[redacted-email]")
   .replace(/\+?\d[\d ().-]{7,}\d/g,"[redacted-phone]").replace(/https?:\/\/\S+/gi,"[redacted-url]")
   .replace(/[\r\n\t]+/g," ").slice(0,180);
  if(safe)output[key]=safe;
 }
 return output;
}
