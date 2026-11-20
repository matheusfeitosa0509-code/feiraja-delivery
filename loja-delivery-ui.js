export function isAdminRpcTrue(value) {
  return value === true || value === "true" || value === 1;
}

export function canShowDeliveryOption(deliveryActive, isAdmin, adminCheckComplete = true, withinHours = true) {
  // A flag controla disponibilidade; horário apenas agenda o próximo período de entrega.
  return deliveryActive === true;
}

export function isDeliveryOptionDisabled(deliveryActive, isAdmin, adminCheckComplete = false, withinHours = true) {
  if (deliveryActive === true) return false;
  return adminCheckComplete !== true || isAdmin !== true;
}

export async function loadDeliveryAccessState(user, rpc) {
  const denied = { adminCheckComplete: false, isAdmin: false, deliveryActive: false };
  if (!user?.id || user.is_anonymous === true) return denied;

  const [adminResult, enabledResult] = await Promise.all([
    Promise.resolve().then(() => rpc("is_current_user_admin")).catch((error) => ({ error })),
    Promise.resolve().then(() => rpc("get_delivery_enabled")).catch((error) => ({ error })),
  ]);

  const adminCheckComplete = !adminResult?.error;
  const isAdmin = adminCheckComplete && isAdminRpcTrue(adminResult?.data);
  return {
    adminCheckComplete,
    isAdmin,
    deliveryActive: !enabledResult?.error && enabledResult?.data === true,
  };
}

export function renderDeliveryOption({ option, radio, starting, description, isAdmin, adminCheckComplete, deliveryActive, withinHours = true, scheduleLabel = "próximo dia" }) {
  const enabledForCustomers = canShowDeliveryOption(deliveryActive, isAdmin, adminCheckComplete, withinHours);
  const adminPreview = deliveryActive !== true && adminCheckComplete === true && isAdmin === true;
  const disabled = !(enabledForCustomers || adminPreview);
  option.hidden = false;
  radio.disabled = disabled;
  option.classList.toggle("is-disabled", disabled);
  option.setAttribute("aria-disabled", String(disabled));
  starting.replaceChildren();
  if (enabledForCustomers) {
    description.textContent = "Taxa por distância, paga com Pix junto do pedido.";
    if (withinHours === true) {
      starting.textContent = "Calcular taxa";
    } else {
      const weekday = String(scheduleLabel).split(",")[0].trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const shortWeekday = ({ segunda: "Seg.", terca: "Ter.", quarta: "Qua.", quinta: "Qui.", sexta: "Sex.", sabado: "Sáb.", domingo: "Dom." })[weekday] || "Próx.";
      const badge = document.createElement("span");
      badge.className = "checkout-delivery-badge";
      badge.textContent = shortWeekday + " de manhã";
      starting.append(badge);
      const schedule = document.createElement("small");
      schedule.className = "checkout-delivery-schedule";
      schedule.textContent = "Entrega a partir de " + String(scheduleLabel) + " pela manhã.";
      description.append(schedule);
    }
  } else if (adminPreview) {
    const badge = document.createElement("span");
    badge.className = "checkout-test-badge";
    badge.textContent = "TESTE";
    starting.append(badge);
    description.textContent = "Prévia administrativa da Entrega Feira On.";
  } else {
    starting.textContent = "Em breve";
    description.textContent = "Receba em casa sem precisar pedir Uber.";
  }
  return disabled;
}

export function syncAdminTestPaymentOption({ container, paymentSelect, isAdminConfirmed, deliveryType, onSelect }) {
  const shouldRender = isAdminConfirmed === true && (deliveryType === "delivery" || deliveryType === "pickup_store");
  const existing = container?.querySelector("#payPixTestOption");
  const selectOption = paymentSelect?.querySelector('option[value="pix_test"]');
  if (!container || !paymentSelect || !shouldRender) {
    existing?.remove(); selectOption?.remove(); return false;
  }
  if (!existing) {
    const label = document.createElement("label");
    label.className = "opt checkout-choice-card checkout-test-payment";
    label.id = "payPixTestOption"; label.htmlFor = "payPixTest";
    const radio = document.createElement("input");
    radio.className = "choice-radio"; radio.id = "payPixTest"; radio.type = "radio"; radio.name = "paymentChoice";
    radio.addEventListener("change", () => { if (radio.checked) onSelect?.(); });
    const icon = document.createElement("span"); icon.className = "checkout-choice-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = "🧪";
    const copy = document.createElement("span"); copy.className = "checkout-choice-copy";
    const title = document.createElement("b"); title.textContent = "Pix de teste (admin)";
    const description = document.createElement("span"); description.className = "s"; description.textContent = "Confirmação de teste, sem cobrança real.";
    copy.append(title, description);
    const badge = document.createElement("span"); badge.className = "checkout-test-badge"; badge.textContent = "TESTE";
    const marker = document.createElement("span"); marker.className = "r"; marker.setAttribute("aria-hidden", "true");
    label.append(radio, icon, copy, badge, marker);
    const pixCard = container.querySelector('label[for="payPix"]');
    if (pixCard?.nextSibling) container.insertBefore(label, pixCard.nextSibling); else container.append(label);
  }
  if (!selectOption) {
    const option = document.createElement("option"); option.value = "pix_test"; option.textContent = "Pix de teste (admin)";
    const pixOption = paymentSelect.querySelector('option[value="pix"]');
    if (pixOption?.nextSibling) paymentSelect.insertBefore(option, pixOption.nextSibling); else paymentSelect.append(option);
  }
  return true;
}
export function deliveryUnavailableMessage() {
  return "A Entrega Feira On está temporariamente indisponível. Escolha Retirar na loja.";
}

export function canShowUberPickupOption(deliveryActive) {
  return deliveryActive !== true;
}

export function syncUberPickupOption({ option, selectOption, select, beforeOption, deliveryActive }) {
  const visible = canShowUberPickupOption(deliveryActive);
  if (!visible) {
    option?.remove();
    selectOption?.remove();
    return false;
  }
  if (option && !option.isConnected) {
    const parent = beforeOption?.parentElement;
    if (parent) parent.insertBefore(option, beforeOption);
  }
  if (select && selectOption && !selectOption.isConnected) {
    const next = select.querySelector('option[value="delivery"]');
    if (next) select.insertBefore(selectOption, next);
    else select.append(selectOption);
  }
  return true;
}

export function deliveryPaymentOptions(isAdmin) {
  return ["pix", ...(isAdmin ? ["pix_test"] : [])];
}

export function hasMultipleDeliveryAddresses(input) {
  const pattern = /(?:\\b(?:rua|avenida|travessa|alameda|rodovia|estrada)\\b|\\b(?:r|av|tv)\\.)[\\s\\S]{0,80}\\b\\d{1,5}\\b/i;
  return pattern.test(String(input?.complement || "")) || pattern.test(String(input?.reference || ""));
}

export function normalizeDeliveryAddress(input) {
  const address = {
    postal_code: String(input?.postal_code || "").replace(/\\D/g, "").slice(0, 8),
    street: String(input?.street || "").trim(),
    number: String(input?.number || "").trim(),
    neighborhood: String(input?.neighborhood || "").trim(),
    complement: String(input?.complement || "").trim(),
    reference: String(input?.reference || "").trim(),
  };
  if (!address.street || !address.number || !address.neighborhood) return null;
  if (address.street.length > 160 || address.number.length > 30 ||
      address.neighborhood.length > 100 || address.complement.length > 60 ||
      address.reference.length > 120 || hasMultipleDeliveryAddresses(address)) return null;
  return address;
}

export function buildDeliveryQuoteItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    product_id: String(item?.p?.id ?? item?.product_id ?? item?.id ?? ""),
    quantity: Number(item?.q ?? item?.quantity ?? item?.qty),
  }));
}

export function isValidDeliveryQuote(quote, now = Date.now()) {
  if (!quote || !["MOTO", "CAR"].includes(String(quote.vehicle || ""))) return false;
  const fee = Number(quote.fee);
  const expiresAt = Date.parse(String(quote.valid_until || quote.validUntil || ""));
  return Number.isFinite(fee) && fee > 0 && Number.isFinite(expiresAt) && expiresAt > Number(now);
}

/** @param {unknown} address @param {unknown} items @param {{lat: number|string, lng: number|string}|null} coordinates @param {string} userId */
export function buildDeliveryQuoteCacheKey(address, items, coordinates = null, userId = "") {
  return JSON.stringify({ user: String(userId || ""), address, items, coordinates: coordinates || null });
}

export function isCachedDeliveryQuoteValid(entry, now = Date.now()) {
  return !!entry && Number(entry.expiresAt) > Number(now) && isValidDeliveryQuote(entry.quote, now);
}

export function checkoutGrandTotal(subtotal, deliveryType, quote) {
  const base = Number(subtotal);
  const fee = deliveryType === "delivery" && isValidDeliveryQuote(quote) ? Number(quote.fee) : 0;
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(fee) || fee < 0 || (deliveryType === "delivery" && fee <= 0)) {
    throw new Error("INVALID_CHECKOUT_TOTAL");
  }
  return Math.round((base + fee) * 100) / 100;
}

export function deliveryQuoteLabel(vehicle, fee) {
  const label = vehicle === "MOTO" ? "moto" : vehicle === "CAR" ? "carro" : "";
  const value = Number(fee);
  if (!label || !Number.isFinite(value) || value < 0) throw new Error("INVALID_DELIVERY_QUOTE");
  return "Entrega de " + label + ": " + new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL",
  }).format(value);
}

export function isDeliveryOutOfArea(status, message = "") {
  return /fora da área|out.of.service.area|ERR_OUT_OF_SERVICE_AREA|LALAMOVE_OUT_OF_SERVICE_AREA|ADDRESS_OUTSIDE_MANAUS/i.test(String(message));
}

export function formatDeliveryMapAddressSummary(placeName, street, number, neighborhood) {
  const clean = value => String(value || "").trim();
  const normalize = value => clean(value).toLocaleLowerCase("pt-BR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const place = clean(placeName), road = clean(street), houseNumber = clean(number), district = clean(neighborhood);
  const placeKey = normalize(place);
  const duplicatePlace = placeKey && (
    placeKey === normalize(road) ||
    placeKey === normalize(road + " " + houseNumber) ||
    placeKey === normalize(road + ", " + houseNumber)
  );
  return [place && !duplicatePlace ? place : "", [road, houseNumber].filter(Boolean).join(", "), district]
    .filter(Boolean).join(" · ");
}

export function deliveryQuoteErrorMessage(status, code = "") {
  const known = {
    ADDRESS_NOT_FOUND: "Não encontramos esse endereço.",
    ADDRESS_OUTSIDE_MANAUS: "Endereço fora da área de entrega.",
    LALAMOVE_OUT_OF_SERVICE_AREA: "Endereço fora da área de entrega.",
    LALAMOVE_INVALID_COORDINATES: "Não foi possível validar o ponto marcado no mapa. Ajuste o pino e tente novamente.",
    LALAMOVE_INVALID_ADDRESS: "Endereço não encontrado. Confira rua, número e bairro.",
    LALAMOVE_INVALID_REQUEST: "A Lalamove recusou os dados do endereço ou da rota. Revise rua, número e ponto do mapa.",
    LALAMOVE_RATE_LIMIT: "Muitas consultas agora, tente em alguns segundos.",
    LALAMOVE_INVALID_SCHEDULE_TIME: "A Lalamove recusou o horário agendado. Tente novamente em instantes.",
    LALAMOVE_INVALID_SERVICE_TYPE: "A Lalamove não oferece o tipo de veículo selecionado para esta rota.",
    LALAMOVE_INVALID_MARKET: "A Lalamove não reconheceu a região desta rota. Confira o endereço.",
    LALAMOVE_REVERSE_GEOCODE_FAILURE: "A Lalamove não conseguiu validar a rota com as coordenadas. Tente novamente.",
    QUOTE_RATE_LIMIT: "Muitas consultas agora, tente em alguns segundos.",
    QUOTE_RATE_LIMIT_UNAVAILABLE: "Não foi possível verificar o limite de cotações agora. Tente novamente em instantes.",
    INVALID_ADDRESS: "Informe rua, número e bairro para calcular a entrega.",
    INVALID_ITEMS: "Não foi possível validar os produtos e quantidades do carrinho. Atualize o carrinho e tente novamente.",
    INVALID_QUOTE_PRICE: "A Lalamove retornou um preço inválido. Tente calcular novamente.",
    INVALID_QUOTE_RESPONSE: "A Lalamove retornou uma cotação inválida. Tente calcular novamente.",
    LALAMOVE_ENVIRONMENT_UNAVAILABLE: "Não foi possível ler o ambiente da Lalamove. Tente novamente.",
    INVALID_LALAMOVE_ENVIRONMENT: "O ambiente da Lalamove está inválido. Verifique a configuração no painel.",
    SANDBOX_CREDENTIALS_REQUIRED: "Credenciais Sandbox da Lalamove ausentes ou inválidas.",
    GEOCODER_NOT_CONFIGURED: "Serviço de localização não configurado. Tente novamente mais tarde.",
    GEOCODER_UNAVAILABLE: "Serviço de localização temporariamente indisponível. Tente novamente.",
    PRODUCTION_CREDENTIALS_REQUIRED: "Cotação indisponível: as credenciais de produção da Lalamove precisam ser verificadas.",
    INVALID_SCHEDULE_TIME: "Não foi possível agendar a cotação para o próximo horário de funcionamento. Tente novamente.",
    STORE_CLOSED: "Entrega disponível no horário de funcionamento.",
  };
  if (known[String(code)]) return known[String(code)];
  if (Number(status) === 429) return "Muitas consultas agora, tente em alguns segundos.";
  if (Number(status) === 422) return "A Lalamove recusou os dados do endereço ou da rota. Revise o endereço e o ponto do mapa.";
  if (Number(status) === 503) return "Serviço de cotação temporariamente indisponível. Tente novamente.";
  if (Number(status) === 504) return "A cotação demorou mais que o esperado. Tente novamente.";
  return "Não foi possível calcular a entrega por um erro inesperado. Tente novamente.";
}
