-- Rollback of manual status refresh RPC. Does not alter existing dispatches or cost rows.
begin;
drop function if exists public.service_sync_lalamove_dispatch(text,text,numeric,text,jsonb,timestamptz);
commit;
