-- Rollback da Etapa 3 Lalamove. Somente antes de qualquer corrida real ou de teste persistida.
begin;
do $$
begin
 if exists(select 1 from feira_cost_private.lalamove_dispatches) then
  raise exception 'Rollback bloqueado: existem despachos registrados. Exporte e reconcilie os dados antes de remover.';
 end if;
 if exists(select 1 from feira_cost_private.lalamove_webhook_events) then
  raise exception 'Rollback bloqueado: existem eventos webhook registrados. Exporte e reconcilie os dados antes de remover.';
 end if;
end $$;
drop function if exists public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb);
drop function if exists public.service_cancel_lalamove_dispatch(text);
drop function if exists public.service_fail_lalamove_dispatch(text,text);
drop function if exists public.service_finish_lalamove_dispatch(text,text,numeric,text,text,jsonb);
drop function if exists public.service_get_lalamove_dispatch(text);
drop function if exists public.service_begin_lalamove_dispatch(text,uuid,text);
drop function if exists public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz);
drop table if exists feira_cost_private.lalamove_webhook_events;
drop table if exists feira_cost_private.lalamove_dispatches;
commit;
