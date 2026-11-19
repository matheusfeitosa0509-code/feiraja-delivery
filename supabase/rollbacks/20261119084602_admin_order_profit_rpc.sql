-- Rollback for 20261119084602_admin_order_profit_rpc.sql
-- Removes only the read-only administrative RPC added by that migration.
DROP FUNCTION IF EXISTS public.admin_get_order_profit(text[], timestamptz, timestamptz);
