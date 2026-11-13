import {
  buildCancelledPaymentPatch,
  isCancelledOrderStatus,
  isVerifiedPixPayment,
  shouldNotifyAdminWithoutOrder,
} from "./payment-routing.ts";
import { assertEquals } from "jsr:@std/assert@1.0.14";

const valid = {
  paymentId: "pay_123",
  externalReference: "ORDER-123",
  billingType: "PIX",
  status: "CONFIRMED",
  webhookValue: 30,
  verifiedId: "pay_123",
  verifiedExternalReference: "ORDER-123",
  verifiedBillingType: "PIX",
  verifiedValue: 30,
  expectedTotal: 30,
};

Deno.test("Pix pago após cancelamento com payment_id igual é validado", () => {
  assertEquals(isCancelledOrderStatus("Cancelada"), true);
  assertEquals(isVerifiedPixPayment(valid), true);
  assertEquals(buildCancelledPaymentPatch("pay_123", "pay_123"), { refund_pending: true });
});

Deno.test("Pix pago após cancelamento com payment_id diferente usa externalReference validada e preserva o ID antigo", () => {
  assertEquals(isVerifiedPixPayment(valid), true);
  assertEquals(buildCancelledPaymentPatch("pay_old", "pay_123"), { refund_pending: true });
});

Deno.test("Pix pago após cancelamento sem payment_id grava o ID recebido", () => {
  assertEquals(buildCancelledPaymentPatch("", "pay_123"), {
    refund_pending: true,
    payment_id: "pay_123",
  });
});

Deno.test("Pagamento confirmado sem pedido correspondente gera aviso administrativo", () => {
  assertEquals(isVerifiedPixPayment({ ...valid, expectedTotal: null }), true);
  assertEquals(shouldNotifyAdminWithoutOrder(true, false), true);
  assertEquals(shouldNotifyAdminWithoutOrder(false, false), false);
});

Deno.test("Webhook repetido mantém refund_pending true sem trocar payment_id já existente", () => {
  const first = buildCancelledPaymentPatch("", "pay_123");
  const repeated = buildCancelledPaymentPatch("pay_123", "pay_123");
  assertEquals(first.refund_pending, true);
  assertEquals(repeated.refund_pending, true);
  assertEquals(repeated.payment_id, undefined);
});

Deno.test("Fluxo normal continua exigindo ID, referência, Pix, status e valor corretos", () => {
  assertEquals(isVerifiedPixPayment(valid), true);
  assertEquals(isVerifiedPixPayment({ ...valid, verifiedId: "pay_other" }), false);
  assertEquals(isVerifiedPixPayment({ ...valid, verifiedExternalReference: "OTHER" }), false);
  assertEquals(isVerifiedPixPayment({ ...valid, verifiedBillingType: "BOLETO" }), false);
  assertEquals(isVerifiedPixPayment({ ...valid, status: "PENDING" }), false);
  assertEquals(isVerifiedPixPayment({ ...valid, verifiedValue: 29.99 }), false);
});
