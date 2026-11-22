-- Endurece o acesso aos banners: evita política permissiva duplicada e mantém o helper fora do schema exposto.
drop policy if exists "store banners admin manage" on public.store_banners;
drop policy if exists "store banners public active read" on public.store_banners;

create or replace function promo_private.store_banner_promo_is_enabled(p_promo_code text)
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
revoke all on function promo_private.store_banner_promo_is_enabled(text) from public;
grant usage on schema promo_private to anon, authenticated;
grant execute on function promo_private.store_banner_promo_is_enabled(text) to anon, authenticated;
drop function if exists public.store_banner_promo_is_enabled(text);

create policy "store banners anon active read" on public.store_banners
for select to anon
using (
  is_active = true
  and starts_at <= pg_catalog.now()
  and (ends_at is null or ends_at > pg_catalog.now())
  and (promo_code is null or promo_private.store_banner_promo_is_enabled(promo_code))
);
create policy "store banners authenticated read" on public.store_banners
for select to authenticated
using (
  public.is_current_user_admin()
  or (
    is_active = true
    and starts_at <= pg_catalog.now()
    and (ends_at is null or ends_at > pg_catalog.now())
    and (promo_code is null or promo_private.store_banner_promo_is_enabled(promo_code))
  )
);
create policy "store banners admin insert" on public.store_banners
for insert to authenticated
with check (public.is_current_user_admin());
create policy "store banners admin update" on public.store_banners
for update to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());
create policy "store banners admin delete" on public.store_banners
for delete to authenticated
using (public.is_current_user_admin());
