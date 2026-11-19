import { assertEquals } from "jsr:@std/assert@1.0.14";
import { checkoutPaymentMethodError } from "./checkout-payment-policy.ts";
import { generatePickupCode } from "./pickup-code.ts";

Deno.test("backend rejeita dinheiro e cartão com mensagem amigável", () => {
  for (const method of ["cash", "card_on_delivery"]) {
    assertEquals(checkoutPaymentMethodError(method), "Pagamento disponível somente por Pix.");
  }
});

Deno.test("backend aceita Pix e Pix de teste administrativo", () => {
  assertEquals(checkoutPaymentMethodError("pix"), null);
  assertEquals(checkoutPaymentMethodError("pix_test"), null);
});

Deno.test("método desconhecido continua inválido", () => {
  assertEquals(checkoutPaymentMethodError("boleto"), "Forma de pagamento inválida.");
});

Deno.test("código de retirada tem exatamente quatro dígitos", () => {
  for (let index = 0; index < 100; index++) {
    assertEquals(/^\d{4}$/.test(generatePickupCode()), true);
  }
});
