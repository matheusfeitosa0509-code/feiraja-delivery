-- ORDEM 108 / Fase 2A
-- Regras de venda independentes das regras de revenda.
create table public.product_sales_rules (
  product_id text primary key
    references public.products(id) on delete cascade,
  sale_unit text not null
    check (sale_unit in ('kg', 'un', 'pacote', 'maco', 'duzia')),
  quantity_step numeric not null
    check (quantity_step > 0),
  min_quantity numeric not null
    check (min_quantity > 0),
  max_quantity numeric not null
    check (max_quantity >= min_quantity)
);

comment on table public.product_sales_rules is
  'Regras de unidade e quantidade de venda por produto. Ausência de linha significa venda em unidades inteiras de 1 a 100.';
comment on column public.product_sales_rules.sale_unit is
  'Unidade comercial: kg, un, pacote, maco ou duzia.';
comment on column public.product_sales_rules.quantity_step is
  'Incremento permitido para a quantidade vendida.';
comment on column public.product_sales_rules.min_quantity is
  'Quantidade mínima por produto no pedido.';
comment on column public.product_sales_rules.max_quantity is
  'Quantidade máxima por produto no pedido.';

alter table public.product_sales_rules enable row level security;

revoke all on table public.product_sales_rules from public, anon, authenticated;
grant select on table public.product_sales_rules to anon, authenticated;
grant all on table public.product_sales_rules to service_role;

create policy "Product sales rules are readable"
  on public.product_sales_rules
  for select
  to anon, authenticated
  using (true);

-- Seed exclusivamente dos produtos cujo nome contém literalmente "(kg)".
-- Produtos sem linha continuam sujeitos à validação inteira legada (1 a 100).
insert into public.product_sales_rules (
  product_id,
  sale_unit,
  quantity_step,
  min_quantity,
  max_quantity
)
select
  p.id,
  'kg',
  0.5,
  0.5,
  100
from public.products as p
where p.name ~* '\\(kg\\)'
on conflict (product_id) do nothing;
