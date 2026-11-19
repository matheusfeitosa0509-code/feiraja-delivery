import { assertEquals } from "jsr:@std/assert@1";
import { CUSTOMER_PUSH_TITLE, customerOrderUrl, getCustomerMessage, shouldSkipOrderPush } from "./notification-contract.ts";

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
  assertEquals(customerOrderUrl("AB12-CD34"), "/loja.html?pedido=AB12-CD34#customerOrders");
  assertEquals(customerOrderUrl("id with space"), "/loja.html?pedido=id%20with%20space#customerOrders");
});
Deno.test("test orders and orders without owner are skipped", () => {
  assertEquals(shouldSkipOrderPush(true, "user-1"), true);
  assertEquals(shouldSkipOrderPush(false, null), true);
  assertEquals(shouldSkipOrderPush(false, "user-1"), false);
});
