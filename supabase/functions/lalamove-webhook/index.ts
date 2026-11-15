import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { getLalamoveDriverDetails, isWebhookVerificationProbe, mapLalamoveStatus, verifyWebhookSignature } from "../_shared/lalamove-dispatch.ts";

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
    const apiKey = Deno.env.get("LALAMOVE_SANDBOX_API_KEY") || "";
    const apiSecret = Deno.env.get("LALAMOVE_SANDBOX_API_SECRET") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!apiKey.startsWith("pk_test") || !apiSecret.startsWith("sk_test") || !supabaseUrl || !serviceKey) {
      return json({ error: "Sandbox webhook is not configured." }, 503);
    }
    const valid = await verifyWebhookSignature({ apiKey, apiSecret, path: PATH, payload });
    // Never process an unsigned/forged event. HTTP 200 acknowledges receipt so Lalamove
    // does not disable the configured URL; the event has no database side effects.
    if (!valid) return json({ received: true, ignored: true });

    const data = payload.data || {};
    const order = data.order && typeof data.order === "object" ? data.order : data;
    const orderId = String(order.orderId || order.id || data.orderId || "");
    const eventId = String(payload.eventId || data.eventId || "");
    const eventType = String(payload.eventType || data.eventType || "UNKNOWN");
    const status = mapLalamoveStatus(eventType, String(order.status || data.status || ""));
    if (!orderId || !eventId) return json({ error: "Missing event or order identifier." }, 400);
    if (!status && eventType !== "DRIVER_ASSIGNED") return json({ received: true, ignored: true });
    const eventDateRaw = data.updatedAt || order.updatedAt || data.createdAt || "";
    const eventAt = eventDateRaw && Number.isFinite(Date.parse(String(eventDateRaw)))
      ? new Date(String(eventDateRaw)).toISOString()
      : new Date(Number(payload.timestamp) * 1000).toISOString();
    let driver = safeDriver(data.driver || order.driver);
    const driverId = String(data.driverId || order.driverId || data.driver?.driverId || order.driver?.driverId || "");
    if (!driver && driverId) {
      try {
        const lookup = await getLalamoveDriverDetails(apiKey, apiSecret, orderId, driverId);
        if (lookup.response.ok) driver = safeDriver(lookup.payload);
      } catch {
        // Driver detail lookup is best-effort; webhook status must still be applied.
      }
    }
    const trackingUrl = String(order.shareLink || data.shareLink || "");
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: result, error } = await db.rpc("service_apply_lalamove_webhook", {
      p_event_id: eventId, p_event_type: eventType, p_event_at: eventAt,
      p_lalamove_order_id: orderId, p_status: status || "assigned",
      p_tracking_url: trackingUrl, p_driver: driver,
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
