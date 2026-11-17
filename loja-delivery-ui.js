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

export function normalizeDeliveryAddress(input) {
  const address = {
    street: String(input?.street || "").trim(),
    number: String(input?.number || "").trim(),
    neighborhood: String(input?.neighborhood || "").trim(),
    complement: String(input?.complement || "").trim(),
    reference: String(input?.reference || "").trim(),
  };
  if (!address.street || !address.number || !address.neighborhood) return null;
  if (address.street.length > 160 || address.number.length > 30 ||
      address.neighborhood.length > 100 || address.complement.length > 100 ||
      address.reference.length > 160) return null;
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

export function deliveryQuoteErrorMessage(status, code = "") {
  const known = {
    ADDRESS_NOT_FOUND: "Não encontramos esse endereço.",
    ADDRESS_OUTSIDE_MANAUS: "Endereço fora da área de entrega.",
    LALAMOVE_OUT_OF_SERVICE_AREA: "Endereço fora da área de entrega.",
    LALAMOVE_RATE_LIMIT: "Muitas consultas agora, tente em alguns segundos.",
    LALAMOVE_INVALID_SCHEDULE_TIME: "A Lalamove recusou o horário agendado. Tente novamente em instantes.",
    LALAMOVE_INVALID_SERVICE_TYPE: "A Lalamove não oferece o tipo de veículo selecionado para esta rota.",
    LALAMOVE_INVALID_MARKET: "A Lalamove não reconheceu a região desta rota. Confira o endereço.",
    QUOTE_RATE_LIMIT: "Muitas consultas agora, tente em alguns segundos.",
    STORE_CLOSED: "Entrega disponível no horário de funcionamento.",
  };
  return known[String(code)] || (Number(status) === 422
    ? "A Lalamove recusou esta cotação. Confira o endereço ou tente novamente."
    : "Entrega indisponível no momento.");
}
