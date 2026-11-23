begin;
alter table public.store_banners
  add column if not exists image_url text;
comment on column public.store_banners.image_url is 'URL pública opcional da imagem WebP do banner, armazenada no bucket product-photos.';
commit;
