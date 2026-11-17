export function isAdminRpcTrue(value) {
  return value === true || value === "true" || value === 1;
}

export function canShowDeliveryOption(deliveryActive, isAdmin, adminCheckComplete = true, withinHours = true) {
  return deliveryActive === true && adminCheckComplete === true && withinHours === true;
}

export function isDeliveryOptionDisabled(deliveryActive, isAdmin, adminCheckComplete = false, withinHours = true) {
  if (deliveryActive === true) return adminCheckComplete !== true || withinHours !== true;
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

export function renderDeliveryOption({ option, radio, starting, description, isAdmin, adminCheckComplete, deliveryActive, withinHours = true }) {
  const enabledForCustomers = canShowDeliveryOption(deliveryActive, isAdmin, adminCheckComplete, withinHours);
  const adminPreview = deliveryActive !== true && adminCheckComplete === true && isAdmin === true;
  const disabled = !(enabledForCustomers || adminPreview);
  option.hidden = false;
  radio.disabled = disabled;
  option.classList.toggle("is-disabled", disabled);
  option.setAttribute("aria-disabled", String(disabled));
  starting.replaceChildren();
  if (enabledForCustomers) {
    starting.textContent = "Calcular taxa";
    description.textContent = "Taxa por distância, paga com Pix junto do pedido.";
  } else if (deliveryActive === true && withinHours !== true) {
    starting.textContent = "Fora do horário";
    description.textContent = "Entrega disponível no horário de funcionamento.";
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
export function deliveryUnavailableMessage(deliveryActive = false, withinHours = true) {
  if (deliveryActive === true && withinHours !== true) return "Entrega disponível no horário de funcionamento.";
  return "A Entrega Feira On está temporariamente indisponível. Escolha Retirar na loja.";
}

export function canShowUberPickupOption(deliveryActive) {
  return deliveryActive !== true;
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

export function checkoutGrandTotal(subtotal, deliveryType, quote) {
  const base = Number(subtotal);
  const fee = deliveryType === "delivery" && quote ? Number(quote.fee) : 0;
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(fee) || fee < 0) {
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
  return Number(status) === 422 || /fora da área|out.of.service.area|ERR_OUT_OF_SERVICE_AREA|LALAMOVE_OUT_OF_SERVICE_AREA|ADDRESS_OUTSIDE_MANAUS/i.test(String(message));
}

export function deliveryQuoteErrorMessage(status, code = "") {
  const known = {
    ADDRESS_NOT_FOUND: "Endereço não encontrado. Confira a rua, o número e o bairro.",
    ADDRESS_OUTSIDE_MANAUS: "Este endereço fica fora de Manaus - AM. Informe um endereço dentro de Manaus.",
    GEOCODER_NOT_CONFIGURED: "Serviço de localização não configurado. Falta o Secret GOOGLE_GEOCODING_API_KEY no Supabase.",
    GOOGLE_PLACES_NOT_CONFIGURED: "Autocomplete não configurado. Ative Places API (New) na chave Google salva no Supabase.",
    PLACES_UNAVAILABLE: "Não foi possível consultar sugestões do Google agora. Tente novamente ou marque no mapa.",
    GEOCODER_UNAVAILABLE: "Não foi possível localizar o endereço agora. Tente novamente em instantes.",
    LALAMOVE_OUT_OF_SERVICE_AREA: "Endereço localizado, mas a Lalamove não atende esta região.",
    LALAMOVE_REVERSE_GEOCODE_FAILURE: "A Lalamove não conseguiu validar a rota mesmo com as coordenadas. Tente novamente.",
    LALAMOVE_RATE_LIMIT: "A Lalamove está recebendo muitas cotações. Aguarde um minuto e tente novamente.",
    LALAMOVE_QUOTE_FAILED: "A localização foi encontrada, mas a Lalamove não concluiu a cotação. Tente novamente.",
    STORE_CLOSED: "Entrega disponível no horário de funcionamento.",
  };
  return known[String(code)] || (Number(status) === 422
    ? "Endereço localizado, mas não está disponível para entrega."
    : "Não foi possível calcular a entrega. Tente novamente.");
}
