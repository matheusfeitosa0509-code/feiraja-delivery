import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

type Payload = { timestamp: string; alert_id: string; signature: string };
type Subscription = { id: string; endpoint: string; p256dh: string; auth_secret: string };

const response = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function validSignature(secret: string, timestamp: string, alertId: string, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${alertId}.admin_alert.admin_alert`)));
  return equal(hex(digest), signature.toLowerCase());
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, { error: "METHOD_NOT_ALLOWED" });
  let payload: Payload;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return response(400, { error: "INVALID_REQUEST" });
    payload = JSON.parse(raw) as Payload;
  } catch {
    return response(400, { error: "INVALID_REQUEST" });
  }
  if (!payload || typeof payload.timestamp !== "string" || !/^\d{10}$/.test(payload.timestamp) ||
      typeof payload.alert_id !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.alert_id) ||
      typeof payload.signature !== "string") return response(400, { error: "INVALID_REQUEST" });
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(payload.timestamp)) > 300) return response(401, { error: "UNAUTHORIZED" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("PUSH_HMAC_SECRET");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!url || !serviceKey || !secret || !publicKey || !privateKey || !subject) return response(500, { error: "SERVER_CONFIGURATION_ERROR" });

  try {
    if (!await validSignature(secret, payload.timestamp, payload.alert_id, payload.signature)) return response(401, { error: "UNAUTHORIZED" });
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: alert, error: alertError } = await db.from("admin_alerts").select("id,order_id,mensagem").eq("id", payload.alert_id).maybeSingle();
    if (alertError) throw new Error("ALERT_LOOKUP_FAILED");
    if (!alert) return response(404, { error: "ALERT_NOT_FOUND" });

    const { data: admins, error: adminError } = await db.from("admin_users").select("user_id");
    if (adminError) throw new Error("ADMIN_LOOKUP_FAILED");
    const ids = [...new Set((admins ?? []).map((x: { user_id: string }) => x.user_id).filter(Boolean))];
    if (!ids.length) return response(200, { ok: true, sent: 0, attempted: 0 });

    const { data: subscriptions, error: subError } = await db.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth_secret").eq("ativo", true).in("user_id", ids);
    if (subError) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");

    webpush.setVapidDetails(subject, publicKey, privateKey);
    const target = alert.order_id
      ? `/painel.html?pedido=${encodeURIComponent(alert.order_id)}`
      : "/painel.html";
    const body = JSON.stringify({ title: "Feira On Delivery", body: alert.mensagem, url: target, tag: `admin-alert-${alert.id}` });
    let sent = 0;
    for (const row of (subscriptions ?? []) as Subscription[]) {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_secret } }, body, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (error) {
        const status = error && typeof error === "object" ? (error as { statusCode?: number }).statusCode : undefined;
        if (status === 404 || status === 410) {
          try { await db.from("push_subscriptions").delete().eq("id", row.id); } catch { /* best effort */ }
        } else {
          console.error("admin_alert_push_delivery_failed");
        }
      }
    }
    return response(200, { ok: true, sent, attempted: (subscriptions ?? []).length });
  } catch {
    console.error("admin_alert_push_failed");
    return response(500, { error: "ADMIN_ALERT_PUSH_FAILED" });
  }
});
