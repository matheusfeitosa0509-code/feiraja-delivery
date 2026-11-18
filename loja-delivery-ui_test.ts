import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  buildDeliveryQuoteItems, buildDeliveryQuoteCacheKey, isCachedDeliveryQuoteValid, canShowDeliveryOption, canShowUberPickupOption, checkoutGrandTotal,
  deliveryUnavailableMessage, isDeliveryOptionDisabled, loadDeliveryAccessState,
  deliveryPaymentOptions, deliveryQuoteErrorMessage, deliveryQuoteLabel, formatDeliveryMapAddressSummary, isAdminRpcTrue, isDeliveryOutOfArea, isValidDeliveryQuote,
  normalizeDeliveryAddress,
} from "./loja-delivery-ui.js";

Deno.test("Entrega Feira On fica pública com flag ativa, mantém prévia admin desligada e respeita horário", () => {
  assertEquals(canShowDeliveryOption(false, false), false);
  assertEquals(canShowDeliveryOption(true, false), true, "cliente logado pode ver entrega ativa");
  assertEquals(canShowDeliveryOption(false, true), false, "flag desligada não libera cliente");
  assertEquals(canShowDeliveryOption(true, false, true, false), true, "fora do horário agenda a entrega sem bloqueá-la");
  assertEquals(isDeliveryOptionDisabled(false, false, false), true);
  assertEquals(isDeliveryOptionDisabled(false, true, false), true, "admin pendente fica bloqueado");
  assertEquals(isDeliveryOptionDisabled(true, false, false), false, "falha no RPC admin não bloqueia entrega pública ativa");
  assertEquals(isDeliveryOptionDisabled(false, true, true), false, "admin vê prévia TESTE");
  assertEquals(isDeliveryOptionDisabled(false, true, true, false), false, "prévia admin permanece disponível fora do horário");
  assertEquals(isDeliveryOptionDisabled(true, true, true), false);
  assertEquals(isDeliveryOptionDisabled(true, false, true), false, "cliente comum recebe acesso quando ativa");
  assertEquals(isDeliveryOptionDisabled(true, false, true, false), false, "fora do horário não bloqueia");
  assertEquals(isDeliveryOptionDisabled(true, false), false, "entrega ativa não depende do RPC admin");
  assertEquals(deliveryUnavailableMessage(), "A Entrega Feira On está temporariamente indisponível. Escolha Retirar na loja.");
  assertEquals(deliveryUnavailableMessage(), "A Entrega Feira On está temporariamente indisponível. Escolha Retirar na loja.");
});

Deno.test("acesso à entrega: anônimo não chama RPC e conta comum não ganha acesso", async () => {
  let calls = 0;
  const rpc = async () => { calls++; return { data: true, error: null }; };
  const anonymous = await loadDeliveryAccessState({ id: "anon", is_anonymous: true }, rpc);
  assertEquals(anonymous, { adminCheckComplete: false, isAdmin: false, deliveryActive: false });
  assertEquals(calls, 0);
  const common = await loadDeliveryAccessState({ id: "common" }, async (name: string) => {
    calls++;
    return name === "is_current_user_admin" ? { data: false, error: null } : { data: true, error: null };
  });
  assertEquals(common, { adminCheckComplete: true, isAdmin: false, deliveryActive: true });
  assertEquals(isDeliveryOptionDisabled(common.deliveryActive, common.isAdmin, common.adminCheckComplete), false);
});

Deno.test("falha da RPC administrativa não bloqueia a entrega pública ativa", async () => {
  const access = await loadDeliveryAccessState({ id: "admin" }, async (name: string) => {
    if (name === "is_current_user_admin") throw new Error("network failure");
    return { data: true, error: null };
  });
  assertEquals(access, { adminCheckComplete: false, isAdmin: false, deliveryActive: true });
  assertEquals(isDeliveryOptionDisabled(access.deliveryActive, access.isAdmin, access.adminCheckComplete), false);
});

Deno.test("admin confirmado pode testar; Consulte o valor depende da flag ativa", async () => {
  const inactive = await loadDeliveryAccessState({ id: "admin" }, async (name: string) => ({
    data: name === "is_current_user_admin" ? true : false, error: null,
  }));
  assertEquals(inactive, { adminCheckComplete: true, isAdmin: true, deliveryActive: false });
  const active = await loadDeliveryAccessState({ id: "admin" }, async (name: string) => ({
    data: true, error: null,
  }));
  assertEquals(active, { adminCheckComplete: true, isAdmin: true, deliveryActive: true });
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

Deno.test("cotação válida exige veículo, taxa positiva e validade futura", () => {
  const valid = { vehicle: "MOTO", fee: 9, valid_until: new Date(Date.now() + 60_000).toISOString() };
  assertEquals(isValidDeliveryQuote(valid), true);
  assertEquals(isValidDeliveryQuote({ ...valid, fee: 0 }), false);
  assertEquals(isValidDeliveryQuote({ ...valid, valid_until: new Date(Date.now() - 1000).toISOString() }), false);
  assertEquals(isValidDeliveryQuote({ ...valid, vehicle: "BICYCLE" }), false);
});

Deno.test("total do checkout soma somente uma cotação positiva e vigente", () => {
  const quote = { vehicle: "MOTO", fee: 9, valid_until: new Date(Date.now() + 60_000).toISOString() };
  assertEquals(checkoutGrandTotal(30, "delivery", quote), 39);
  assertEquals(checkoutGrandTotal(30, "pickup_store", quote), 30);
  assertThrows(() => checkoutGrandTotal(30, "delivery", { ...quote, fee: 0 }));
  assertThrows(() => checkoutGrandTotal(30, "delivery", { ...quote, valid_until: new Date(Date.now() - 1000).toISOString() }));
});

Deno.test("rótulo da cotação e endereço fora da área", () => {
  assertEquals(deliveryQuoteLabel("MOTO", 9), "Entrega de moto: R$ 9,00");
  assertEquals(deliveryQuoteLabel("CAR", 14), "Entrega de carro: R$ 14,00");
  assertEquals(isDeliveryOutOfArea(422), false, "422 não significa necessariamente endereço fora da área");
  assertEquals(isDeliveryOutOfArea(422, "LALAMOVE_OUT_OF_SERVICE_AREA"), true);
  assertEquals(isDeliveryOutOfArea(502, "upstream"), false);
});

Deno.test("loja.html conecta a opção, cotação, endereço salvo e acompanhamento", async () => {
  const html = await Deno.readTextFile("loja.html");
  const deliveryUi = await Deno.readTextFile("loja-delivery-ui.js");
  for (const required of [
    'id="deliveryHomeOption"', 'aria-disabled="true"', 'disabled', 'Entrega Feira On', 'Receba em casa sem precisar pedir Uber.', 'Em breve', 'Receber com seu Uber', 'id="deliveryAddressFields"',
    'id="deliveryStreet"', 'id="deliveryNumber"', 'id="deliveryNeighborhood"', 'id="deliveryStreetSuggestions"', 'id="deliveryMapFullscreen"', 'id="deliveryMap"', 'id="deliveryMapConfirm"', 'id="deliveryMapGps"', 'id="deliveryMapPreview"', 'id="deliveryMapAdjust"', 'id="deliveryAddressSummary"', 'id="deliveryAddressEdit"', 'id="deliveryStartingPrice"', 'id="checkoutProductsTotal"', 'id="checkoutDeliveryTotal"', 'id="checkoutSummaryTotal"', 'id="checkoutDeliveryMeta"',
    'id="deliveryComplement"', 'id="deliveryReference"',
    "loadDeliveryAccessState(user", "hasConfirmedDeliveryAdmin()", "functions.invoke('delivery-quote'",
    "address_street", "address_reference", "delivery_vehicle", "delivery_fee",
    "syncAdminTestPaymentOption", "checkoutScheduleMessage(new Date(),true)",
    "await loadDeliveryAccess(currentUser)", "async function openCheckoutModal()", "delivery-address", "session_token", "deliveryMapCoordinates", "deliveryPlacesSessionToken=null;", "await openDeliveryMap()", "tiles.openfreemap.org/styles/positron", "zoom:17",
  ]) assertEquals(html.includes(required), true, "missing UI wiring: " + required);
  assertEquals(html.includes('id="payPixTestOption"'), false, "Pix de teste não pode existir no HTML inicial");
  assertEquals(html.includes("#deliveryUberOption[hidden]"), false, "Uber não pode depender de CSS hidden");
  assertEquals(html.includes("syncUberPickupOption({"), true, "checkout deve remover e restaurar Uber no DOM");
  assertEquals(html.includes('id="payPixTest"'), false, "radio Pix de teste só pode ser criado após confirmação admin");
  assertEquals(html.includes('<option value="pix_test">'), false, "select Pix de teste só pode ser criado após confirmação admin");
  assertEquals(deliveryUi.includes("export function syncAdminTestPaymentOption"), true);
  for (const required of ['rpc("is_current_user_admin")', 'rpc("get_delivery_enabled")', 'if (deliveryActive === true) return false;']) {
    assertEquals(deliveryUi.includes(required), true, "missing delivery access rule: " + required);
  }
});

Deno.test("erros da cotação diferenciam endereço, Manaus e cobertura Lalamove", () => {
  assertEquals(deliveryQuoteErrorMessage(400, "ADDRESS_NOT_FOUND").startsWith("Não encontramos esse endereço"), true);
  assertEquals(deliveryQuoteErrorMessage(422, "ADDRESS_OUTSIDE_MANAUS"), "Endereço fora da área de entrega.");
  assertEquals(deliveryQuoteErrorMessage(429, "QUOTE_RATE_LIMIT"), "Muitas consultas agora, tente em alguns segundos.");
  assertEquals(deliveryQuoteErrorMessage(502, "LALAMOVE_QUOTE_FAILED"), "Não foi possível calcular a entrega por um erro inesperado. Tente novamente.");
  assertEquals(deliveryQuoteErrorMessage(422, "LALAMOVE_OUT_OF_SERVICE_AREA").includes("Endereço fora da área de entrega"), true);
  assertEquals(deliveryQuoteErrorMessage(502, "LALAMOVE_INVALID_SCHEDULE_TIME"), "A Lalamove recusou o horário agendado. Tente novamente em instantes.");
  assertEquals(deliveryQuoteErrorMessage(422, "LALAMOVE_INVALID_SERVICE_TYPE"), "A Lalamove não oferece o tipo de veículo selecionado para esta rota.");
  assertEquals(deliveryQuoteErrorMessage(422, "LALAMOVE_INVALID_COORDINATES"), "Não foi possível validar o ponto marcado no mapa. Ajuste o pino e tente novamente.");
  assertEquals(deliveryQuoteErrorMessage(422, "LALAMOVE_INVALID_ADDRESS"), "Endereço não encontrado. Confira rua, número e bairro.");
  assertEquals(deliveryQuoteErrorMessage(422, "LALAMOVE_INVALID_REQUEST").includes("Lalamove recusou"), true);
  assertEquals(deliveryQuoteErrorMessage(503, "GEOCODER_NOT_CONFIGURED"), "Serviço de localização não configurado. Tente novamente mais tarde.");
  assertEquals(deliveryQuoteErrorMessage(503, "QUOTE_RATE_LIMIT_UNAVAILABLE").includes("verificar o limite de cotações"), true);
  assertEquals(deliveryQuoteErrorMessage(400, "INVALID_ADDRESS"), "Informe rua, número e bairro para calcular a entrega.");
  assertEquals(deliveryQuoteErrorMessage(403, "STORE_CLOSED"), "Entrega disponível no horário de funcionamento.");
});

Deno.test("resumo do mapa usa nome do POI, rua, número digitado e bairro sem duplicar a rua", () => {
  assertEquals(formatDeliveryMapAddressSummary("Sumaúma Park Shopping", "Avenida Noel Nutels", "1762", "Cidade Nova"),
    "Sumaúma Park Shopping · Avenida Noel Nutels, 1762 · Cidade Nova");
  assertEquals(formatDeliveryMapAddressSummary("Rua Japiassu", "Rua Japiassu", "140", "Cidade Nova"),
    "Rua Japiassu, 140 · Cidade Nova");
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
    "syncAdminTestPaymentOption", "syncUberPickupOption",
    'id="submitOrder"', 'id="modalTotal"', 'id="cpf"', 'id="phone"', 'id="email"', 'id="deliveryUberOption"', 'syncUberPickupOption({', 'checkout-uber-details', 'checkout-schedule-alert', 'checkoutScheduleNoticeText', 'grid-template-columns:22px 32px minmax(0,1fr) auto', 'Você chama e paga o Uber pelo app. Nós levamos o pedido até o carro.', "const uberAction=o.delivery_type==='pickup_uber'", 'id="deliveryUberOption"', 'syncUberPickupOption({', 'checkout-uber-details', 'checkout-schedule-alert', 'checkoutScheduleNoticeText', 'grid-template-columns:22px 32px minmax(0,1fr) auto', 'Você chama e paga o Uber pelo app. Nós levamos o pedido até o carro.',
    'position:fixed!important', 'min-height:64px', '#delivery,#payment{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}',
    "function updateCheckoutSummary()", "value.textContent=money(deliveryQuote.fee)", "schedule_at:data.schedule_at||null",
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
    "const icon=(kind)=>",
    "['Pago',icon('card')],['Preparando',icon('bag')],['A caminho',icon('bike')],['Entregue',icon('check')]",
    "['Pago',icon('card')],['Preparando',icon('bag')],['Pronto',icon('check')],['Retirado',icon('check')]",
    "grid-template-columns:repeat(4,minmax(0,1fr))",
    "white-space:nowrap",
    "Aguardando pagamento do Pix",
    "Procurando entregador…",
    "Retire na Av. Lourenço da Silva Braga, 700",
    "A solicitação expirou. Estamos chamando outro entregador.",
    "Taxa '+money(Number(o.delivery_fee||0))",
    "Abrir rastreio",
    "data-tracking-url",
    "data-lalamove-map",
  ]) assertEquals(html.includes(required), true, "missing order tracking requirement: " + required);
  const renderStart = html.indexOf("const html=data.map(o=>");
  const renderEnd = html.indexOf("paint(html);", renderStart);
  const orderRendering = html.slice(renderStart, renderEnd);
  assertEquals(renderStart >= 0 && renderEnd > renderStart, true, "customer order rendering must be present");
  assertEquals(orderRendering.includes("Peso estimado"), false, "customer tracking must not show delivery weight");
  assertEquals(html.includes("delivery_weight_kg"), false, "customer order query must not fetch delivery weight");
});

Deno.test("mapa usa função autenticada, rate limit e atualiza enquanto visível", async () => {
  const map = await Deno.readTextFile("lalamove-map.js");
  const endpoint = await Deno.readTextFile("supabase/functions/lalamove-tracking/index.ts");
  const migration = await Deno.readTextFile("supabase/migrations/20261115230000_lalamove_tracking_rate_limit.sql");
  const panel = await Deno.readTextFile("painel.html");
  for (const required of ["15000", "visibilitychange", "pagehide", "tiles.openfreemap.org/styles/positron", "maplibre-gl@5.6.2", "IntersectionObserver", "setRotation", "requestAnimationFrame"]) {
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


Deno.test("cache da cotação usa endereço, carrinho, coordenadas e usuário como identidade", () => {
  const address = { street: "Rua A", number: "10", neighborhood: "Centro" };
  const items = [{ product_id: "banana", quantity: 2 }];
  const point = { lat: -3.1, lng: -60.02 };
  const base = buildDeliveryQuoteCacheKey(address, items, point, "user-1");
  assertEquals(buildDeliveryQuoteCacheKey(address, items, point, "user-1"), base);
  assertEquals(buildDeliveryQuoteCacheKey(address, [{ ...items[0], quantity: 3 }], point, "user-1") === base, false);
  assertEquals(buildDeliveryQuoteCacheKey({ ...address, number: "11" }, items, point, "user-1") === base, false);
  assertEquals(buildDeliveryQuoteCacheKey(address, items, { lat: -3.2, lng: -60.02 }, "user-1") === base, false);
  assertEquals(buildDeliveryQuoteCacheKey(address, items, point, "user-2") === base, false);
});

Deno.test("cache da cotação expira em cinco minutos e nunca reutiliza cotação Lalamove expirada", () => {
  const now = Date.now();
  const quote = { vehicle: "MOTO", fee: 9, valid_until: new Date(now + 600000).toISOString() };
  assertEquals(isCachedDeliveryQuoteValid({ quote, expiresAt: now + 300000 }, now), true);
  assertEquals(isCachedDeliveryQuoteValid({ quote, expiresAt: now + 300000 }, now + 300001), false);
  assertEquals(isCachedDeliveryQuoteValid({ quote: { ...quote, valid_until: new Date(now - 1).toISOString() }, expiresAt: now + 300000 }, now), false);
});
