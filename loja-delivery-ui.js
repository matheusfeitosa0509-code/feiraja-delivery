export function isAdminRpcTrue(value) {
  return value === true || value === "true" || value === 1;
}

export function canShowDeliveryOption(deliveryActive, isAdmin) {
  return deliveryActive === true || isAdmin === true;
}

export function isDeliveryOptionDisabled(deliveryActive, isAdmin) {
  return deliveryActive !== true && isAdmin !== true;
}

export function deliveryUnavailableMessage() {
  return "A Entrega Feira On chega em breve. Por enquanto, retire na loja ou receba com seu Uber.";
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
  };
  return known[String(code)] || (Number(status) === 422
    ? "Endereço localizado, mas não está disponível para entrega."
    : "Não foi possível calcular a entrega. Tente novamente.");
}
