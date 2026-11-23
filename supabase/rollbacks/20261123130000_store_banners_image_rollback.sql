begin;
do $$
begin
  if exists (select 1 from public.store_banners where image_url is not null) then
    raise exception 'Existem banners com imagem_url; faça backup ou limpe as referências antes de remover a coluna.';
  end if;
end;
$$;
alter table public.store_banners drop column if exists image_url;
commit;
