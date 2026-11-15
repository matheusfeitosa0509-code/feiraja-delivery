-- Remove the private tracking rate-limit RPC and its per-user counters.
begin;
drop function if exists public.consume_lalamove_tracking_rate_limit(uuid,integer,integer);
drop table if exists feira_cost_private.lalamove_tracking_rate_limits;
commit;
