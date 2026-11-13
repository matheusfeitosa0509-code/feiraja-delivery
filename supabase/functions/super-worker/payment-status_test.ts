import { assertEquals } from "jsr:@std/assert@1.0.14";
import { resolveMercadoPagoOrderStatus } from "./payment-status.ts";

Deno.test("Mercado Pago: cancelado + approved com payment_id igual é ignorado", () => {
  const order = { status: "Cancelada", payment_id: "mp-payment-123" };
  const decision = resolveMercadoPagoOrderStatus({
    orderStatus: order.status,
    incomingStatus: "approved",
    storedPaymentId: order.payment_id,
    incomingPaymentId: "mp-payment-123",
  });
  assertEquals(decision, {
    ignored: true,
    reason: "pedido_cancelado_pagamento_aprovado",
  });
});

Deno.test("Mercado Pago: não cancelado + approved com payment_id igual confirma normalmente", () => {
  assertEquals(
    resolveMercadoPagoOrderStatus({
      orderStatus: "Pagamento Pendente",
      incomingStatus: "approved",
      storedPaymentId: "mp-payment-456",
      incomingPaymentId: "mp-payment-456",
    }),
    { ignored: false, nextStatus: "Pagamento Confirmado" },
  );
});
