import { isAsaasPixEnabled, isLegacyMercadoPagoWebhookNotice } from "./payment-provider-policy.ts";

Deno.test("legacy Mercado Pago payment query is identified before processing", () => {
  if (!isLegacyMercadoPagoWebhookNotice(new URL("https://example.test/?topic=payment&id=123"), {})) {
    throw new Error("Expected Mercado Pago query notification to be blocked");
  }
});

Deno.test("legacy Mercado Pago body notification is identified before processing", () => {
  if (!isLegacyMercadoPagoWebhookNotice(new URL("https://example.test/"), { type: "payment", data: { id: "123" } })) {
    throw new Error("Expected Mercado Pago body notification to be blocked");
  }
});

Deno.test("normal checkout is not mistaken for a Mercado Pago notification", () => {
  if (isLegacyMercadoPagoWebhookNotice(new URL("https://example.test/?order_id=ORDER-1"), { items: [] })) {
    throw new Error("A normal checkout request was incorrectly classified as a webhook");
  }
});

Deno.test("Pix checkout requires Asaas; non-Pix methods remain unaffected", () => {
  if (isAsaasPixEnabled("pix", false)) throw new Error("Pix must be blocked when Asaas is disabled");
  if (!isAsaasPixEnabled("pix", true)) throw new Error("Pix must remain enabled when Asaas is enabled");
  if (!isAsaasPixEnabled("cash", false)) throw new Error("Non-Pix methods must not depend on Asaas");
});
