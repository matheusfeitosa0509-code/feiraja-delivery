export function isCancelledOrderStatus(status: unknown): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "cancelada" || normalized === "cancelado";
}

export function buildCancelledPaymentPatch(storedPaymentId: string, paymentId: string) {
  return {
    refund_pending: true,
    ...(!storedPaymentId ? { payment_id: paymentId } : {}),
  };
}

export function isVerifiedPixPayment(input: {
  paymentId: string;
  externalReference: string;
  billingType: string;
  status: string;
  webhookValue: number;
  verifiedId: string;
  verifiedExternalReference: string;
  verifiedBillingType: string;
  verifiedValue: number;
  expectedTotal: number | null;
}): boolean {
  const webhookCents = Math.round(input.webhookValue * 100);
  const verifiedCents = Math.round(input.verifiedValue * 100);
  const amountMatches = input.expectedTotal === null
    ? Number.isFinite(webhookCents) && webhookCents > 0 && webhookCents === verifiedCents
    : Number.isFinite(input.expectedTotal) && input.expectedTotal > 0 &&
      webhookCents === Math.round(input.expectedTotal * 100) &&
      verifiedCents === Math.round(input.expectedTotal * 100);
  return input.verifiedId === input.paymentId &&
    input.verifiedExternalReference === input.externalReference &&
    input.verifiedBillingType.toUpperCase() === "PIX" &&
    ["RECEIVED", "CONFIRMED"].includes(input.status.toUpperCase()) &&
    amountMatches;
}

export function shouldNotifyAdminWithoutOrder(isPaymentConfirmationEvent: boolean, orderMatchesAsaas: boolean): boolean {
  return isPaymentConfirmationEvent && !orderMatchesAsaas;
}
