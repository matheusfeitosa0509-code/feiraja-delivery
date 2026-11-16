import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { requireSupabaseSecretKey, secretKeyFetch } from "../_shared/lalamove-dispatch.ts";
import { normalizeLalamoveEnvironment, readLalamoveCredentials, readLalamoveEnvironment } from "../_shared/lalamove-environment.ts";
import { isTerminalTrackingStatus } from "../_shared/lalamove-tracking.ts";
import { getProviderTracking } from "./providers/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
function requiredEnv(name: string) {
  const value = Deno.env.get(name) || "";
  if (!value) throw new Error("MISSING_" + name);
  return value;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const url = requiredEnv("SUPABASE_URL");
    const anon = requiredEnv("SUPABASE_ANON_KEY");
    const service = requireSupabaseSecretKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token || token === authorization) return json({ error: "Sessão necessária." }, 401);
    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData?.user || authData.user.is_anonymous) return json({ error: "Sessão válida necessária." }, 401);

    const body = await req.json().catch(() => null);
    const orderId = String(body?.order_id || "").trim();
    if (!orderId || orderId.length > 100) return json({ error: "Pedido inválido." }, 400);
    const db = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: secretKeyFetch(service) },
    });
    const configuredEnvironment = await readLalamoveEnvironment(db);
    const { data: order, error: orderError } = await db.from("orders")
      .select("id,user_id,status,delivery_type,delivery_vehicle")
      .eq("id", orderId).maybeSingle();
    if (orderError) return json({ error: "Não foi possível consultar o pedido." }, 503);
    if (!order || order.delivery_type !== "delivery") return json({ error: "Pedido não encontrado." }, 404);

    const { data: admin, error: adminError } = await db.from("admin_users").select("user_id")
      .eq("user_id", authData.user.id).maybeSingle();
    if (adminError) return json({ error: "Não foi possível validar o acesso." }, 503);
    const isOwner = String(order.user_id || "") === String(authData.user.id);
    if (!isOwner && !admin) return json({ error: "Pedido não encontrado." }, 404);

    const { data: allowed, error: rateError } = await db.rpc("consume_lalamove_tracking_rate_limit", {
      p_user_id: authData.user.id, p_max_requests: 30, p_window_seconds: 60,
    });
    if (rateError) return json({ error: "Limite de rastreio temporariamente indisponível." }, 503);
    if (allowed !== true) return json({ error: "Muitas atualizações de rastreio. Aguarde alguns segundos." }, 429);

    const { data: dispatch, error: dispatchError } = await db.rpc("service_get_lalamove_dispatch", { p_order_id: orderId });
    if (dispatchError) return json({ error: "Não foi possível consultar a corrida." }, 503);
    if (!dispatch?.lalamove_order_id) return json({ active: false, status: "searching", driver_assigned: false });

    const storedStatus = String(dispatch.lalamove_status || "");
    if (String(order.status || "") === "Entregue") return json({ active: false, status: "delivered" });
    if (["Cancelada", "Reembolsado", "Contestado", "Pagamento cancelado", "Pagamento recusado"].includes(String(order.status || ""))) {
      return json({ active: false, status: "cancelled" });
    }
    if (isTerminalTrackingStatus(storedStatus)) return json({ active: false, status: storedStatus });
    const environment = normalizeLalamoveEnvironment(dispatch.ambiente || configuredEnvironment);
    const credentials = readLalamoveCredentials(environment, (name) => Deno.env.get(name));
    const tracking = await getProviderTracking("lalamove", credentials.apiKey, credentials.apiSecret, String(dispatch.lalamove_order_id), environment);
    const status = tracking.status;
    const driverSummary = tracking.driver ? {
      ...(tracking.driver.name ? { name: tracking.driver.name } : {}),
      ...(tracking.driver.plateNumber ? { plateNumber: tracking.driver.plateNumber } : {}),
      ...(tracking.driver.photo ? { photo: tracking.driver.photo } : {}),
    } : null;
    const storedDriver = dispatch.driver && typeof dispatch.driver === "object" ? dispatch.driver : {};
    const storedDriverSummary = {
      ...(storedDriver.name ? { name: storedDriver.name } : {}),
      ...(storedDriver.plateNumber ? { plateNumber: storedDriver.plateNumber } : {}),
      ...(storedDriver.photo ? { photo: storedDriver.photo } : {}),
    };
    const driverChanged = !!driverSummary &&
      JSON.stringify(driverSummary) !== JSON.stringify(Object.keys(storedDriverSummary).length ? storedDriverSummary : null);
    let effectiveStatus = status;
    let syncResult: any = null;
    if (status !== storedStatus || driverChanged ||
        (tracking.tracking_url && tracking.tracking_url !== dispatch.tracking_url)) {
      const { data: syncData, error: syncError } = await db.rpc("service_update_lalamove_tracking_status", {
        p_order_id: orderId,
        p_lalamove_order_id: String(dispatch.lalamove_order_id),
        p_status: status,
        p_tracking_url: tracking.tracking_url || null,
        p_driver: driverSummary,
      });
      if (syncError) return json({ error: "Não foi possível atualizar o status do rastreio." }, 503);
      syncResult = syncData;
      if (syncResult?.stale_attempt) return json({ active: false, status: storedStatus || "cancelled" });
      if (syncResult?.terminal_status) effectiveStatus = String(syncResult.terminal_status) as typeof status;
      else if (syncResult?.stale_status) effectiveStatus = String(syncResult.status || storedStatus || status) as typeof status;
    }
    return json({
      active: !isTerminalTrackingStatus(effectiveStatus),
      status: effectiveStatus,
      provider: tracking.provider,
      driver_assigned: tracking.driver_assigned,
      vehicle: order.delivery_vehicle === "CAR" ? "CAR" : "MOTO",
      store: tracking.store,
      customer: tracking.customer,
      driver: tracking.driver,
      tracking_url: tracking.tracking_url || String(dispatch.tracking_url || ""),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, { message: string; status: number }> = {
      PROVIDER_NOT_CONFIGURED: { message: "Rastreio deste entregador ainda não está disponível.", status: 503 },
      SANDBOX_CREDENTIALS_REQUIRED: { message: "Rastreio Lalamove temporariamente indisponível.", status: 503 },
      PRODUCTION_CREDENTIALS_REQUIRED: { message: "Credenciais Lalamove de produção ausentes ou inválidas no servidor.", status: 503 },
      LALAMOVE_ENVIRONMENT_UNAVAILABLE: { message: "Não foi possível ler o ambiente Lalamove configurado.", status: 503 },
      LALAMOVE_ORDER_DETAILS_FAILED: { message: "Não foi possível consultar a corrida na Lalamove.", status: 502 },
      LALAMOVE_STATUS_UNKNOWN: { message: "A Lalamove retornou um status ainda não reconhecido.", status: 502 },
    };
    const mapped = messages[code];
    if (mapped) return json({ error: mapped.message }, mapped.status);
    console.error("lalamove-tracking", { code });
    return json({ error: "Não foi possível atualizar o rastreio." }, 500);
  }
});
