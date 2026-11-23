begin;
alter table public.store_banners drop column if exists image_url;
commit;
