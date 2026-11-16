-- Rollback for 20261116100000_lalamove_production_environment.sql
begin;

-- Restore the previous two-argument admin update RPC and its original semantics.
drop function if exists public.admin_update_delivery_settings(boolean,numeric,text);
create function public.admin_update_delivery_settings(p_delivery_ativa boolean,p_moto_limite_kg numeric)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.is_current_user_admin() then
  raise exception 'Acesso permitido somente a administradores.' using errcode='42501';
 end if;
 if p_delivery_ativa is null or p_moto_limite_kg is null or p_moto_limite_kg<=0 or p_moto_limite_kg>100 then
  raise exception 'Configuracao de entrega invalida.' using errcode='22023';
 end if;
 update public.delivery_settings set delivery_ativa=p_delivery_ativa,moto_limite_kg=p_moto_limite_kg,
  updated_at=now(),updated_by=auth.uid() where singleton=true;
 return public.admin_get_delivery_settings();
end;
$$;
revoke all on function public.admin_update_delivery_settings(boolean,numeric) from public,anon;
grant execute on function public.admin_update_delivery_settings(boolean,numeric) to authenticated;

drop function if exists public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz,text);
drop function if exists public.service_begin_lalamove_dispatch(text,uuid,text,text);
drop function if exists public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text);
alter table feira_cost_private.lalamove_dispatches drop constraint if exists lalamove_dispatches_ambiente_check;
alter table feira_cost_private.lalamove_dispatches drop column if exists ambiente;
alter table public.delivery_settings drop constraint if exists delivery_settings_lalamove_ambiente_check;
alter table public.delivery_settings drop column if exists lalamove_ambiente;
update public.delivery_settings set moto_limite_kg=8,updated_at=now() where singleton=true;

commit;
