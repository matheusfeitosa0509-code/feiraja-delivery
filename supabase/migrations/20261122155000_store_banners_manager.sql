-- Gerenciador de banners da loja: leitura pública condicionada e escrita exclusiva de admins.
create table if not exists public.store_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  subtitle text not null default '' check (char_length(subtitle) <= 240),
  button_text text not null check (char_length(btrim(button_text)) between 1 and 60),
  action_type text not null check (action_type in ('products','category','product','whatsapp','assistant','request_product','maps')),
  action_value text,
  theme text not null default 'green' check (theme in ('green','yellow','orange','red')),
  audience text not null default 'all' check (audience in ('all','new_customers','returning')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  rules_text text check (rules_text is null or char_length(rules_text) <= 1200),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  promo_code text check (promo_code is null or char_length(promo_code) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_banners_valid_window check (ends_at is null or ends_at > starts_at)
);
create index if not exists store_banners_public_order_idx on public.store_banners (sort_order, starts_at, ends_at) where is_active = true;
alter table public.store_banners enable row level security;
grant select on public.store_banners to anon, authenticated;
grant insert, update, delete on public.store_banners to authenticated;

create or replace function public.store_banner_promo_is_enabled(p_promo_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_promo_code = 'PRIMEIRA_ENTREGA' then exists (
      select 1 from promo_private.promo_settings ps
      where ps.singleton = true
        and ps.enabled = true
        and (ps.ends_at is null or ps.ends_at > pg_catalog.now())
    )
    else false
  end;
$function$;
revoke all on function public.store_banner_promo_is_enabled(text) from public;
grant execute on function public.store_banner_promo_is_enabled(text) to anon, authenticated;

drop policy if exists "store banners public active read" on public.store_banners;
create policy "store banners public active read" on public.store_banners
for select to anon, authenticated
using (
  is_active = true
  and starts_at <= pg_catalog.now()
  and (ends_at is null or ends_at > pg_catalog.now())
  and (promo_code is null or public.store_banner_promo_is_enabled(promo_code))
);
drop policy if exists "store banners admin manage" on public.store_banners;
create policy "store banners admin manage" on public.store_banners
for all to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

create or replace function public.store_banners_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;
revoke all on function public.store_banners_set_updated_at() from public, anon, authenticated;
drop trigger if exists store_banners_set_updated_at on public.store_banners;
create trigger store_banners_set_updated_at
before update on public.store_banners
for each row execute function public.store_banners_set_updated_at();

insert into public.store_banners
(id,title,subtitle,button_text,action_type,action_value,theme,audience,starts_at,ends_at,rules_text,is_active,sort_order,promo_code)
values
('00000000-0000-4000-8000-000000000001','🎁 Sua 1ª entrega é GRÁTIS','Pedidos a partir de R$ 50 · Por tempo limitado','Montar meu pedido','products',null,'green','new_customers',now(),'2027-01-01 03:59:59+00','1ª entrega grátis para novos clientes. Pedidos a partir de R$ 50 (produtos), somente entrega, pagamento via Pix, 1 por cliente (conta, telefone e endereço). Válido até 31/12/2026.',true,10,'PRIMEIRA_ENTREGA'),
('00000000-0000-4000-8000-000000000002','Fale com o Assistente','Diga o que você precisa, por voz ou texto. Ele monta uma sugestão para você conferir.','Abrir assistente','assistant',null,'green','all',now(),null,null,true,20,null),
('00000000-0000-4000-8000-000000000003','Não achou o produto?','Envie o nome do que você procura.','Pedir um produto','request_product',null,'green','all',now(),null,null,true,30,null),
('00000000-0000-4000-8000-000000000004','Retire na feira','Av. Lourenço da Silva Braga, 700, Manaus. Retire na loja ou receba em casa com a Entrega Feira On.','Como chegar','maps',null,'green','all',now(),null,null,true,40,null)
on conflict (id) do update set
 title=excluded.title,subtitle=excluded.subtitle,button_text=excluded.button_text,action_type=excluded.action_type,
 action_value=excluded.action_value,theme=excluded.theme,audience=excluded.audience,starts_at=excluded.starts_at,
 ends_at=excluded.ends_at,rules_text=excluded.rules_text,is_active=excluded.is_active,sort_order=excluded.sort_order,promo_code=excluded.promo_code;
