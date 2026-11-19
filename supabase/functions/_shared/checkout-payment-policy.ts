export function checkoutPaymentMethodError(value: string): string | null {
  const method = String(value || "").trim().toLowerCase();
  if (method === "cash" || method === "card_on_delivery") {
    return "Pagamento disponível somente por Pix.";
  }
  if (method !== "pix" && method !== "pix_test") {
    return "Forma de pagamento inválida.";
  }
  return null;
}
