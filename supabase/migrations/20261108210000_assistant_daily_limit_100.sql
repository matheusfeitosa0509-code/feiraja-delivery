-- ORDEM 121: elevar o limite diário do assistente de 20 para 100 mensagens por usuário.
-- Não aplicar automaticamente em produção; executar somente após aprovação da PR.

alter table public.assistant_daily_usage
  drop constraint if exists assistant_daily_usage_message_count_check;

alter table public.assistant_daily_usage
  add constraint assistant_daily_usage_message_count_check
  check (message_count >= 1 and message_count <= 100);

create or replace function public.consume_assistant_daily_message(p_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_user_id is null then
    return false;
  end if;

  insert into public.assistant_daily_usage (user_id, usage_date, message_count)
  values (
    p_user_id,
    (statement_timestamp() at time zone 'America/Manaus')::date,
    1
  )
  on conflict (user_id, usage_date)
  do update
    set message_count = public.assistant_daily_usage.message_count + 1
    where public.assistant_daily_usage.message_count < 100
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.consume_assistant_daily_message(uuid) from public, anon, authenticated;
grant execute on function public.consume_assistant_daily_message(uuid) to service_role;
