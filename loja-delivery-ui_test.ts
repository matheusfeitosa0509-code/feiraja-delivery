import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  buildDeliveryQuoteItems, canShowDeliveryOption, canShowUberPickupOption, checkoutGrandTotal,
  deliveryUnavailableMessage, isDeliveryOptionDisabled,
  deliveryPaymentOptions, deliveryQuoteErrorMessage, deliveryQuoteLabel, isAdminRpcTrue, isDeliveryOutOfArea,
  normalizeDeliveryAddress,
} from "./loja-delivery-ui.js";

Deno.test("modalidade de entrega só fica habilitada para admin enquanto inativa", () => {
  assertEquals(canShowDeliveryOption(false, false), false);
  assertEquals(canShowDeliveryOption(false, true), true);
  assertEquals(canShowDeliveryOption(true, false), true);
});

Deno.test("Entrega Feira On fica visível mas desabilitada para cliente enquanto inativa", () => {
  assertEquals(isDeliveryOptionDisabled(false, false), true);
  assertEquals(isDeliveryOptionDisabled(false, true), false);
  assertEquals(isDeliveryOptionDisabled(true, false), false);
  assertEquals(deliveryUnavailableMessage(), "A Entrega Feira On chega em breve. Por enquanto, retire na loja ou receba com seu Uber.");
});

Deno.test("retirada com Uber fica oculta quando entrega está ativa", () => {
  assertEquals(canShowUberPickupOption(false), true);
  assertEquals(canShowUberPickupOption(true), false);
  assertEquals(canShowUberPickupOption(null), true);
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
    'id="deliveryHomeOption"', 'aria-disabled="true"', 'disabled', 'Entrega Feira On', 'Receba em casa sem precisar pedir Uber.', 'Em breve', 'Receber com seu Uber', 'id="deliveryAddressFields"',
    'id="deliveryStreet"', 'id="deliveryNumber"', 'id="deliveryNeighborhood"', 'id="deliveryStreetSuggestions"', 'id="deliveryMapFallback"', 'id="deliveryMapPanel"', 'id="deliveryMap"', 'id="deliveryMapUse"', 'id="deliveryMapAdjust"', 'id="deliveryAddressSummary"', 'id="deliveryAddressEdit"', 'id="deliveryStartingPrice"', 'id="checkoutProductsTotal"', 'id="checkoutDeliveryTotal"', 'id="checkoutSummaryTotal"', 'id="checkoutDeliveryMeta"',
    'id="deliveryComplement"', 'id="deliveryReference"',
    "get_delivery_enabled", "supabase.rpc('is_current_user_admin')", "functions.invoke('delivery-quote'",
    "address_street", "address_reference", "delivery_vehicle", "delivery_fee",
    "Pix de teste (admin)", "Sai quando o pedido estiver pronto",
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


Deno.test("checkout novo mantém a ordem visual dos cards e os campos funcionais", async () => {
  const html = await Deno.readTextFile("loja.html");
  const receive = html.indexOf('id="checkoutReceiveTitle"');
  const address = html.indexOf('id="checkoutAddressTitle"');
  const summary = html.indexOf('id="checkoutSummaryTitle"');
  const payment = html.indexOf('id="checkoutPaymentTitle"');
  const customer = html.indexOf('id="checkoutCustomerTitle"');
  assertEquals(receive > 0 && receive < address && address < summary && summary < customer && customer < payment, true);
  for (const required of [
    'placeholder="Digite sua rua e número"', 'id="deliveryStreetSuggestions"',
    'id="deliveryAddressSummaryStreet"', 'id="deliveryAddressEdit"',
    'id="deliveryMapAdjust"', '+ Adicionar complemento ou referência',
    'id="checkoutProductsTotal"', 'id="checkoutDeliveryTotal"',
    'id="checkoutSummaryTotal"', 'id="deliveryStartingPrice"',
    'id="payPixTestOption"', 'checkout-test-badge">TESTE',
    'id="submitOrder"', 'id="modalTotal"', 'id="cpf"', 'id="phone"', 'id="email"', 'id="deliveryUberOption"', 'canShowUberPickupOption(deliveryActive)', 'checkout-uber-details', 'checkout-schedule-alert', 'checkoutScheduleNoticeText', 'grid-template-columns:22px 32px minmax(0,1fr) auto', 'Você chama e paga o Uber pelo app. Nós levamos o pedido até o carro.', "const uberAction=o.delivery_type==='pickup_uber'", 'id="deliveryUberOption"', 'canShowUberPickupOption(deliveryActive)', 'checkout-uber-details', 'checkout-schedule-alert', 'checkoutScheduleNoticeText', 'grid-template-columns:22px 32px minmax(0,1fr) auto', 'Você chama e paga o Uber pelo app. Nós levamos o pedido até o carro.',
    'position:fixed!important', 'min-height:64px', '#delivery,#payment{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}',
    "function updateCheckoutSummary()", "A partir de '+money(deliveryQuote.fee)",
  ]) assertEquals(html.includes(required), true, "missing checkout presentation: " + required);
});


Deno.test("cartões do checkout usam uma única grade fixa sem sobreposição de ícone ou selo", async () => {
  const html = await Deno.readTextFile("loja.html");
  const gridRules = html.match(/\.checkout-screen #checkoutForm \.checkout-choice-card\.opt\{/g) || [];
  assertEquals(gridRules.length, 1, "deve existir uma única regra de grade para os cartões");
  assertEquals(html.includes("grid-template-columns:22px 32px minmax(0,1fr) auto!important"), true);
  assertEquals(html.includes(".checkout-choice-card.opt{display:flex"), false);
  assertEquals(html.includes(".checkout-screen #checkoutForm .checkout-choice-icon{\n grid-column:2!important;grid-row:1!important;\n position:static!important"), true);
  assertEquals(html.includes(".checkout-screen #checkoutForm .checkout-choice-end{\n grid-column:4!important;grid-row:1!important;\n position:static!important"), true);
  assertEquals(html.includes("white-space:nowrap!important;overflow-wrap:normal!important"), true);
  assertEquals(html.includes('class="s checkout-pickup-address">Av. Lourenço da Silva Braga, 700</span><span class="s checkout-pickup-hours">Segunda a sábado, 6h às 13h</span>'), true);
});

Deno.test("acompanhamento usa quatro etapas horizontais e mensagens por modalidade", async () => {
  const html = await Deno.readTextFile("loja.html");
  for (const required of [
    "['Pago','💳'],['Preparando','📦'],['Caminho','🛵'],['Entregue','✓']",
    "['Pago','💳'],['Preparando','📦'],['Pronto','✓'],['Retirado','✓']",
    "grid-template-columns:repeat(4,minmax(0,1fr))",
    "white-space:nowrap",
    "Aguardando pagamento do Pix",
    "Procurando entregador…",
    "Retire na Av. Lourenço da Silva Braga, 700",
    "A solicitação expirou. Estamos chamando outro entregador.",
    "Taxa '+money(Number(o.delivery_fee||0))",
    "Acompanhar entrega",
    "Abrir rastreio da Lalamove",
    "data-lalamove-map",
  ]) assertEquals(html.includes(required), true, "missing order tracking requirement: " + required);
  const renderStart = html.indexOf("const html=data.map(o=>");
  const renderEnd = html.indexOf("paint(html);", renderStart);
  const orderRendering = html.slice(renderStart, renderEnd);
  assertEquals(renderStart >= 0 && renderEnd > renderStart, true, "customer order rendering must be present");
  assertEquals(orderRendering.includes("Peso estimado"), false, "customer tracking must not show delivery weight");
});

Deno.test("mapa usa função autenticada, rate limit e atualiza enquanto visível", async () => {
  const map = await Deno.readTextFile("lalamove-map.js");
  const endpoint = await Deno.readTextFile("supabase/functions/lalamove-tracking/index.ts");
  const migration = await Deno.readTextFile("supabase/migrations/20261115230000_lalamove_tracking_rate_limit.sql");
  const panel = await Deno.readTextFile("painel.html");
  for (const required of ["15000", "visibilitychange", "pagehide", "openstreetmap.org", "IntersectionObserver"]) {
    assertEquals(map.includes(required), true, "missing map lifecycle requirement: " + required);
  }
  for (const required of ['.eq("id", orderId)', '.eq("user_id", authData.user.id)', 'consume_lalamove_tracking_rate_limit', 'p_max_requests: 30', 'getProviderTracking']) {
    assertEquals(endpoint.includes(required), true, "missing tracking security requirement: " + required);
  }
  assertEquals(migration.includes("service role required"), true);
  assertEquals(migration.includes("revoke all on function public.consume_lalamove_tracking_rate_limit"), true);
  assertEquals(migration.includes("grant execute on function public.consume_lalamove_tracking_rate_limit"), true);
  assertEquals(migration.includes("service_update_lalamove_tracking_status"), true);
  assertEquals(migration.includes("p_status in ('cancelled','rejected','expired')"), true);
  assertEquals(migration.includes("when p_status = 'delivered' then 'Entregue'"), true);
  assertEquals(migration.includes("delivery_fee"), false, "tracking migration must not change price fields");
  assertEquals(panel.includes("data-lalamove-map"), true);
  assertEquals(panel.includes("Nenhum motorista aceitou — chame de novo"), true);
  assertEquals(panel.includes("Entrega cancelada"), true);
  assertEquals(panel.includes("Entrega Feira On"), true);
  assertEquals(panel.includes("data-lalamove-status-label"), true);
  assertEquals(map.includes("syncOrderUI(data)"), true);
});
