import { assertEquals } from "jsr:@std/assert@1";
import { CUSTOMER_PUSH_TITLE, customerOrderUrl, getCustomerMessage, shouldSkipOrderPush, isExpiredPushEndpointStatus } from "./notification-contract.ts";

Deno.test("customer push title is fixed", () => assertEquals(CUSTOMER_PUSH_TITLE, "Feira On Delivery"));
Deno.test("all requested customer status messages match", () => {
  assertEquals(getCustomerMessage("Pagamento Confirmado"), "Pagamento confirmado! ✅ Já vamos separar seu pedido.");
  assertEquals(getCustomerMessage("Separação iniciada"), "Estamos separando seu pedido 🧺");
  assertEquals(getCustomerMessage("Pronto para Retirada", "A1B2"), "Seu pedido está pronto! 🎉 Código de retirada: A1B2");
  assertEquals(getCustomerMessage("Saiu para Entrega"), "Seu pedido saiu para entrega 🛵");
  assertEquals(getCustomerMessage("Entregue"), "Pedido entregue. Obrigado por comprar na Feira On! 💚");
  assertEquals(getCustomerMessage("Cancelada"), "Seu pedido foi cancelado. Qualquer dúvida, fale com a gente.");
});
Deno.test("received and pending payment messages stay unchanged", () => {
  assertEquals(getCustomerMessage("Pedido Recebido"), "Recebemos seu pedido.");
  assertEquals(getCustomerMessage("Pagamento Pendente"), "Aguardando a confirmação do pagamento.");
});
Deno.test("notification click target identifies the order", () => {
  assertEquals(customerOrderUrl("AB12-CD34"), "./loja.html?pedido=AB12-CD34#customerOrders");
  assertEquals(customerOrderUrl("id with space"), "./loja.html?pedido=id%20with%20space#customerOrders");
});
Deno.test("test orders and orders without owner are skipped", () => {
  assertEquals(shouldSkipOrderPush(true, "user-1"), true);
  assertEquals(shouldSkipOrderPush(false, null), true);
  assertEquals(shouldSkipOrderPush(false, "user-1"), false);
});

Deno.test("mocked customer send records each event once and never sends test orders", () => {
  const sent = new Map<string, string>();
  const mockSend = (orderId: string, status: string, isTestOrder: boolean, userId: string | null, pickupCode = "C123") => {
    if (shouldSkipOrderPush(isTestOrder, userId)) return;
    const key = `${orderId}:customer:${status}`;
    if (sent.has(key)) return;
    const body = getCustomerMessage(status, pickupCode);
    if (body) sent.set(key, body);
  };
  const orderId = "TEST-ORDER-01";
  const events = ["Pagamento Confirmado", "Separação iniciada", "Pronto para Retirada", "Saiu para Entrega", "Entregue", "Cancelada"];
  for (const event of events) {
    mockSend(orderId, event, false, "owner-1");
    mockSend(orderId, event, false, "owner-1");
  }
  mockSend("TEST-ORDER-02", "Pagamento Confirmado", true, "owner-1");
  assertEquals(sent.size, 6);
  assertEquals(sent.get("TEST-ORDER-01:customer:Pronto para Retirada"), "Seu pedido está pronto! 🎉 Código de retirada: C123");
  assertEquals(sent.has("TEST-ORDER-02:customer:Pagamento Confirmado"), false);
});

Deno.test("expired push endpoints are exactly 404 and 410", () => {
  assertEquals(isExpiredPushEndpointStatus(404), true);
  assertEquals(isExpiredPushEndpointStatus(410), true);
  assertEquals(isExpiredPushEndpointStatus(500), false);
});
