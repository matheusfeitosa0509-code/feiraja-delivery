import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { formatDropoff, requestSandboxQuotation } from "../_shared/delivery-quote.ts";
import { geocodeManausAddress } from "../_shared/geocoding.ts";
import {
  buildLalamoveOrderBody, canCancelLalamove, canQuoteLalamove, canStartDispatch, isLalamoveDispatchReady, cancelLalamoveOrder, createLalamoveOrder, normalizeBrazilPhone,
  mapLalamoveStatus, priceDifference, quoteFee,
} from "../_shared/lalamove-dispatch.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const ORIGIN_LATLNG = "Av. Lourenço da Silva Braga, 700 - Centro, Manaus - AM, Brasil";

function requiredEnv(name: string) {
  const value = Deno.env.get(name) || "";
  if (!value) throw new Error("MISSING_" + name);
  return value;
}
function sandboxCredentials() {
  const key = requiredEnv("LALAMOVE_SANDBOX_API_KEY");
  const secret = requiredEnv("LALAMOVE_SANDBOX_API_SECRET");
  if (!key.startsWith("pk_test") || !secret.startsWith("sk_test")) throw new Error("SANDBOX_CREDENTIALS_REQUIRED");
  return { key, secret };
}
async function adminContext(req: Request): Promise<{ db: any; user: any; error?: undefined } | { error: Response; db?: undefined; user?: undefined }> {
  const url = requiredEnv("SUPABASE_URL");
  const anon = requiredEnv("SUPABASE_ANON_KEY");
  // Supabase's current secret API key replaces the legacy service_role JWT.
  // supabase-js 2.117+ sends sb_secret_* on apikey only.
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  let service = "";
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw);
      service = typeof secretKeys?.default === "string" ? secretKeys.default : "";
    } catch {
      throw new Error("INVALID_SUPABASE_SECRET_KEYS");
    }
  }
  if (!service) service = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token === (req.headers.get("Authorization") || "")) return { error: json({ error: "Sessão necessária." }, 401) };
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user || data.user.is_anonymous) return { error: json({ error: "Sessão válida necessária." }, 401) };
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: member, error: memberError } = await db.from("admin_users").select("user_id")
    .eq("user_id", data.user.id).maybeSingle();
  if (memberError) return { error: json({ error: "Não foi possível validar a permissão administrativa." }, 500) };
  if (!member) return { error: json({ error: "Ação permitida somente a administradores." }, 403) };
  return { db, user: data.user };
}
async function getOrder(db: any, orderId: string, requireReady = false) {
  const { data, error } = await db.from("orders").select(
    "id,status,payment_method,is_test_order,delivery_type,delivery_address,delivery_vehicle,delivery_weight_kg,delivery_fee,customer_name,customer_phone",
  ).eq("id", orderId).maybeSingle();
  if (error) throw new Error("ORDER_LOOKUP_FAILED");
  if (!data) throw new Error("ORDER_NOT_FOUND");
  if (data.delivery_type !== "delivery" || !data.delivery_address) throw new Error("NOT_HOME_DELIVERY");
  const status = String(data.status || "").trim().toLowerCase();
  const ready = isLalamoveDispatchReady(status);
  if (requireReady && !ready) throw new Error("ORDER_NOT_READY");
  if (!requireReady && !canQuoteLalamove(status, data.payment_method, data.is_test_order === true)) {
    if (["cancelada", "cancelado", "pagamento cancelado", "pagamento recusado", "reembolsado", "contestado"].includes(status)) {
      throw new Error("ORDER_NOT_QUOTABLE");
    }
    throw new Error("ORDER_NOT_PAID");
  }
  if (requireReady && data.is_test_order !== true && !String(data.payment_method || "").toLowerCase().includes("pix")) {
    throw new Error("ORDER_NOT_PAID");
  }
  return data;
}
async function fetchQuote(apiKey: string, apiSecret: string, serviceType: "LALAGO" | "CAR",
  dropoff: string, coordinates: { origin: { lat: string; lng: string }; dropoff: { lat: string; lng: string } }) {
  const response = await requestSandboxQuotation(apiKey, apiSecret, serviceType, dropoff, coordinates);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload?.message || "");
    if (code === "ERR_OUT_OF_SERVICE_AREA") throw new Error("OUT_OF_SERVICE_AREA");
    throw new Error("LALAMOVE_QUOTE_FAILED");
  }
  return payload?.data;
}
async function quoteBoth(db: any, order: any, userId: string) {
  const { data: allowed, error: rateError } = await db.rpc("consume_delivery_quote_rate_limit", { p_user_id: userId, p_max_requests: 5, p_window_seconds: 60 });
  if (rateError) throw new Error("QUOTE_RATE_LIMIT_UNAVAILABLE");
  if (allowed !== true) throw new Error("TOO_MANY_QUOTES");
  const { key, secret } = sandboxCredentials();
  const address = order.delivery_address;
  const dropoff = formatDropoff(address);
  const geocodingKey = requiredEnv("GOOGLE_GEOCODING_API_KEY");
  const [origin, destination] = await Promise.all([
    geocodeManausAddress(ORIGIN_LATLNG, geocodingKey),
    geocodeManausAddress(dropoff, geocodingKey),
  ]);
  const coordinates = { origin, dropoff: destination };
  const [moto, car] = await Promise.all([
    fetchQuote(key, secret, "LALAGO", dropoff, coordinates),
    fetchQuote(key, secret, "CAR", dropoff, coordinates),
  ]);
  const motoParsed = quoteFee(moto);
  const carParsed = quoteFee(car);
  const sessionId = crypto.randomUUID();
  const { error } = await db.rpc("service_store_lalamove_quotes", {
    p_order_id: order.id, p_session_id: sessionId,
    p_moto_quote: moto, p_car_quote: car,
    p_moto_fee: motoParsed.fee, p_car_fee: carParsed.fee,
    p_moto_expires_at: motoParsed.expiresAt, p_car_expires_at: carParsed.expiresAt,
  });
  if (error) throw new Error("QUOTE_STORE_FAILED");
  const charged = Number(order.delivery_fee || 0);
  return {
    quote_session_id: sessionId,
    delivery_fee_charged: charged,
    selected_vehicle: order.delivery_vehicle === "CAR" ? "CAR" : "MOTO",
    moto: { fee: motoParsed.fee, difference: priceDifference(motoParsed.fee, charged) },
    car: { fee: carParsed.fee, difference: priceDifference(carParsed.fee, charged) },
  };
}
async function dispatchOrder(db: any, order: any, sessionId: string, vehicle: "MOTO" | "CAR") {
  const { key, secret } = sandboxCredentials();
  const senderName = Deno.env.get("LALAMOVE_SENDER_NAME") || "Feira On Delivery";
  const senderPhone = normalizeBrazilPhone(requiredEnv("LALAMOVE_SENDER_PHONE"));
  if (!String(order.customer_name || "").trim() || !String(order.customer_phone || "").trim()) {
    throw new Error("CUSTOMER_CONTACT_MISSING");
  }
  const recipientPhone = normalizeBrazilPhone(order.customer_phone);
  const { data: start, error: startError } = await db.rpc("service_begin_lalamove_dispatch", {
    p_order_id: order.id, p_session_id: sessionId, p_vehicle: vehicle,
  });
  if (startError) {
    const message = String(startError.message || "");
    if (/not ready/i.test(message)) throw new Error("ORDER_NOT_READY");
    if (/not paid/i.test(message)) throw new Error("ORDER_NOT_PAID");
    if (/expired|replaced/i.test(message)) throw new Error("QUOTE_EXPIRED");
    throw new Error("DISPATCH_START_FAILED");
  }
  if (!canStartDispatch(start?.state) || start?.started !== true) return { duplicate: true, state: start?.state || "creating" };
  const address = order.delivery_address || {};
  const remarks = [address.complement, address.reference].map((v) => String(v || "").trim()).filter(Boolean).join(" · ");
  const body = buildLalamoveOrderBody({
    quote: start.quote, orderId: order.id, senderName, senderPhone,
    recipientName: order.customer_name, recipientPhone, remarks,
  });
  let result: { response: Response; payload: any };
  try {
    result = await createLalamoveOrder(key, secret, body);
  } catch {
    // Timeout is ambiguous: keep "creating" so a second tap cannot create another ride.
    return { pending_confirmation: true };
  }
  if (!result.response.ok) {
    if (result.response.status >= 500) return { pending_confirmation: true };
    await db.rpc("service_fail_lalamove_dispatch", {
      p_order_id: order.id, p_error_code: String(result.payload?.message || "HTTP_" + result.response.status),
    });
    if (String(result.payload?.message || "") === "ERR_QUOTATION_EXPIRED") throw new Error("QUOTE_EXPIRED");
    throw new Error("LALAMOVE_CREATE_FAILED");
  }
  const data = result.payload?.data;
  const lalamoveOrderId = String(data?.orderId || "");
  const rawCost = Number(data?.priceBreakdown?.total);
  const currency = String(data?.priceBreakdown?.currency || "").toUpperCase();
  if (!lalamoveOrderId || !Number.isFinite(rawCost) || rawCost < 0 || currency !== "BRL") {
    // The provider may already have created the order. Keep the lock for manual reconciliation.
    return { pending_confirmation: true };
  }
  const mapped = mapLalamoveStatus("ORDER_CREATED", String(data?.status || "ASSIGNING_DRIVER")) || "searching";
  const driver = data?.driver && typeof data.driver === "object" ? {
    name: String(data.driver.name || "").slice(0, 100),
    phone: String(data.driver.phone || "").slice(0, 40),
    plateNumber: String(data.driver.plateNumber || "").slice(0, 20),
  } : {};
  const { error: finishError } = await db.rpc("service_finish_lalamove_dispatch", {
    p_order_id: order.id, p_lalamove_order_id: lalamoveOrderId,
    p_actual_cost: rawCost, p_status: mapped,
    p_tracking_url: String(data?.shareLink || ""), p_driver: driver,
  });
  if (finishError) return { pending_confirmation: true };
  return { created: true, status: mapped, tracking_url: String(data?.shareLink || ""), vehicle };
}
async function cancelOrder(db: any, orderId: string) {
  const { key, secret } = sandboxCredentials();
  const { data: current, error } = await db.rpc("service_get_lalamove_dispatch", { p_order_id: orderId });
  if (error || !current?.lalamove_order_id) throw new Error("DISPATCH_NOT_FOUND");
  if (!canCancelLalamove(current.lalamove_status, current.event_updated_at)) {
    throw new Error("CANCELLATION_WINDOW_CLOSED");
  }
  const response = await cancelLalamoveOrder(key, secret, String(current.lalamove_order_id));
  if (response.status === 409) throw new Error("CANCELLATION_FORBIDDEN");
  if (!response.ok && response.status !== 204) throw new Error("LALAMOVE_CANCEL_FAILED");
  const { error: updateError } = await db.rpc("service_cancel_lalamove_dispatch", { p_order_id: orderId });
  if (updateError) throw new Error("CANCEL_STATE_UPDATE_FAILED");
  return { cancelled: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const context = await adminContext(req);
    if (context.error) return context.error;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Requisição inválida." }, 400);
    const orderId = String(body.order_id || "").trim();
    if (!orderId || orderId.length > 100) return json({ error: "Pedido inválido." }, 400);
    const action = String(body.action || "");
    if (!["quote", "create", "cancel"].includes(action)) return json({ error: "Ação inválida." }, 400);
    if (action === "cancel") return json(await cancelOrder(context.db, orderId));
    if (action === "quote") {
      const quoteOrder = await getOrder(context.db, orderId, false);
      return json(await quoteBoth(context.db, quoteOrder, context.user.id));
    }
    const readyOrder = await getOrder(context.db, orderId, true);
    const sessionId = String(body.quote_session_id || "");
    const vehicle = String(body.vehicle || "") as "MOTO" | "CAR";
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !["MOTO", "CAR"].includes(vehicle)) {
      return json({ error: "Confirme uma cotação válida e escolha moto ou carro." }, 400);
    }
    const result = await dispatchOrder(context.db, readyOrder, sessionId, vehicle);
    if (result.duplicate) return json({ error: "Este pedido já está sendo enviado ou já possui uma corrida.", ...result }, 409);
    if (result.pending_confirmation) return json({
      pending_confirmation: true,
      message: "A Lalamove ainda não confirmou a criação. O bloqueio contra duplicidade foi mantido; atualize o painel antes de tentar novamente.",
    }, 202);
    return json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, { message: string; status: number }> = {
      ORDER_NOT_FOUND: { message: "Pedido não encontrado.", status: 404 },
      NOT_HOME_DELIVERY: { message: "Este pedido não é uma entrega em casa.", status: 400 },
      ORDER_NOT_READY: { message: "Para confirmar e criar a corrida, o pedido precisa estar com status Pronto para Retirada.", status: 409 },
      ORDER_NOT_QUOTABLE: { message: "Não é possível cotar uma entrega cancelada, recusada ou reembolsada.", status: 409 },
      ORDER_NOT_PAID: { message: "Somente pedido pago ou Pix de teste pode ser despachado.", status: 409 },
      OUT_OF_SERVICE_AREA: { message: "Endereço fora da área atendida pela Lalamove.", status: 422 },
      ADDRESS_NOT_FOUND: { message: "Não foi possível localizar o endereço. Confira rua, número e bairro e tente novamente.", status: 422 },
      INVALID_ADDRESS: { message: "Endereço incompleto: informe rua, número e bairro para cotar.", status: 400 },
      ADDRESS_OUTSIDE_MANAUS: { message: "O endereço não está em Manaus.", status: 422 },
      GEOCODER_NOT_CONFIGURED: { message: "Geocodificação não configurada no servidor.", status: 503 },
      GEOCODER_UNAVAILABLE: { message: "Serviço de localização temporariamente indisponível.", status: 503 },
      SANDBOX_CREDENTIALS_REQUIRED: { message: "Credenciais de Sandbox ausentes ou inválidas no servidor.", status: 503 },
      INVALID_SUPABASE_SECRET_KEYS: { message: "A chave administrativa do Supabase está mal configurada no servidor.", status: 503 },
      INVALID_QUOTE_RESPONSE: { message: "A Lalamove retornou uma cotação inválida.", status: 502 },
      QUOTE_STORE_FAILED: { message: "As cotações foram recebidas, mas não foi possível salvá-las. Tente novamente.", status: 503 },
      LALAMOVE_QUOTE_FAILED: { message: "A Lalamove não conseguiu calcular o preço agora. Confira o endereço e tente novamente.", status: 502 },
      QUOTE_RATE_LIMIT_UNAVAILABLE: { message: "Limite de cotações temporariamente indisponível.", status: 503 },
      TOO_MANY_QUOTES: { message: "Muitas cotações. Aguarde um minuto.", status: 429 },
      QUOTE_EXPIRED: { message: "A cotação expirou. Faça uma nova cotação antes de confirmar.", status: 409 },
      CUSTOMER_CONTACT_MISSING: { message: "O pedido não tem nome e telefone válidos para o motorista.", status: 400 },
      INVALID_PHONE: { message: "Telefone do cliente ou da loja inválido. Use DDD e número brasileiro.", status: 400 },
      MISSING_LALAMOVE_SENDER_NAME: { message: "Configure o Secret LALAMOVE_SENDER_NAME no Supabase.", status: 503 },
      MISSING_LALAMOVE_SENDER_PHONE: { message: "Configure o Secret LALAMOVE_SENDER_PHONE no Supabase.", status: 503 },
      DISPATCH_NOT_FOUND: { message: "Corrida Lalamove não encontrada.", status: 404 },
      CANCELLATION_WINDOW_CLOSED: { message: "A janela de cancelamento da Lalamove já terminou.", status: 409 },
      CANCELLATION_FORBIDDEN: { message: "A Lalamove recusou o cancelamento porque a corrida não está mais na janela permitida.", status: 409 },
      LALAMOVE_CREATE_FAILED: { message: "A Lalamove recusou a criação da corrida. Você pode atualizar a cotação e tentar novamente.", status: 502 },
      LALAMOVE_CANCEL_FAILED: { message: "Não foi possível cancelar a corrida na Lalamove.", status: 502 },
      CANCEL_STATE_UPDATE_FAILED: { message: "A corrida foi cancelada na Lalamove, mas o painel não confirmou a atualização. Atualize o painel.", status: 503 },
      DISPATCH_START_FAILED: { message: "Não foi possível reservar a criação desta corrida.", status: 503 },
    };
    const mapped = messages[code];
    if (mapped) return json({ error: mapped.message, code }, mapped.status);
    console.error("lalamove-dispatch", { code });
    return json({ error: "Não foi possível concluir a operação de entrega no Sandbox.", code: "INTERNAL_ERROR" }, 500);
  }
});
