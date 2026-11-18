-- Restore the previous intended ACL: only service_role may execute these RPCs.
begin;
revoke all on function public.consume_lalamove_tracking_rate_limit(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_lalamove_tracking_rate_limit(uuid,integer,integer) to service_role;
revoke all on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text) to service_role;
commit;
