-- ORDEM 104: contador diário de mensagens do assistente.
-- Tabela interna: sem acesso direto de anon/authenticated; somente service_role.
create table if not exists public.assistant_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  message_count integer not null default 0
    check (message_count >= 1 and message_count <= 20),
  created_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.assistant_daily_usage enable row level security;
revoke all on table public.assistant_daily_usage from public, anon, authenticated;
grant all on table public.assistant_daily_usage to service_role;

-- Incremento atômico por usuário/dia no fuso de Manaus.
-- SECURITY INVOKER: a chamada é feita pelo service_role da Edge Function.
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
    where public.assistant_daily_usage.message_count < 20
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.consume_assistant_daily_message(uuid) from public, anon, authenticated;
grant execute on function public.consume_assistant_daily_message(uuid) to service_role;
