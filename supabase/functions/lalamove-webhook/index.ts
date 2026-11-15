import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { mapLalamoveStatus, verifyWebhookSignature } from "../_shared/lalamove-dispatch.ts";

const PATH = "/functions/v1/lalamove-webhook";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

function safeDriver(value: any) {
  if (!value || typeof value !== "object") return {};
  return {
    name: String(value.name || "").slice(0, 100),
    phone: String(value.phone || "").slice(0, 40),
    plateNumber: String(value.plateNumber || "").slice(0, 20),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const rawBody = await req.text();
  // Lalamove's initial webhook connectivity check may contain no body; acknowledge it.
  if (!rawBody.trim()) return new Response(null, { status: 200 });
  try {
    const apiKey = Deno.env.get("LALAMOVE_SANDBOX_API_KEY") || "";
    const apiSecret = Deno.env.get("LALAMOVE_SANDBOX_API_SECRET") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!apiKey.startsWith("pk_test") || !apiSecret.startsWith("sk_test") || !supabaseUrl || !serviceKey) {
      return json({ error: "Sandbox webhook is not configured." }, 503);
    }
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON." }, 400); }
    const valid = await verifyWebhookSignature({ apiKey, apiSecret, path: PATH, payload });
    if (!valid) return json({ error: "Invalid webhook signature." }, 401);

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
    const driver = safeDriver(data.driver || order.driver);
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
