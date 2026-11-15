export function canShowDeliveryOption(deliveryActive, isAdmin) {
  return deliveryActive === true || isAdmin === true;
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
  return Number(status) === 422 || /fora da área|out.of.service.area|ERR_OUT_OF_SERVICE_AREA/i.test(String(message));
}
