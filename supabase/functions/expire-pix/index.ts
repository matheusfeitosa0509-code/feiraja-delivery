import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SIMULATION_MODE = true; // Segurança: expiração permanece em simulação até autorização explícita.
const ALLOWED_ORIGINS = new Set([
  "https://www.feiraondelivery.com.br",
  "https://feiraondelivery.com.br",
  "https://matheusfeitosa0509-code.github.io",
]);
const corsHeadersFor = (origin: string | null) => ({
  ...(origin && ALLOWED_ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
    : {}),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const respond = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond({ error: "Origem não autorizada." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(origin) });
  if (req.method !== "POST") return respond({ error: "Use POST." }, 405, origin);

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return respond({ error: "Autenticação obrigatória." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const mpToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "";
  const asaasApiKey = Deno.env.get("ASAAS_API_KEY") || "";
  const rawAsaasBaseUrl = Deno.env.get("ASAAS_BASE_URL") || "";
  let asaasBaseUrl = "";
  try {
    const configuredBase = new URL(rawAsaasBaseUrl);
    if (configuredBase.protocol === "https:" &&
        ["api.asaas.com", "api-sandbox.asaas.com"].includes(configuredBase.hostname) &&
        configuredBase.pathname === "/" && !configuredBase.search && !configuredBase.hash) {
      asaasBaseUrl = configuredBase.origin;
    }
  } catch {
    asaasBaseUrl = "";
  }
  if (!supabaseUrl || !serviceKey) {
    // Não revelar qual configuração interna está ausente.
    return respond({ error: "Configuração interna indisponível; nenhum pedido foi alterado." }, 503, origin);
  }

  const authClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY") || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return respond({ error: "Sessão inválida; acesso negado." }, 401, origin);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admin, error: adminError } = await db
    .from("admin_users").select("user_id")
    .eq("user_id", authData.user.id).maybeSingle();
  if (adminError) return respond({ error: "Não foi possível verificar autorização." }, 503, origin);
  if (!admin) return respond({ error: "Somente administradores autorizados." }, 403, origin);

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const results: Record<string, unknown>[] = [];
  let changedOrders = 0;

  // Mercado Pago: mantém a validação existente em modo somente leitura.
  if (mpToken) {
    const { data: mpOrders, error: mpOrdersError } = await db.from("orders")
      .select("id,status,payment_method,payment_id,created_at")
      .eq("payment_method", "Mercado Pago Pix")
      .eq("status", "Aguardando Pagamento Pix")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(500);
    if (mpOrdersError) return respond({ error: "Falha ao consultar pedidos; nenhum pedido foi alterado." }, 503, origin);

    const mpResults = await Promise.all((mpOrders || []).map(async (order: any) => {
      const ageMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
      if (!order.payment_id) {
        return { provider: "mercado_pago", order_id: order.id, age_minutes: ageMinutes, provider_status: "não verificado", simulated_action: "Manter pendente; payment_id ausente" };
      }
      try {
        const response = await fetch(
          "https://api.mercadopago.com/v1/payments/" + encodeURIComponent(String(order.payment_id)),
          { headers: { Authorization: "Bearer " + mpToken } },
        );
        const payment = await response.json().catch(() => ({}));
        if (!response.ok || String(payment?.id) !== String(order.payment_id) ||
            String(payment?.external_reference || "") !== String(order.id) ||
            String(payment?.payment_method_id || "").toLowerCase() !== "pix") {
          return { provider: "mercado_pago", order_id: order.id, age_minutes: ageMinutes, provider_status: "não verificado", simulated_action: "Manter pendente; consulta/validação inconclusiva" };
        }
        const state = String(payment?.status || "");
        if (state === "approved" || ["pending", "in_process", "authorized", "in_mediation"].includes(state)) {
          return { provider: "mercado_pago", order_id: order.id, age_minutes: ageMinutes, provider_status: state, simulated_action: "Não alterar" };
        }
        if (["rejected", "cancelled", "refunded", "charged_back"].includes(state)) {
          return { provider: "mercado_pago", order_id: order.id, age_minutes: ageMinutes, provider_status: state, simulated_action: "Não alterar; fluxo Mercado Pago permanece somente leitura" };
        }
        return { provider: "mercado_pago", order_id: order.id, age_minutes: ageMinutes, provider_status: "não verificado", simulated_action: "Manter pendente; estado desconhecido" };
      } catch {
        return { provider: "mercado_pago", order_id: order.id, age_minutes: ageMinutes, provider_status: "não verificado", simulated_action: "Manter pendente; erro na consulta" };
      }
    }));
    results.push(...mpResults);
  }

  // Asaas: só considera cobranças cujo estado OVERDUE foi confirmado diretamente na API.
  if (asaasApiKey && asaasBaseUrl) {
    const { data: asaasOrders, error: asaasOrdersError } = await db.from("orders")
      .select("id,status,payment_method,payment_id,payment_provider,total,created_at")
      .eq("payment_provider", "asaas")
      .eq("payment_method", "Asaas Pix")
      .eq("status", "Pagamento Pendente")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(500);
    if (asaasOrdersError) return respond({ error: "Falha ao consultar pedidos Asaas; nenhum pedido foi alterado." }, 503, origin);

    const asaasResults = await Promise.all((asaasOrders || []).map(async (order: any) => {
      const ageMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
      if (!order.payment_id) {
        return { provider: "asaas", order_id: order.id, age_minutes: ageMinutes, provider_status: "não verificado", simulated_action: "Manter pendente; payment_id ausente" };
      }
      try {
        const response = await fetch(
          asaasBaseUrl + "/v3/payments/" + encodeURIComponent(String(order.payment_id)),
          { method: "GET", headers: { access_token: asaasApiKey, Accept: "application/json" } },
        );
        const payment = await response.json().catch(() => ({}));
        const validPayment = response.ok &&
          String(payment?.id || "") === String(order.payment_id) &&
          String(payment?.externalReference || "") === String(order.id) &&
          String(payment?.billingType || "").toUpperCase() === "PIX" &&
          Number.isFinite(Number(payment?.value)) &&
          Math.round(Number(payment.value) * 100) === Math.round(Number(order.total) * 100);
        if (!validPayment) {
          return { provider: "asaas", order_id: order.id, age_minutes: ageMinutes, provider_status: "não verificado", simulated_action: "Manter pendente; consulta/validação inconclusiva" };
        }
        const state = String(payment?.status || "").toUpperCase();
        if (state !== "OVERDUE") {
          return { provider: "asaas", order_id: order.id, age_minutes: ageMinutes, provider_status: state || "desconhecido", simulated_action: "Não expirar; Asaas não confirmou OVERDUE" };
        }
        if (SIMULATION_MODE) {
          return { provider: "asaas", order_id: order.id, age_minutes: ageMinutes, provider_status: state, simulated_action: "Simular alteração para Cancelada; banco preservado" };
        }
        const { data: updated, error: updateError } = await db.from("orders")
          .update({ status: "Cancelada" })
          .eq("id", order.id)
          .eq("payment_provider", "asaas")
          .eq("payment_id", order.payment_id)
          .eq("status", "Pagamento Pendente")
          .select("id")
          .maybeSingle();
        if (updateError) {
          return { provider: "asaas", order_id: order.id, age_minutes: ageMinutes, provider_status: state, simulated_action: "Falha ao atualizar; revisar" };
        }
        if (updated) changedOrders++;
        return { provider: "asaas", order_id: order.id, age_minutes: ageMinutes, provider_status: state, simulated_action: updated ? "Pedido marcado como Cancelada" : "Nenhuma alteração; estado mudou durante a execução" };
      } catch {
        return { provider: "asaas", order_id: order.id, age_minutes: ageMinutes, provider_status: "não verificado", simulated_action: "Manter pendente; erro na consulta" };
      }
    }));
    results.push(...asaasResults);
  }

  return respond({
    function: "expire-pix",
    mode: SIMULATION_MODE ? "SIMULAÇÃO" : "ATIVO",
    read_only: SIMULATION_MODE,
    checked_at: new Date().toISOString(),
    eligible_count: results.length,
    changed_orders: changedOrders,
    results,
    note: SIMULATION_MODE
      ? "Modo de simulação: nenhum pedido foi alterado. Para ativar, configure EXPIRE_PIX_SIMULATION_MODE=false."
      : "Modo ativo: somente pedidos Asaas com cobrança validada como OVERDUE podem ser marcados como Cancelada.",
  }, 200, origin);
});