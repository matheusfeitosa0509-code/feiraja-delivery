export function isLegacyMercadoPagoWebhookNotice(url: URL, body: unknown): boolean {
  const queryType = String(url.searchParams.get("type") || url.searchParams.get("topic") || "").trim().toLowerCase();
  if (queryType === "payment" || url.searchParams.has("data.id")) return true;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  const bodyType = String(value.type || value.topic || "").trim().toLowerCase();
  const data = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : null;
  return bodyType === "payment" || (data !== null && data.id !== undefined && data.id !== null && String(data.id).trim() !== "");
}

export function isAsaasPixEnabled(paymentMethod: string, asaasEnabled: boolean): boolean {
  return String(paymentMethod || "").trim().toLowerCase() !== "pix" || asaasEnabled === true;
}
