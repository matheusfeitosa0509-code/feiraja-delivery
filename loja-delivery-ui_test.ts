import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  buildDeliveryQuoteItems, canShowDeliveryOption, checkoutGrandTotal,
  deliveryPaymentOptions, deliveryQuoteErrorMessage, deliveryQuoteLabel, isAdminRpcTrue, isDeliveryOutOfArea,
  normalizeDeliveryAddress,
} from "./loja-delivery-ui.js";

Deno.test("entrega oculta para cliente quando desativada e visível para admin", () => {
  assertEquals(canShowDeliveryOption(false, false), false);
  assertEquals(canShowDeliveryOption(false, true), true);
  assertEquals(canShowDeliveryOption(true, false), true);
});

Deno.test("pagamentos da entrega: Pix para todos e Pix de teste só para admin", () => {
  assertEquals(deliveryPaymentOptions(false), ["pix"]);
  assertEquals(deliveryPaymentOptions(true), ["pix", "pix_test"]);
});

Deno.test("endereço estruturado exige rua, número e bairro e limita campos", () => {
  assertEquals(normalizeDeliveryAddress({ street: " Rua A ", number: " 12 ", neighborhood: " Centro " }), {
    street: "Rua A", number: "12", neighborhood: "Centro", complement: "", reference: "",
  });
  assertEquals(normalizeDeliveryAddress({ street: "Rua A", number: "", neighborhood: "Centro" }), null);
  assertEquals(normalizeDeliveryAddress({ street: "R".repeat(161), number: "1", neighborhood: "Centro" }), null);
});

Deno.test("itens do carrinho viram payload de cotação", () => {
  assertEquals(buildDeliveryQuoteItems([{ p: { id: "banana" }, q: 2 }, { id: "melancia", qty: 1 }]), [
    { product_id: "banana", quantity: 2 }, { product_id: "melancia", quantity: 1 },
  ]);
});

Deno.test("total do checkout soma taxa somente na entrega", () => {
  assertEquals(checkoutGrandTotal(30, "delivery", { fee: 9 }), 39);
  assertEquals(checkoutGrandTotal(30, "pickup_store", { fee: 9 }), 30);
  assertThrows(() => checkoutGrandTotal(30, "delivery", { fee: -1 }));
});

Deno.test("rótulo da cotação e endereço fora da área", () => {
  assertEquals(deliveryQuoteLabel("MOTO", 9), "Entrega de moto: R$ 9,00");
  assertEquals(deliveryQuoteLabel("CAR", 14), "Entrega de carro: R$ 14,00");
  assertEquals(isDeliveryOutOfArea(422), true);
  assertEquals(isDeliveryOutOfArea(502, "upstream"), false);
});

Deno.test("loja.html conecta a opção, cotação, endereço salvo e acompanhamento", async () => {
  const html = await Deno.readTextFile("loja.html");
  for (const required of [
    'id="deliveryHomeOption"', 'id="deliveryAddressFields"',
    'id="deliveryStreet"', 'id="deliveryNumber"', 'id="deliveryNeighborhood"', 'id="deliveryStreetSuggestions"', 'id="deliveryMapFallback"', 'id="deliveryMapPanel"', 'id="deliveryMap"', 'id="deliveryMapUse"',
    'id="deliveryComplement"', 'id="deliveryReference"',
    "get_delivery_enabled", "supabase.rpc('is_current_user_admin')", "functions.invoke('delivery-quote'",
    "address_street", "address_reference", "delivery_vehicle", "delivery_fee",
    "Pix de teste (admin)", "Sai para entrega quando o pedido estiver pronto",
    "await loadDeliveryAccess(currentUser)", "async function openCheckoutModal()", "delivery-address", "session_token", "deliveryMapCoordinates", "deliveryPlacesSessionToken=null;$('#deliveryMapFallback').hidden=false",
  ]) assertEquals(html.includes(required), true, "missing UI wiring: " + required);
});

Deno.test("erros da cotação diferenciam endereço, Manaus e cobertura Lalamove", () => {
  assertEquals(deliveryQuoteErrorMessage(400, "ADDRESS_NOT_FOUND").startsWith("Endereço não encontrado"), true);
  assertEquals(deliveryQuoteErrorMessage(422, "ADDRESS_OUTSIDE_MANAUS").includes("fora de Manaus"), true);
  assertEquals(deliveryQuoteErrorMessage(422, "LALAMOVE_OUT_OF_SERVICE_AREA").includes("Lalamove não atende"), true);
  assertEquals(deliveryQuoteErrorMessage(503, "GEOCODER_NOT_CONFIGURED").includes("GOOGLE_GEOCODING_API_KEY"), true);
});

Deno.test("resultado da RPC administrativa é normalizado sem falsos negativos", () => {
  assertEquals(isAdminRpcTrue(true), true);
  assertEquals(isAdminRpcTrue("true"), true);
  assertEquals(isAdminRpcTrue(1), true);
  assertEquals(isAdminRpcTrue(false), false);
  assertEquals(isAdminRpcTrue(null), false);
});
