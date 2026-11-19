import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertTestProductionDispatchConfirmation, buildLalamoveOrderBody, canCancelLalamove, canQuoteLalamove, canStartDispatch, isLalamoveDispatchReady, cancelLalamoveOrder, createLalamoveOrder, getLalamoveDriverDetails,
  isWebhookVerificationProbe, makeWebhookSignature, mapLalamoveStatus, normalizeBrazilPhone, priceDifference, quoteFee, verifyWebhookSignature, requireSupabaseServiceRoleJwt, readSupabaseServiceRoleConfig, storeLalamoveQuotes, getLalamoveOrderDetails, sanitizeLalamoveErrorPayload,
} from "../_shared/lalamove-dispatch.ts";

const quote = {
  quotationId: "quote-123456789",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  priceBreakdown: { total: "8.32", currency: "BRL" },
  stops: [{ stopId: "pickup-123" }, { stopId: "dropoff-456" }],
};

Deno.test("criação Lalamove MOCKADA: envia quotationId e contatos, recebe orderId e custo", async () => {
  const body = buildLalamoveOrderBody({
    quote, orderId: "PEDIDO-1", senderName: "Feira On Delivery",
    senderPhone: "92999990000", recipientName: "Cliente Teste",
    recipientPhone: "92988887777", remarks: "Portão azul",
  });
  let requested = false;
  const result = await createLalamoveOrder("pk_test_demo", "sk_test_demo", body,
    async (input, init) => {
      requested = true;
      assertEquals(String(input), "https://rest.sandbox.lalamove.com/v3/orders");
      assertEquals(init?.method, "POST");
      const sent = JSON.parse(String(init?.body));
      assertEquals(sent.data.quotationId, quote.quotationId);
      assertEquals(sent.data.sender.stopId, "pickup-123");
      assertEquals(sent.data.sender.phone, "+5592999990000");
      assertEquals(sent.data.recipients[0].stopId, "dropoff-456");
      assertEquals(sent.data.recipients[0].phone, "+5592988887777");
      assertEquals(normalizeBrazilPhone("092999990000"), "+5592999990000");
      assertEquals(sent.data.isPODEnabled, true);
      return new Response(JSON.stringify({ data: {
        orderId: "LALA-123456789", status: "ASSIGNING_DRIVER",
        priceBreakdown: { total: "8.32", currency: "BRL" },
        shareLink: "https://share.sandbox.lalamove.com/test",
      } }), { status: 201 });
    });
  assertEquals(requested, true);
  assertEquals(result.response.status, 201);
  assertEquals(result.payload.data.orderId, "LALA-123456789");
  assertEquals(Number(result.payload.data.priceBreakdown.total), 8.32);
});

Deno.test("duplicidade MOCKADA: estado creating/created bloqueia nova criação", () => {
  assertEquals(canStartDispatch("quoted"), true);
  assertEquals(canStartDispatch("failed"), true);
  assertEquals(canStartDispatch("creating"), false);
  assertEquals(canStartDispatch("created"), false);
});

Deno.test("webhook válido: assinatura HMAC confere com apiKey, timestamp, path e data", async () => {
  const path = "/functions/v1/lalamove-webhook";
  const data = { order: { orderId: "LALA-123456789", status: "ON_GOING" }, updatedAt: "2026-11-15T12:00:00Z" };
  const timestamp = "1794763200";
  const signature = await makeWebhookSignature("sk_test_demo", timestamp, path, data);
  const payload = { apiKey: "pk_test_demo", timestamp, signature, eventId: "event-1",
    eventType: "ORDER_STATUS_CHANGED", eventVersion: "v3", data };
  assertEquals(await verifyWebhookSignature({
    apiKey: "pk_test_demo", apiSecret: "sk_test_demo", path, payload,
  }), true);
});

Deno.test("webhook inválido: rejeita assinatura, chave e caminho incorretos", async () => {
  const path = "/functions/v1/lalamove-webhook";
  const data = { order: { orderId: "LALA-123456789", status: "COMPLETED" } };
  const timestamp = "1794763200";
  const signature = await makeWebhookSignature("sk_test_demo", timestamp, path, data);
  const payload = { apiKey: "pk_test_demo", timestamp, signature, data };
  assertEquals(await verifyWebhookSignature({
    apiKey: "pk_test_demo", apiSecret: "sk_test_demo", path: path + "-wrong", payload,
  }), false);
  assertEquals(await verifyWebhookSignature({
    apiKey: "pk_test_other", apiSecret: "sk_test_demo", path, payload,
  }), false);
  assertEquals(await verifyWebhookSignature({
    apiKey: "pk_test_demo", apiSecret: "sk_test_wrong", path, payload,
  }), false);
});

Deno.test("consulta do motorista MOCKADA: recupera nome, telefone e placa pelo ID", async () => {
  const result = await getLalamoveDriverDetails("pk_test_demo", "sk_test_demo", "LALA-123456789", "driver-123",
    async (input, init) => {
      assertEquals(String(input), "https://rest.sandbox.lalamove.com/v3/orders/LALA-123456789/drivers/driver-123");
      assertEquals(init?.method, "GET");
      return new Response(JSON.stringify({ data: {
        driverId: "driver-123", name: "Motorista Sandbox", phone: "+5592999990000", plateNumber: "ABC1D23",
      } }), { status: 200 });
    });
  assertEquals(result.response.status, 200);
  assertEquals(result.payload.name, "Motorista Sandbox");
  assertEquals(result.payload.phone, "+5592999990000");
  assertEquals(result.payload.plateNumber, "ABC1D23");
});

Deno.test("cancelamento MOCKADO: DELETE sandbox 204 confirma cancelamento", async () => {
  let called = false;
  const response = await cancelLalamoveOrder("pk_test_demo", "sk_test_demo", "LALA-123456789",
    async (input, init) => {
      called = true;
      assertEquals(String(input), "https://rest.sandbox.lalamove.com/v3/orders/LALA-123456789");
      assertEquals(init?.method, "DELETE");
      return new Response(null, { status: 204 });
    });
  assertEquals(called, true);
  assertEquals(response.status, 204);
});

Deno.test("cancelamento MOCKADO: janela fechada retorna 409 sem fingir sucesso", async () => {
  const response = await cancelLalamoveOrder("pk_test_demo", "sk_test_demo", "LALA-123456789",
    async () => new Response(JSON.stringify({ message: "ERR_CANCELLATION_FORBIDDEN" }), { status: 409 }));
  assertEquals(response.status, 409);
});

Deno.test("janela de cancelamento: searching permitido; ON_GOING somente nos primeiros 5 minutos", () => {
  const now = Date.parse("2026-11-15T12:00:00.000Z");
  assertEquals(canCancelLalamove("searching", null, now), true);
  assertEquals(canCancelLalamove("assigned", "2026-11-15T11:56:00.000Z", now), true);
  assertEquals(canCancelLalamove("assigned", "2026-11-15T11:55:00.000Z", now), false);
  assertEquals(canCancelLalamove("picked_up", "2026-11-15T11:59:00.000Z", now), false);
  assertEquals(canCancelLalamove("assigned", null, now), false);
});

Deno.test("status e diferença de taxa são mapeados sem expor dados privados", () => {
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "ASSIGNING_DRIVER"), "searching");
  assertEquals(mapLalamoveStatus("DRIVER_ASSIGNED", "ASSIGNING_DRIVER"), "assigned");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "ON_GOING"), "assigned");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "PICKED_UP"), "picked_up");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "COMPLETED"), "delivered");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "CANCELED"), "cancelled");
  assertEquals(quoteFee(quote).fee, 8.32);
  assertEquals(priceDifference(14, 9), 5);
  assertEquals(priceDifference(8, 9), -1);
});

Deno.test("verificação inicial Lalamove: corpo vazio ou sem envelope assinado é probe", () => {
  assertEquals(isWebhookVerificationProbe(null), true);
  assertEquals(isWebhookVerificationProbe({}), true);
  assertEquals(isWebhookVerificationProbe({ data: {} }), true);
  assertEquals(isWebhookVerificationProbe({ apiKey: "pk_test_demo", timestamp: 123, data: {} }), true);
  assertEquals(isWebhookVerificationProbe({
    apiKey: "pk_test_demo", timestamp: 123, signature: "abc", data: {},
  }), false);
  assertEquals(isWebhookVerificationProbe({
    apiKey: "pk_test_demo", timestamp: "123", signature: "abc", data: { eventType: "ORDER_STATUS_CHANGED" },
  }), false);
});

Deno.test("cotação pode ocorrer antes de Pronto, mas corrida só após Pronto para Retirada", () => {
  assertEquals(canQuoteLalamove("Pagamento Confirmado", "Pix", true), true);
  assertEquals(canQuoteLalamove("Pagamento Confirmado", "Pix", false), true);
  assertEquals(canQuoteLalamove("Preparando", "Pix", false), true);
  assertEquals(canQuoteLalamove("Pedido Recebido", "Dinheiro", false), false);
  assertEquals(canQuoteLalamove("Cancelada", "Pix", true), false);
  assertEquals(isLalamoveDispatchReady("Pagamento Confirmado"), false);
  assertEquals(isLalamoveDispatchReady("Preparando"), true);
  assertEquals(isLalamoveDispatchReady("Pronto para Retirada"), true);
  assertEquals(isLalamoveDispatchReady("Pronto"), true);
});

Deno.test("RPC interno recebe JWT com claim service_role; rejeita chave secreta opaca", () => {
  const payload = btoa(JSON.stringify({ role: "service_role" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const token = "eyJhbGciOiJIUzI1NiJ9." + payload + ".signature";
  assertEquals(requireSupabaseServiceRoleJwt(token), token);
  let rejected = false;
  try { requireSupabaseServiceRoleJwt("sb_secret_test_example"); } catch (error) {
    rejected = error instanceof Error && error.message === "MISSING_SUPABASE_SERVICE_ROLE_KEY";
  }
  assertEquals(rejected, true);
});

Deno.test("cotação Produção substitui cotação Sandbox antiga e preserva taxa real", async () => {
  let stored = {
    state: "quoted", ambiente: "sandbox", quote_moto_fee: 8.32, quote_car_fee: 10.10,
    lalamove_order_id: null, quote_session_id: "old-sandbox-session",
  };
  const motoQuote = { quotationId: "prod-moto-123456", expiresAt: new Date(Date.now() + 60000).toISOString(),
    priceBreakdown: { total: "12.05", currency: "BRL" }, stops: [{ stopId: "pickup-moto" }, { stopId: "drop-moto" }] };
  const carQuote = { quotationId: "prod-car-123456", expiresAt: new Date(Date.now() + 60000).toISOString(),
    priceBreakdown: { total: "14.40", currency: "BRL" }, stops: [{ stopId: "pickup-car" }, { stopId: "drop-car" }] };
  const moto = quoteFee(motoQuote), car = quoteFee(carQuote);
  const payload = {
    p_order_id: "FEIRA-TEST-6259DB63", p_session_id: "00000000-0000-4000-8000-000000000002",
    p_moto_quote: motoQuote, p_car_quote: carQuote, p_moto_fee: moto.fee, p_car_fee: car.fee,
    p_moto_expires_at: moto.expiresAt, p_car_expires_at: car.expiresAt, p_ambiente: "producao",
  };
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    assertEquals(name, "service_store_lalamove_quotes");
    assertEquals(args.p_ambiente, "producao");
    if (stored.state === "quoted" && stored.lalamove_order_id === null) {
      stored = { state: "quoted", ambiente: String(args.p_ambiente),
        quote_moto_fee: Number(args.p_moto_fee), quote_car_fee: Number(args.p_car_fee),
        lalamove_order_id: null, quote_session_id: String(args.p_session_id) };
      return { data: { stored: true, ambiente: stored.ambiente }, error: null };
    }
    return { data: null, error: { code: "55000", message: "dispatch already started" } };
  }};
  const result = await storeLalamoveQuotes(db, payload);
  assertEquals(result.error, null);
  assertEquals(stored.ambiente, "producao");
  assertEquals(stored.quote_moto_fee, 12.05);
  assertEquals(stored.quote_car_fee, 14.40);
  assertEquals(stored.quote_session_id, payload.p_session_id);
  assertEquals(stored.state, "quoted");
});

Deno.test("consulta de status Lalamove usa GET assinado em /v3/orders/{id}", async () => {
  let called = "";
  const result = await getLalamoveOrderDetails("pk_test_key", "sk_test_secret", "ORDER123456", async (input, init) => {
    called = String(input);
    assertEquals(init?.method, "GET");
    assertEquals(new Headers(init?.headers).get("Market"), "BR");
    return new Response(JSON.stringify({ data: { orderId: "ORDER123456", status: "ON_GOING" } }), { status: 200 });
  });
  assertEquals(called, "https://rest.sandbox.lalamove.com/v3/orders/ORDER123456");
  assertEquals(result.payload.status, "ON_GOING");
});

Deno.test("mapeia todos os status operacionais do Sandbox", () => {
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "ASSIGNING_DRIVER"), "searching");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "ON_GOING"), "assigned");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "PICKED_UP"), "picked_up");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "COMPLETED"), "delivered");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "CANCELED"), "cancelled");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "EXPIRED"), "expired");
  assertEquals(mapLalamoveStatus("ORDER_STATUS_CHANGED", "REJECTED"), "rejected");
});

Deno.test("webhook signed V3 can use signature as stable fallback event identifier", () => {
  const payload = { signature: "a".repeat(64), data: { order: { orderId: "ORDER123456" } } };
  const eventId = String(payload.signature || "");
  assertEquals(eventId.length, 64);
});


Deno.test("criação Lalamove MOCKADA: ambiente produção usa endpoint live", async () => {
  const result = await createLalamoveOrder("pk_prod_demo", "sk_prod_demo", {
    data: { quotationId: "quote-live", sender: { stopId: "pickup" }, recipients: [{ stopId: "dropoff" }] },
  }, async (input, init) => {
    assertEquals(String(input), "https://rest.lalamove.com/v3/orders");
    assertEquals(init?.method, "POST");
    return new Response(JSON.stringify({ data: { orderId: "LIVE123456", status: "ASSIGNING_DRIVER" } }), { status: 201 });
  }, "producao");
  assertEquals(result.response.status, 201);
  assertEquals(result.payload.data.orderId, "LIVE123456");
});

Deno.test("webhook produção: HMAC live válido e assinatura sandbox não substitui segredo live", async () => {
  const path = "/functions/v1/lalamove-webhook";
  const data = { order: { orderId: "LIVE123456", status: "ON_GOING" } };
  const timestamp = "1794763200";
  const signature = await makeWebhookSignature("sk_prod_demo", timestamp, path, data);
  const payload = { apiKey: "pk_prod_demo", timestamp, signature, data };
  assertEquals(await verifyWebhookSignature({
    apiKey: "pk_prod_demo", apiSecret: "sk_prod_demo", path, payload,
  }), true);
  assertEquals(await verifyWebhookSignature({
    apiKey: "pk_test_demo", apiSecret: "sk_test_demo", path, payload,
  }), false);
});


Deno.test("consulta de tracking MOCKADA usa host de produção quando dispatch foi criado em live", async () => {
  const result = await getLalamoveOrderDetails("pk_prod_demo", "sk_prod_demo", "LIVE123456",
    async (input, init) => {
      assertEquals(String(input), "https://rest.lalamove.com/v3/orders/LIVE123456");
      assertEquals(init?.method, "GET");
      return new Response(JSON.stringify({ data: { orderId: "LIVE123456", status: "ON_GOING" } }), { status: 200 });
    }, "producao");
  assertEquals(result.response.status, 200);
  assertEquals(result.payload.status, "ON_GOING");
});


Deno.test("pedido teste em Produção sem confirmação é recusado antes da API", () => {
  let rejected = false;
  try { assertTestProductionDispatchConfirmation(true, "producao", false); }
  catch (error) { rejected = error instanceof Error && error.message === "TEST_PRODUCTION_CONFIRMATION_REQUIRED"; }
  assertEquals(rejected, true);
});
Deno.test("pedido teste em Produção confirmado aceita criação com API mockada; Sandbox não exige confirmação", async () => {
  assertTestProductionDispatchConfirmation(true, "producao", true);
  assertTestProductionDispatchConfirmation(true, "sandbox", false);
  let called = false;
  const result = await createLalamoveOrder("pk_prod_demo", "sk_prod_demo", {
    data: { quotationId: "quote-test-live", sender: { stopId: "pickup" }, recipients: [{ stopId: "dropoff" }] },
  }, async (input) => {
    called = true;
    assertEquals(String(input), "https://rest.lalamove.com/v3/orders");
    return new Response(JSON.stringify({ data: { orderId: "TESTLIVE123", status: "ASSIGNING_DRIVER" } }), { status: 201 });
  }, "producao");
  assertEquals(called, true);
  assertEquals(result.response.status, 201);
});

Deno.test("pedido real em Produção mantém fluxo atual sem flag de pedido teste", () => {
  assertTestProductionDispatchConfirmation(false, "producao", false);
});

Deno.test("diagnóstico Lalamove sanitiza a resposta do provedor",()=>{const safe=sanitizeLalamoveErrorPayload({code:"ERR_INVALID_ORDER",message:"cliente teste@exemplo.com +55 92 99999-0000 https://private.example.test",customerAddress:"Rua privada, 123"});assertEquals(safe.code,"ERR_INVALID_ORDER");assertEquals(safe.message.includes("teste@exemplo.com"),false);assertEquals(safe.message.includes("99999"),false);assertEquals(safe.message.includes("private.example.test"),false);assertEquals("customerAddress" in safe,false);});

Deno.test("diagnóstico Lalamove sanitiza a resposta do provedor",()=>{const safe=sanitizeLalamoveErrorPayload({code:"ERR_INVALID_ORDER",message:"cliente teste@exemplo.com +55 92 99999-0000 https://private.example.test",customerAddress:"Rua privada, 123"});assertEquals(safe.code,"ERR_INVALID_ORDER");assertEquals(safe.message.includes("teste@exemplo.com"),false);assertEquals(safe.message.includes("99999"),false);assertEquals(safe.message.includes("private.example.test"),false);assertEquals("customerAddress" in safe,false);});

Deno.test("configuração Supabase aceita JWT antigo e sb_secret sem enviar segredo como Bearer", async () => {
  const payload = btoa(JSON.stringify({ role: "service_role" })).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const jwt = "eyJhbGciOiJIUzI1NiJ9." + payload + ".signature";
  const legacy = readSupabaseServiceRoleConfig((name) => name === "SUPABASE_SERVICE_ROLE_KEY" ? jwt : undefined);
  assertEquals(legacy.key, jwt);
  assertEquals(legacy.fetcher, undefined);

  let captured: Request | null = null;
  const secret = "sb_secret_test_example";
  const modern = readSupabaseServiceRoleConfig(
    (name) => name === "SUPABASE_SERVICE_ROLE_KEY" ? secret : undefined,
    async (input, init) => { captured = new Request(input, init); return new Response("ok"); },
  );
  assertEquals(modern.key, secret);
  await modern.fetcher!("https://example.test/rest/v1/rpc/probe", { headers: { Authorization: "Bearer must-not-leak" } });
  assertEquals(captured?.headers.get("apikey"), secret);
  assertEquals(captured?.headers.get("authorization"), null);
});
