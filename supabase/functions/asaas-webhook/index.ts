import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_JSON_BODY_BYTES = 64 * 1024;

// Compartilha o modo seguro com expire-pix: simulação é o padrão.
const EXPIRE_PIX_SIMULATION_MODE = true; // Nenhum pedido é cancelado automaticamente sem autorização explícita.
async function readJsonBody(req: Request): Promise<any> {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
      throw new RangeError("BODY_TOO_LARGE");
    }
  }
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SyntaxError("INVALID_JSON");
  }
}

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
  "pagamento reembolsado",
  "pagamento contestado",
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
    console.info("Webhook Asaas ignorado: integração desativada.");
    return json({ received: true, ignored: true });
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

  let body: any;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RangeError) return json({ error: "Corpo da notificação excede o limite de 65536 bytes." }, 413);
    return json({ error: "Notificação JSON inválida." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Notificação inválida." }, 400);

  const event = String((body as any).event || "");
  const isRefundEvent = event === "PAYMENT_REFUNDED";
  const isChargebackEvent = event === "PAYMENT_CHARGEBACK_REQUESTED";
  const isOverdueEvent = event === "PAYMENT_OVERDUE";
  const isPaymentConfirmationEvent = event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED";
  if (!isPaymentConfirmationEvent && !isRefundEvent && !isChargebackEvent && !isOverdueEvent) {
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
    if (verificationResponse.status === 408 ||
        verificationResponse.status === 429 ||
        verificationResponse.status >= 500) {
      console.error("Consulta Asaas temporariamente indisponível.", { http_status: verificationResponse.status });
      return json({ error: "Não foi possível validar a cobrança." }, 503);
    }
    if (verificationResponse.status === 401 || verificationResponse.status === 403) {
      console.error("Consulta Asaas: credencial ou configuração Asaas inválida.", {
        http_status: verificationResponse.status,
      });
      return json({ error: "Não foi possível validar a cobrança." }, 503);
    }
    if (verificationResponse.status >= 400 && verificationResponse.status < 500) {
      console.warn("Consulta Asaas recusada sem confirmação do pedido.", { http_status: verificationResponse.status });
      return json({ received: true, ignored: true, reason: "consulta_permanentemente_recusada" });
    }
    if (!verificationResponse.ok) {
      console.error("Consulta Asaas falhou sem confirmação do pedido.", { http_status: verificationResponse.status });
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
  const verifiedChargebackStatus = String(verifiedPayment?.chargeback?.status || "").toUpperCase();
  const verifiedStatusAccepted = isRefundEvent
    ? verifiedStatus === "REFUNDED"
    : isChargebackEvent
    ? ["RECEIVED", "CONFIRMED"].includes(verifiedStatus) && verifiedChargebackStatus === "REQUESTED"
    : isOverdueEvent
    ? verifiedStatus === "OVERDUE"
    : ["RECEIVED", "CONFIRMED"].includes(verifiedStatus);
  if (String(verifiedPayment?.id || "") !== paymentId ||
      String(verifiedPayment?.externalReference || "") !== externalReference ||
      String(verifiedPayment?.billingType || "").toUpperCase() !== "PIX" ||
      !verifiedStatusAccepted ||
      !Number.isFinite(expectedCents) || expectedCents <= 0 ||
      !Number.isFinite(paidCents) || paidCents !== expectedCents ||
      !Number.isFinite(verifiedCents) || verifiedCents !== expectedCents) {
    const mismatch = String(verifiedPayment?.id || "") !== paymentId ? "id_divergente" :
      String(verifiedPayment?.externalReference || "") !== externalReference ? "referencia_divergente" :
      String(verifiedPayment?.billingType || "").toUpperCase() !== "PIX" ? "tipo_divergente" :
      !verifiedStatusAccepted ? "status_nao_aceito" :
      (!Number.isFinite(expectedCents) || expectedCents <= 0 || !Number.isFinite(paidCents) || paidCents !== expectedCents ||
        !Number.isFinite(verifiedCents) || verifiedCents !== expectedCents) ? "valor_divergente" : "dados_divergentes";
    console.warn("Webhook Asaas ignorado após consulta bem-sucedida: divergência permanente.", { mismatch });
    return json({ received: true, ignored: true, reason: "divergencia_permanente" });
  }

  if (isOverdueEvent) {
    if (normalizedStatus !== "pagamento pendente") {
      return json({ received: true, ignored: true, reason: "pedido_nao_pendente_ou_status_preservado" });
    }
    if (EXPIRE_PIX_SIMULATION_MODE) {
      return json({
        received: true,
        ignored: true,
        simulated: true,
        reason: "EXPIRE_PIX_SIMULATION_MODE",
      });
    }
    const { data: expiredOrder, error: overdueUpdateError } = await db.from("orders")
      .update({ status: "Cancelada" })
      .eq("id", order.id)
      .eq("payment_provider", "asaas")
      .eq("payment_id", paymentId)
      .eq("status", order.status)
      .select("id")
      .maybeSingle();
    if (overdueUpdateError) {
      console.error("Falha ao registrar expiração de cobrança Asaas.");
      return json({ error: "Falha ao atualizar pedido." }, 500);
    }
    if (!expiredOrder) return json({ received: true, ignored: true });
    return json({ received: true, expired: true });
  }

  if (isRefundEvent || isChargebackEvent) {
    const targetStatus = isRefundEvent ? "Pagamento reembolsado" : "Pagamento contestado";
    const normalizedTargetStatus = targetStatus.toLowerCase();
    if (normalizedStatus === normalizedTargetStatus) {
      return json({ received: true, ignored: true, reason: "status_financeiro_ja_registrado" });
    }
    const paidOrderStatuses = new Set([
      "pagamento confirmado",
      "preparando",
      "pronto para retirada",
      "saiu para entrega",
      "entregue",
      "preparando pedido",
      "concluído",
      "concluido",
    ]);
    if (!paidOrderStatuses.has(normalizedStatus)) {
      return json({ received: true, ignored: true, reason: "pedido_nao_pago_ou_status_nao_elegivel" });
    }
    const { data: updatedFinancialOrder, error: financialUpdateError } = await db.from("orders")
      .update({ status: targetStatus })
      .eq("id", order.id)
      .eq("payment_provider", "asaas")
      .eq("payment_id", paymentId)
      .eq("status", order.status)
      .select("id")
      .maybeSingle();

    if (financialUpdateError) {
      console.error("Falha ao registrar status financeiro após webhook Asaas.");
      return json({ error: "Falha ao atualizar pedido." }, 500);
    }
    if (!updatedFinancialOrder) return json({ received: true, ignored: true });
    return json({ received: true });
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
