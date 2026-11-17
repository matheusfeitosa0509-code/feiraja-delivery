BEGIN;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
CREATE INDEX IF NOT EXISTS idx_orders_delivery_scheduled_for ON public.orders (scheduled_for)
  WHERE delivery_type = 'delivery' AND scheduled_for IS NOT NULL;
COMMENT ON COLUMN public.orders.scheduled_for IS
  'Início do próximo horário de funcionamento para pedidos de entrega feitos fora do horário; NULL para pedidos sem agendamento.';
COMMIT;
