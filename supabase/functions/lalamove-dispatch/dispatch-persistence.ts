export async function persistCreatedLalamoveDispatch(db: any, input: {
  orderId: string; lalamoveOrderId: string; actualCost: number; status: string;
  trackingUrl: string; driver: Record<string, unknown>;
}): Promise<{ persisted: boolean; retried: boolean }> {
  const args = {
    p_order_id: input.orderId, p_lalamove_order_id: input.lalamoveOrderId,
    p_actual_cost: input.actualCost, p_status: input.status,
    p_tracking_url: input.trackingUrl, p_driver: input.driver,
  };
  const verify = async () => {
    const { data, error } = await db.from("orders").select("lalamove_order_id")
      .eq("id", input.orderId).maybeSingle();
    return !error && String(data?.lalamove_order_id || "") === input.lalamoveOrderId;
  };
  const first = await db.rpc("service_finish_lalamove_dispatch", args);
  if (!first.error && await verify()) return { persisted: true, retried: false };

  // O parceiro já criou a corrida: registre o incidente antes da única retentativa.
  try {
    await db.from("admin_alerts").insert({
      tipo: "dispatch_orphan", order_id: input.orderId,
      mensagem: `🔴 Corrida Lalamove criada, mas o primeiro salvamento falhou – pedido ${input.orderId}, corrida ${input.lalamoveOrderId}. Retentativa automática iniciada.`,
    });
  } catch { /* alerta nunca impede a tentativa de recuperação */ }

  const retry = await db.rpc("service_finish_lalamove_dispatch", args);
  if (!retry.error && await verify()) return { persisted: true, retried: true };
  return { persisted: false, retried: true };
}
