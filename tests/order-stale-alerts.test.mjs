import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261122190000_order_stale_admin_alert.sql", import.meta.url),
  "utf8",
);
const HOUR = 60 * 60 * 1000;

function isStale(order, now, activeRace = false) {
  if (order.is_test_order === true) return false;
  const terminal = ["Entregue", "Cancelada", "Cancelado", "Pagamento cancelado", "Concluído", "Concluido", "Concluída", "Concluida"];
  if (terminal.includes(order.status)) return false;
  const paidStale = order.paidAt != null && now - order.paidAt > 24 * HOUR;
  const readyStale =
    order.deliveryType === "delivery" &&
    ["Pronto para Retirada", "Pronto"].includes(order.status) &&
    order.readyAt != null &&
    now - order.readyAt > 3 * HOUR &&
    !activeRace;
  return paidStale || readyStale;
}

test("a) alerta pedido pago há mais de 24h, mas não antes do limite nem após conclusão", () => {
  const now = 50 * 24 * HOUR;
  assert.equal(isStale({ status: "Preparando", paidAt: now - 24 * HOUR - 1 }, now), true);
  assert.equal(isStale({ status: "Pagamento Confirmado", paidAt: now - 24 * HOUR }, now), false);
  assert.equal(isStale({ status: "Entregue", paidAt: now - 30 * HOUR }, now), false);
  assert.equal(isStale({ status: "Cancelada", paidAt: now - 30 * HOUR }, now), false);
});

test("b) alerta pronto para envio há mais de 3h somente sem corrida ativa", () => {
  const now = 50 * 24 * HOUR;
  const order = { status: "Pronto para Retirada", deliveryType: "delivery", readyAt: now - 3 * HOUR - 1 };
  assert.equal(isStale(order, now, false), true);
  assert.equal(isStale(order, now, true), false);
  assert.equal(isStale({ ...order, deliveryType: "pickup_store" }, now, false), false);
  assert.equal(isStale({ ...order, readyAt: now - 3 * HOUR }, now, false), false);
});

test("ignora sempre pedidos de teste, mesmo que ambos os prazos tenham vencido", () => {
  const now = 50 * 24 * HOUR;
  assert.equal(isStale({
    is_test_order: true, status: "Pronto para Retirada", deliveryType: "delivery",
    paidAt: now - 30 * HOUR, readyAt: now - 4 * HOUR,
  }, now), false);
});

test("não repete a cada 5 minutos e remove o alerta quando resolvido", () => {
  const alerts = new Map();
  const insertOnce = (orderId, eligible) => {
    if (eligible && !alerts.has(orderId)) alerts.set(orderId, "order_stale");
    if (!eligible) alerts.delete(orderId);
  };
  insertOnce("ORDER-1", true);
  insertOnce("ORDER-1", true);
  assert.equal(alerts.size, 1);
  insertOnce("ORDER-1", false);
  assert.equal(alerts.size, 0);

  assert.match(migration, /on conflict\s*\(tipo,order_id\) do nothing/i);
  assert.match(migration, /delete from public\.admin_alerts a[\s\S]*?a\.tipo='order_stale'[\s\S]*?not exists/i);
});

test("job registra relógio de status e aplica exclusão de pedidos de teste sem bypass", () => {
  assert.match(migration, /create table if not exists feira_cost_private\.order_stale_clock/i);
  assert.match(migration, /after insert or update of status, delivery_type on public\.orders/i);
  assert.match(migration, /coalesce\(o\.is_test_order,false\)=false/i);
  assert.match(migration, /interval '24 hours'/i);
  assert.match(migration, /interval '3 hours'/i);
  assert.match(migration, /from feira_cost_private\.lalamove_dispatch_history h[\s\S]*?h\.status in/i);
  assert.match(migration, /grant execute on function public\.process_admin_alert_jobs\(timestamptz\) to service_role/i);
});
