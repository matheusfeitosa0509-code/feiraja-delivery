-- Rollback for customer-order-push-a2b.
DROP FUNCTION IF EXISTS public.push_orders_notify_send(text, text, text, text);
-- Restore the previously deployed trigger function from migration
-- 20261109160916_push_orders_notify.sql before re-enabling customer push.
ALTER TABLE public.push_events
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS sent_count;
