import { assertEquals } from "jsr:@std/assert@1.0.14";
import { resolveMercadoPagoOrderStatus } from "./payment-status.ts";

Deno.test("Mercado Pago: cancelado + approved com payment_id igual é ignorado", () => {
  const order = { status: "Cancelada", payment_id: "mp-payment-123" };
  const incomingPaymentId = "mp-payment-123";
  assertEquals(order.payment_id, incomingPaymentId);
  assertEquals(
    resolveMercadoPagoOrderStatus(order.status, "approved"),
    { ignored: true, reason: "pedido_cancelado_pagamento_aprovado" },
  );
});

Deno.test("Mercado Pago: não cancelado + approved confirma normalmente", () => {
  assertEquals(
    resolveMercadoPagoOrderStatus("Pagamento Pendente", "approved"),
    { ignored: false, nextStatus: "Pagamento Confirmado" },
  );
});
