export type MercadoPagoStatusDecision =
  | { ignored: true; reason: string }
  | { ignored: false; nextStatus: string };

export function resolveMercadoPagoOrderStatus(input: {
  orderStatus: string;
  incomingStatus: string;
  storedPaymentId: string | null;
  incomingPaymentId: string;
}): MercadoPagoStatusDecision {
  const { orderStatus, incomingStatus, storedPaymentId, incomingPaymentId } = input;
  if (storedPaymentId && storedPaymentId !== incomingPaymentId) {
    return { ignored: true, reason: "payment_id_mismatch" };
  }
  const normalizedOrderStatus = String(orderStatus || "").trim().toLowerCase();
  const isCancelledOrder = normalizedOrderStatus === "cancelada" || normalizedOrderStatus === "cancelado";

  if (incomingStatus === "approved" && isCancelledOrder) {
    return { ignored: true, reason: "pedido_cancelado_pagamento_aprovado" };
  }

  const statusMap: Record<string, string> = {
    approved: "Pagamento Confirmado",
    pending: "Pagamento Pendente",
    in_process: "Pagamento Pendente",
    rejected: "Cancelada",
    cancelled: "Cancelada",
    refunded: "Cancelada",
    expired: "Cancelada",
    charged_back: "Cancelada",
  };
  const nextStatus = statusMap[incomingStatus];
  return nextStatus
    ? { ignored: false, nextStatus }
    : { ignored: true, reason: "status_nao_mapeado" };
}
