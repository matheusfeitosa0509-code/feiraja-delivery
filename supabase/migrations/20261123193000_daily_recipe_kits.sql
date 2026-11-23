-- Semana Temática B: kits de receita com preço fixo e composição para separação.
BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_recipe_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  image_url text,
  fixed_price numeric(10,2) NOT NULL CHECK (fixed_price > 0),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 6),
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.daily_recipe_kit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES public.daily_recipe_kits(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(10,3) NOT NULL CHECK (quantity > 0 AND quantity <= 100),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT daily_recipe_kit_items_kit_product_key UNIQUE (kit_id, product_id)
);

ALTER TABLE public.daily_recipe_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_recipe_kit_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily_recipe_kits, public.daily_recipe_kit_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.daily_recipe_kits, public.daily_recipe_kit_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.daily_recipe_kits, public.daily_recipe_kit_items TO authenticated;

DROP POLICY IF EXISTS daily_recipe_kits_public_active_read ON public.daily_recipe_kits;
CREATE POLICY daily_recipe_kits_public_active_read
  ON public.daily_recipe_kits FOR SELECT TO anon USING (is_active = true);
DROP POLICY IF EXISTS daily_recipe_kits_authenticated_read ON public.daily_recipe_kits;
CREATE POLICY daily_recipe_kits_authenticated_read
  ON public.daily_recipe_kits FOR SELECT TO authenticated
  USING (is_active = true OR public.is_current_user_admin());
DROP POLICY IF EXISTS daily_recipe_kits_admin_insert ON public.daily_recipe_kits;
CREATE POLICY daily_recipe_kits_admin_insert
  ON public.daily_recipe_kits FOR INSERT TO authenticated WITH CHECK (public.is_current_user_admin());
DROP POLICY IF EXISTS daily_recipe_kits_admin_update ON public.daily_recipe_kits;
CREATE POLICY daily_recipe_kits_admin_update
  ON public.daily_recipe_kits FOR UPDATE TO authenticated
  USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());
DROP POLICY IF EXISTS daily_recipe_kits_admin_delete ON public.daily_recipe_kits;
CREATE POLICY daily_recipe_kits_admin_delete
  ON public.daily_recipe_kits FOR DELETE TO authenticated USING (public.is_current_user_admin());

DROP POLICY IF EXISTS daily_recipe_kit_items_public_active_read ON public.daily_recipe_kit_items;
CREATE POLICY daily_recipe_kit_items_public_active_read
  ON public.daily_recipe_kit_items FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.daily_recipe_kits k WHERE k.id = kit_id AND k.is_active = true));
DROP POLICY IF EXISTS daily_recipe_kit_items_authenticated_read ON public.daily_recipe_kit_items;
CREATE POLICY daily_recipe_kit_items_authenticated_read
  ON public.daily_recipe_kit_items FOR SELECT TO authenticated
  USING (public.is_current_user_admin() OR EXISTS (SELECT 1 FROM public.daily_recipe_kits k WHERE k.id = kit_id AND k.is_active = true));
DROP POLICY IF EXISTS daily_recipe_kit_items_admin_insert ON public.daily_recipe_kit_items;
CREATE POLICY daily_recipe_kit_items_admin_insert
  ON public.daily_recipe_kit_items FOR INSERT TO authenticated WITH CHECK (public.is_current_user_admin());
DROP POLICY IF EXISTS daily_recipe_kit_items_admin_update ON public.daily_recipe_kit_items;
CREATE POLICY daily_recipe_kit_items_admin_update
  ON public.daily_recipe_kit_items FOR UPDATE TO authenticated
  USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());
DROP POLICY IF EXISTS daily_recipe_kit_items_admin_delete ON public.daily_recipe_kit_items;
CREATE POLICY daily_recipe_kit_items_admin_delete
  ON public.daily_recipe_kit_items FOR DELETE TO authenticated USING (public.is_current_user_admin());

INSERT INTO public.daily_recipe_kits (slug,name,description,fixed_price,weekday,is_active,sort_order)
VALUES
 ('kit-suco-semana','Kit Suco da Semana','Polpas de acerola, goiaba, caju e manga para preparar sucos variados.',52.99,1,false,1),
 ('kit-salada-fresca','Kit Salada Fresca','Verduras e legumes para montar saladas frescas.',53.99,2,false,2),
 ('kit-farinhas-tapioca','Kit Farinhas e Tapioca','Seleção de farinhas e goma para farofa e tapioca.',63.99,3,false,3),
 ('kit-legumes-refogados','Kit Legumes Refogados','Legumes e temperos para preparar refogados.',53.99,4,false,4),
 ('kit-salada-frutas','Kit Salada de Frutas','Frutas variadas para preparar uma salada de frutas.',61.99,5,false,5),
 ('kit-camarao-alho-oleo','Kit Camarão Alho e Óleo','Camarão, alho, limão e cheiro-verde para preparar alho e óleo.',64.99,6,false,6)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.daily_recipe_kit_items (kit_id,product_id,quantity,sort_order)
SELECT k.id,v.product_id,v.quantity,v.sort_order
FROM (VALUES
 ('kit-suco-semana','feiraja_polpa_de_acerola',2.000,1),
 ('kit-suco-semana','feiraja_polpa_de_goiaba',2.000,2),
 ('kit-suco-semana','feiraja_polpa_de_caju',1.000,3),
 ('kit-suco-semana','feiraja_polpa_de_manga',1.000,4),

 ('kit-salada-fresca','feiraja_alface',2.000,1),
 ('kit-salada-fresca','feiraja_tomate',0.500,2),
 ('kit-salada-fresca','feiraja_pepino',1.000,3),
 ('kit-salada-fresca','feiraja_cebola_roxa',0.500,4),
 ('kit-salada-fresca','feiraja_cenoura',0.500,5),
 ('kit-salada-fresca','feiraja_limao',0.500,6),
 ('kit-salada-fresca','feiraja_cheiro_verde_maco',1.000,7),
 ('kit-salada-fresca','feiraja_pimentao',0.500,8),
 ('kit-salada-fresca','feiraja_cebola',0.500,9),
 ('kit-salada-fresca','feiraja_beterraba',0.500,10),

 ('kit-farinhas-tapioca','prod_1793063885330',1.000,1),
 ('kit-farinhas-tapioca','feiraja_farinha_ovinha_1kg',1.000,2),
 ('kit-farinhas-tapioca','feiraja_farinha_ova_caroco_1kg',1.000,3),
 ('kit-farinhas-tapioca','feiraja_farinha_branca_1kg',1.000,4),
 ('kit-farinhas-tapioca','feiraja_farinha_tapioca_500g',1.000,5),
 ('kit-farinhas-tapioca','feiraja_goma_tapioca_1kg',1.000,6),

 ('kit-legumes-refogados','feiraja_batata',1.000,1),
 ('kit-legumes-refogados','feiraja_cenoura',1.000,2),
 ('kit-legumes-refogados','feiraja_abobrinha',1.000,3),
 ('kit-legumes-refogados','feiraja_berinjela',1.000,4),
 ('kit-legumes-refogados','feiraja_abobora',1.000,5),
 ('kit-legumes-refogados','feiraja_chuchu',0.500,6),
 ('kit-legumes-refogados','feiraja_cebola',1.000,7),
 ('kit-legumes-refogados','feiraja_cabeca_de_alho_1kg',0.100,8),
 ('kit-legumes-refogados','feiraja_cheiro_verde_maco',1.000,9),

 ('kit-salada-frutas','feiraja_banana_prata',1.000,1),
 ('kit-salada-frutas','feiraja_maca',1.000,2),
 ('kit-salada-frutas','feiraja_mamao',1.000,3),
 ('kit-salada-frutas','feiraja_manga',1.000,4),
 ('kit-salada-frutas','feiraja_laranja',1.000,5),
 ('kit-salada-frutas','feiraja_morango_250g',1.000,6),

 ('kit-camarao-alho-oleo','feiraja_camarao_10_gramas',1.000,1),
 ('kit-camarao-alho-oleo','feiraja_cabeca_de_alho_1kg',0.100,2),
 ('kit-camarao-alho-oleo','feiraja_limao',0.500,3),
 ('kit-camarao-alho-oleo','feiraja_cheiro_verde_maco',1.000,4)
) AS v(slug,product_id,quantity,sort_order)
JOIN public.daily_recipe_kits k ON k.slug = v.slug
JOIN public.products p ON p.id = v.product_id
ON CONFLICT (kit_id,product_id) DO NOTHING;

COMMENT ON TABLE public.daily_recipe_kits IS
  'Combos de receita com preço fixo; só podem ser comprados no weekday configurado, entre 06:00 e 12:59 America/Manaus.';
COMMENT ON TABLE public.daily_recipe_kit_items IS
  'Composição fixa dos kits; snapshot é copiado para orders.items no checkout.';

COMMIT;
