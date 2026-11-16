import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { readLalamoveCredentials, readLalamoveEnvironment } from "../_shared/lalamove-environment.ts";
import { getLalamoveDriverDetails, isWebhookVerificationProbe, mapLalamoveStatus, verifyWebhookSignature, requireSupabaseSecretKey, secretKeyFetch } from "../_shared/lalamove-dispatch.ts";

const PATH = "/functions/v1/lalamove-webhook";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

function safeDriver(value: any) {
  if (!value || typeof value !== "object") return null;
  const driver = {
    name: String(value.name || "").slice(0, 100),
    phone: String(value.phone || "").slice(0, 40),
    plateNumber: String(value.plateNumber || "").slice(0, 20),
  };
  return Object.values(driver).some(Boolean) ? driver : null;
}

Deno.serve(async (req: Request) => {
  // Lalamove/Partner Portal may probe the URL with GET, HEAD, OPTIONS, or an empty POST.
  // Acknowledge these synchronously without touching credentials, parsing, or the database.
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return new Response(null, { status: 200, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization, x-signature",
    } });
  }
  if (req.method !== "POST") return new Response(null, { status: 200 });
  const rawBody = await req.text();
  if (!rawBody.trim()) return new Response(null, { status: 200 });
  let payload: any;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response(null, { status: 200 }); }
  if (isWebhookVerificationProbe(payload)) {
    return json({ received: true, verification: true });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    let serviceKey = "";
    try { serviceKey = requireSupabaseSecretKey(Deno.env.get("SUPABASE_SECRET_KEYS")); } catch { /* generic configuration error */ }
    if (!supabaseUrl || !serviceKey) return json({ error: "Webhook server configuration is incomplete." }, 503);

    const candidates: Array<{ environment: "sandbox" | "producao"; apiKey: string; apiSecret: string }> = [];
    for (const environment of ["sandbox", "producao"] as const) {
      try {
        const credentials = readLalamoveCredentials(environment, (name) => Deno.env.get(name));
        candidates.push({ environment, apiKey: credentials.apiKey, apiSecret: credentials.apiSecret });
      } catch { /* One environment may be intentionally unconfigured. */ }
    }
    if (!candidates.length) return json({ error: "No Lalamove webhook credentials are configured." }, 503);
    const matched = (await Promise.all(candidates.map(async (candidate) => ({
      ...candidate,
      valid: await verifyWebhookSignature({
        apiKey: candidate.apiKey, apiSecret: candidate.apiSecret, path: PATH, payload,
      }),
    })))).find((candidate) => candidate.valid);
    // Never process an unsigned/forged event. HTTP 200 acknowledges receipt so Lalamove
    // does not disable the configured URL; the event has no database side effects.
    if (!matched) return json({ received: true, ignored: true });

    const data = payload.data || {};
    const order = data.order && typeof data.order === "object" ? data.order : data;
    const orderId = String(order.orderId || order.id || data.orderId || data.id || "");
    // V3 eventId is normally present; signature is a stable fallback for signed payload variants.
    const eventId = String(payload.eventId || data.eventId || payload.id || payload.signature || "");
    const eventType = String(payload.eventType || data.eventType || payload.type || "UNKNOWN");
    const status = mapLalamoveStatus(eventType, String(order.status || data.status || ""));
    if (!orderId || !eventId) return json({ error: "Missing event or order identifier." }, 400);
    if (!status && eventType !== "DRIVER_ASSIGNED") return json({ received: true, ignored: true });
    const eventDateRaw = data.updatedAt || order.updatedAt || data.createdAt || "";
    const eventAt = eventDateRaw && Number.isFinite(Date.parse(String(eventDateRaw)))
      ? new Date(String(eventDateRaw)).toISOString()
      : new Date(Number(payload.timestamp) * 1000).toISOString();
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: secretKeyFetch(serviceKey) },
    });
    // Read the server setting, while using the signed key identity to validate events
    // from either environment even if the operator has since switched the setting.
    await readLalamoveEnvironment(db);
    let driver = safeDriver(data.driver || order.driver);
    const driverId = String(data.driverId || order.driverId || data.driver?.driverId || order.driver?.driverId || "");
    if (!driver && driverId) {
      try {
        const lookup = await getLalamoveDriverDetails(matched.apiKey, matched.apiSecret, orderId, driverId, fetch, matched.environment);
        if (lookup.response.ok) driver = safeDriver(lookup.payload);
      } catch {
        // Driver detail lookup is best-effort; webhook status must still be applied.
      }
    }
    const trackingUrl = String(order.shareLink || data.shareLink || "");
    const { data: result, error } = await db.rpc("service_apply_lalamove_webhook", {
      p_event_id: eventId, p_event_type: eventType, p_event_at: eventAt,
      p_lalamove_order_id: orderId, p_status: status || "assigned",
      p_tracking_url: trackingUrl, p_driver: driver, p_ambiente: matched.environment,
    });
    if (error) {
      console.error("lalamove-webhook", { stage: "apply", code: String(error.code || "DB_ERROR") });
      return json({ error: "Could not apply webhook event." }, 500);
    }
    if (result?.unknown_order === true) return json({ error: "Order is not registered yet; retry this event." }, 503);
    return json({ received: true, ...result });
  } catch {
    return json({ error: "Webhook processing failed." }, 500);
  }
});
