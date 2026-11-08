-- ORDEM 103 — Solicitação de produtos pelos clientes.
-- Arquivo de proposta: NÃO APLICAR sem autorização explícita do responsável.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.product_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_name text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint product_requests_name_length
    check (char_length(btrim(product_name)) between 1 and 80),
  constraint product_requests_note_length
    check (note is null or char_length(note) <= 300)
);

create index product_requests_user_created_idx
  on public.product_requests (user_id, created_at desc);

alter table public.product_requests enable row level security;

revoke all on table public.product_requests from anon, authenticated;
grant select, insert on table public.product_requests to authenticated;

create policy "Customers read own product requests"
  on public.product_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Admins read all product requests"
  on public.product_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.admin_users a
      where a.user_id = (select auth.uid())
    )
  );

create policy "Customers insert own product requests"
  on public.product_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- A contagem é serializada por cliente e calculada no horário UTC.
-- O trigger também substitui created_at para impedir que o cliente retrodate pedidos.
create or replace function private.enforce_product_request_daily_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  day_start timestamptz;
  day_end timestamptz;
  request_count integer;
begin
  if new.user_id is null then
    raise exception 'É necessário estar conectado para pedir um produto.';
  end if;

  new.created_at := pg_catalog.now();
  day_start := pg_catalog.date_trunc('day', pg_catalog.timezone('UTC', pg_catalog.now())) at time zone 'UTC';
  day_end := day_start + interval '1 day';

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 0)
  );

  select count(*) into request_count
  from public.product_requests pr
  where pr.user_id = new.user_id
    and pr.created_at >= day_start
    and pr.created_at < day_end;

  if request_count >= 5 then
    raise exception 'Limite de 5 pedidos de produto por dia atingido.';
  end if;

  return new;
end;
$function$;

revoke execute on function private.enforce_product_request_daily_limit()
  from public, anon, authenticated;

create trigger product_requests_daily_limit
  before insert on public.product_requests
  for each row execute function private.enforce_product_request_daily_limit();

-- Não há políticas nem privilégios de UPDATE/DELETE para clientes.
