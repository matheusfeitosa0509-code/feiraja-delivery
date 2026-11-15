import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLalamoveOrderBody, canCancelLalamove, canQuoteLalamove, canStartDispatch, isLalamoveDispatchReady, cancelLalamoveOrder, createLalamoveOrder, getLalamoveDriverDetails,
  isWebhookVerificationProbe, makeWebhookSignature, mapLalamoveStatus, normalizeBrazilPhone, priceDifference, quoteFee, verifyWebhookSignature, requireSupabaseSecretKey, secretKeyFetch,
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
  assertEquals(isLalamoveDispatchReady("Pronto para Retirada"), true);
  assertEquals(isLalamoveDispatchReady("Pronto"), true);
});

Deno.test("RPC interno usa chave secreta moderna sem depender do JWT legado", () => {
  const key = "sb_secret_test_example";
  assertEquals(requireSupabaseSecretKey(JSON.stringify({ default: key })), key);
  assertEquals(requireSupabaseSecretKey(key), key);
  let rejected = false;
  try { requireSupabaseSecretKey("header.payload.signature"); } catch (error) {
    rejected = error instanceof Error && error.message === "MISSING_SUPABASE_SECRET_KEY";
  }
  assertEquals(rejected, true);
  rejected = false;
  try { requireSupabaseSecretKey(""); } catch { rejected = true; }
  assertEquals(rejected, true);
});

Deno.test("cliente PostgREST envia chave secreta somente em apikey, sem Authorization Bearer", async () => {
  const fetcher = secretKeyFetch("sb_secret_test_example", async (_input, init) => {
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("apikey"), "sb_secret_test_example");
    assertEquals(headers.has("Authorization"), false);
    return new Response("ok");
  });
  const response = await fetcher(new Request("https://example.supabase.co/rest/v1/rpc/test", {
    headers: { Authorization: "Bearer sb_secret_test_example" },
  }));
  assertEquals(response.status, 200);
});
