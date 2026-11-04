import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SIMULATION_MODE = true; // Segurança: esta versão é somente leitura.
const ALLOWED_ORIGIN = "https://matheusfeitosa0509-code.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== ALLOWED_ORIGIN) return respond({ error: "Origem não autorizada." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Use POST." }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return respond({ error: "Autenticação obrigatória." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const mpToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  if (!supabaseUrl || !serviceKey || !mpToken) {
    // Não revelar qual configuração interna está ausente.
    return respond({ error: "Configuração interna indisponível; nenhum pedido foi alterado." }, 503);
  }

  const authClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY") || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return respond({ error: "Sessão inválida; acesso negado." }, 401);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admin, error: adminError } = await db
    .from("admin_users").select("user_id")
    .eq("user_id", authData.user.id).maybeSingle();
  if (adminError) return respond({ error: "Não foi possível verificar autorização." }, 503);
  if (!admin) return respond({ error: "Somente administradores autorizados." }, 403);

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: orders, error: ordersError } = await db.from("orders")
    .select("id,status,payment_method,payment_id,created_at")
    .eq("payment_method", "Mercado Pago Pix")
    .eq("status", "Aguardando Pagamento Pix")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(500);
  if (ordersError) return respond({ error: "Falha ao consultar pedidos; nenhum pedido foi alterado." }, 503);

  const results = await Promise.all((orders || []).map(async (order: any) => {
    const ageMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
    if (!order.payment_id) {
      return { order_id: order.id, age_minutes: ageMinutes, mercado_pago: "não verificado", simulated_action: "Manter pendente; payment_id ausente" };
    }
    try {
      const mpResponse = await fetch(
        "https://api.mercadopago.com/v1/payments/" + encodeURIComponent(String(order.payment_id)),
        { headers: { Authorization: "Bearer " + mpToken } },
      );
      const payment = await mpResponse.json().catch(() => ({}));
      if (!mpResponse.ok || String(payment?.id) !== String(order.payment_id) ||
          String(payment?.external_reference || "") !== String(order.id) ||
          String(payment?.payment_method_id || "").toLowerCase() !== "pix") {
        return { order_id: order.id, age_minutes: ageMinutes, mercado_pago: "não verificado", simulated_action: "Manter pendente; consulta/validação inconclusiva" };
      }
      const state = String(payment?.status || "");
      if (state === "approved") {
        return { order_id: order.id, age_minutes: ageMinutes, mercado_pago: "approved", simulated_action: "Não mexer" };
      }
      if (["pending", "in_process", "authorized", "in_mediation"].includes(state)) {
        return { order_id: order.id, age_minutes: ageMinutes, mercado_pago: state, simulated_action: "Manter pendente; não simular cancelamento" };
      }
      if (["rejected", "cancelled", "refunded", "charged_back"].includes(state)) {
        return { order_id: order.id, age_minutes: ageMinutes, mercado_pago: state, simulated_action: "Não cancelar; estado não é pendência confirmada" };
      }
      return { order_id: order.id, age_minutes: ageMinutes, mercado_pago: "não verificado", simulated_action: "Manter pendente; estado desconhecido" };
    } catch {
      return { order_id: order.id, age_minutes: ageMinutes, mercado_pago: "não verificado", simulated_action: "Manter pendente; erro na consulta" };
    }
  }));

  return respond({
    function: "expire-pix",
    mode: SIMULATION_MODE ? "SIMULAÇÃO" : "ATIVO",
    read_only: true,
    checked_at: new Date().toISOString(),
    eligible_count: results.length,
    changed_orders: 0,
    results,
    note: "Esta versão não contém operação de UPDATE nem cancelamento.",
  });
});