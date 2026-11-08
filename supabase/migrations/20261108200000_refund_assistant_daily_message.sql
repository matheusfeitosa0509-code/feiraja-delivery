-- ORDEM 115: estorno atômico de mensagem em falha interna do assistente.
-- A data usa exatamente a mesma expressão de consume_assistant_daily_message:
-- (statement_timestamp() at time zone 'America/Manaus')::date
create or replace function public.refund_assistant_daily_message(p_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_date date;
  v_count integer;
begin
  if p_user_id is null then
    return false;
  end if;

  v_date := (statement_timestamp() at time zone 'America/Manaus')::date;

  select message_count
    into v_count
  from public.assistant_daily_usage
  where user_id = p_user_id
    and usage_date = v_date
  for update;

  if not found then
    return false;
  end if;

  if v_count <= 1 then
    delete from public.assistant_daily_usage
    where user_id = p_user_id
      and usage_date = v_date;
  else
    update public.assistant_daily_usage
    set message_count = message_count - 1
    where user_id = p_user_id
      and usage_date = v_date;
  end if;

  return true;
end;
$$;

revoke all on function public.refund_assistant_daily_message(uuid)
  from public, anon, authenticated;

grant execute on function public.refund_assistant_daily_message(uuid)
  to service_role;
