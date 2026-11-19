export const CUSTOMER_PUSH_TITLE = "Feira On Delivery";

const CUSTOMER_MESSAGES: Record<string, string> = {
  "Pedido Recebido": "Recebemos seu pedido.",
  "Recebido": "Recebemos seu pedido.",
  "received": "Recebemos seu pedido.",
  "Pagamento Pendente": "Aguardando a confirmação do pagamento.",
  "Aguardando Pagamento Pix": "Aguardando a confirmação do pagamento.",
  "Pagamento em análise": "Aguardando a confirmação do pagamento.",
  "Pagamento Confirmado": "Pagamento confirmado! ✅ Já vamos separar seu pedido.",
  "Preparando": "Estamos separando seu pedido 🧺",
  "Preparando pedido": "Estamos separando seu pedido 🧺",
  "Separação iniciada": "Estamos separando seu pedido 🧺",
  "Pronto para Retirada": "Seu pedido está pronto! 🎉 Código de retirada: ",
  "Saiu para Entrega": "Seu pedido saiu para entrega 🛵",
  "Entregue": "Pedido entregue. Obrigado por comprar na Feira On! 💚",
  "Cancelada": "Seu pedido foi cancelado. Qualquer dúvida, fale com a gente.",
  "Pagamento cancelado": "Seu pedido foi cancelado. Qualquer dúvida, fale com a gente.",
  "Pagamento reembolsado": "Houve uma atualização do seu pedido.",
  "Pagamento contestado": "Houve uma atualização do seu pedido.",
};

export function getCustomerMessage(status: string, pickupCode = "indisponível"): string | null {
  const message = CUSTOMER_MESSAGES[status];
  if (message === undefined) return null;
  return status === "Pronto para Retirada" ? message + pickupCode : message;
}

export function customerOrderUrl(orderId: string): string {
  return `/loja.html?pedido=${encodeURIComponent(orderId)}#customerOrders`;
}

export function shouldSkipOrderPush(isTestOrder: boolean | null, userId: string | null): boolean {
  return isTestOrder === true || !userId;
}
