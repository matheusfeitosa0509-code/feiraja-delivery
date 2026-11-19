-- Rollback: clear pickup_store codes created by this migration and restore the prior constraint.
-- This intentionally preserves all order methods, statuses, totals and historical rows.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_code_format_check;

UPDATE public.orders
SET pickup_code = NULL
WHERE delivery_type = 'pickup_store';

ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_code_format_check
  CHECK (
    ((delivery_type = 'pickup_uber') AND (pickup_code IS NOT NULL) AND (pickup_code ~ '^[0-9]{4}$'))
    OR ((delivery_type <> 'pickup_uber') AND (pickup_code IS NULL))
  );
