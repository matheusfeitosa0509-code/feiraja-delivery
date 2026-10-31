import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const protectedAdministrativeStatuses = new Set([
  "saiu para entrega",
  "preparando",
  "pronto para retirada",
  "entregue",
  "preparando pedido",
  "concluído",
  "concluido",
  "received",
  "recebido",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (Deno.env.get("ASAAS_ENABLED") !== "true") {
    return json({ error: "Integração Asaas temporariamente desativada." }, 503);
  }

  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_AUTH_TOKEN");
  if (!expectedToken) {
    console.error("ASAAS_WEBHOOK_AUTH_TOKEN não configurado.");
    return json({ error: "Webhook Asaas não configurado." }, 503);
  }

  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const suppliedToken = req.headers.get("asaas-access-token") || "";
  if (!suppliedToken || !constantTimeEqual(suppliedToken, expectedToken)) {
    return json({ error: "Autenticação do webhook inválida." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("Configuração interna do webhook Asaas incompleta.");
    return json({ error: "Configuração interna incompleta." }, 503);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Notificação inválida." }, 400);

  const event = String((body as any).event || "");
  if (event !== "PAYMENT_RECEIVED" && event !== "PAYMENT_CONFIRMED") {
    // Other Asaas events are acknowledged but do not change order state in this implementation.
    return json({ received: true, ignored: true });
  }

  const payment = (body as any).payment;
  const paymentId = String(payment?.id || "");
  const externalReference = String(payment?.externalReference || "");
  const billingType = String(payment?.billingType || "").toUpperCase();
  const paymentValue = Number(payment?.value);

  if (!paymentId || !externalReference || billingType !== "PIX" ||
      !Number.isFinite(paymentValue) || paymentValue <= 0) {
    return json({ received: true, ignored: true });
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error: orderReadError } = await db.from("orders")
    .select("id,status,total,payment_id,payment_provider,created_at")
    .eq("id", externalReference)
    .eq("payment_provider", "asaas")
    .maybeSingle();

  if (orderReadError) {
    console.error("Falha ao consultar pedido para webhook Asaas.");
    return json({ error: "Falha ao consultar pedido." }, 500);
  }
  if (!order || String(order.payment_provider || "") !== "asaas" ||
      String(order.id || "") !== externalReference) {
    return json({ received: true, ignored: true });
  }
  const normalizedStatus = String(order.status || "").trim().toLowerCase();
  const isCancelledOrder = normalizedStatus === "cancelada" || normalizedStatus === "cancelado";
  const storedPaymentId = String(order.payment_id || "");

  // Cancelled orders without a stored charge, or with a different charge, are never changed.
  if (isCancelledOrder && !storedPaymentId) {
    return json({ received: true, ignored: true, reason: "pedido_cancelado_sem_payment_id" });
  }
  if (isCancelledOrder && storedPaymentId !== paymentId) {
    return json({ received: true, ignored: true, reason: "pedido_cancelado_payment_id_diferente" });
  }

  // Give checkout ten minutes to link the charge. After that, acknowledge for manual
  // review without linking or mutating the order, regardless of its non-cancelled status.
  if (!storedPaymentId) {
    const createdAtMs = Date.parse(String(order.created_at || ""));
    const ageMs = Date.now() - createdAtMs;
    if (Number.isFinite(createdAtMs) && ageMs >= 10 * 60 * 1000) {
      console.warn(
        "Pedido Asaas sem payment_id há pelo menos 10 minutos; revisão manual necessária. Pedido:",
        "charge_id_present:",
        Boolean(paymentId),
      );
      return json({ received: true, ignored: true, reason: "payment_id_missing_stale_order" });
    }
    console.error("Cobrança Asaas ainda não vinculada; solicitando nova entrega.");
    return json({ error: "Cobrança ainda não vinculada ao pedido." }, 503);
  }
  if (storedPaymentId !== paymentId) {
    return json({ received: true, ignored: true });
  }

  const rawBaseUrl = Deno.env.get("ASAAS_BASE_URL");
  const apiKey = Deno.env.get("ASAAS_API_KEY") || "";
  if (!rawBaseUrl || !rawBaseUrl.trim() || !apiKey) {
    return json({ error: "Não foi possível validar a cobrança." }, 503);
  }

  let asaasBaseUrl: string;
  try {
    const configuredBase = new URL(rawBaseUrl);
    if (configuredBase.protocol !== "https:" ||
        !["api.asaas.com", "api-sandbox.asaas.com"].includes(configuredBase.hostname) ||
        configuredBase.pathname !== "/" || configuredBase.search || configuredBase.hash) {
      return json({ error: "Não foi possível validar a cobrança." }, 503);
    }
    asaasBaseUrl = configuredBase.origin;
  } catch {
    return json({ error: "Não foi possível validar a cobrança." }, 503);
  }

  let verifiedPayment: any;
  try {
    const verificationResponse = await fetch(
      asaasBaseUrl + "/v3/payments/" + encodeURIComponent(paymentId),
      { method: "GET", headers: { access_token: apiKey, Accept: "application/json" } },
    );
    if (!verificationResponse.ok) {
      return json({ error: "Não foi possível validar a cobrança." }, 503);
    }
    verifiedPayment = await verificationResponse.json();
  } catch {
    return json({ error: "Não foi possível validar a cobrança." }, 503);
  }

  const verifiedStatus = String(verifiedPayment?.status || "").toUpperCase();
  const verifiedValue = Number(verifiedPayment?.value);
  const expectedCents = Math.round(Number(order.total) * 100);
  const paidCents = Math.round(paymentValue * 100);
  const verifiedCents = Math.round(verifiedValue * 100);
  if (String(verifiedPayment?.id || "") !== paymentId ||
      String(verifiedPayment?.externalReference || "") !== externalReference ||
      String(verifiedPayment?.billingType || "").toUpperCase() !== "PIX" ||
      !["RECEIVED", "CONFIRMED"].includes(verifiedStatus) ||
      !Number.isFinite(expectedCents) || expectedCents <= 0 ||
      !Number.isFinite(paidCents) || paidCents !== expectedCents ||
      !Number.isFinite(verifiedCents) || verifiedCents !== expectedCents) {
    return json({ error: "Não foi possível validar a cobrança." }, 503);
  }

  if (isCancelledOrder) {
    console.warn(
      "Pagamento Asaas recebido para pedido cancelado; restauração validada por ID e valor.",
      "charge_id_present:",
      Boolean(paymentId),
    );
  }

  if (normalizedStatus === "pagamento confirmado") {
    return json({ received: true, ignored: true, reason: "pagamento_ja_confirmado" });
  }

  if (protectedAdministrativeStatuses.has(normalizedStatus)) {
    return json({ received: true, ignored: true, reason: "status_administrativo_preservado" });
  }
  const { data: updatedOrder, error: updateError } = await db.from("orders")
    .update({ status: "Pagamento Confirmado" })
    .eq("id", order.id)
    .eq("payment_provider", "asaas")
    .eq("payment_id", paymentId)
    .eq("status", order.status)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("Falha ao atualizar pedido após webhook Asaas.");
    return json({ error: "Falha ao atualizar pedido." }, 500);
  }
  if (!updatedOrder) return json({ received: true, ignored: true });
  return json({ received: true });
});
