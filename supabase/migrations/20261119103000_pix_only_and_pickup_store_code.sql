ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_code_format_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_code_format_check
  CHECK (
    (delivery_type = 'pickup_uber' AND pickup_code IS NOT NULL AND pickup_code ~ '^[0-9]{4}$')
    OR (delivery_type = 'pickup_store' AND (pickup_code IS NULL OR pickup_code ~ '^[0-9]{4}$'))
    OR (delivery_type NOT IN ('pickup_uber', 'pickup_store') AND pickup_code IS NULL)
  );

-- Backfill only active pickup_store orders. Historical method/status/amount are untouched.
UPDATE public.orders
SET pickup_code = lpad((floor(random() * 10000))::integer::text, 4, '0')
WHERE delivery_type = 'pickup_store'
  AND pickup_code IS NULL
  AND status NOT IN (
    'Cancelada',
    'Entregue',
    'Pagamento reembolsado',
    'Pagamento contestado',
    'Pagamento cancelado',
    'Pagamento recusado',
    'Pagamento Expirado'
  );
