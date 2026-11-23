-- Semana Temática A: regras de desconto por categoria, desligadas por padrão.
BEGIN;
CREATE TABLE IF NOT EXISTS public.daily_category_discounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 6),
 category text NOT NULL CHECK (length(btrim(category)) > 0),
 percent numeric(5,2) NOT NULL DEFAULT 10 CHECK (percent > 0 AND percent <= 90),
 is_active boolean NOT NULL DEFAULT false,
 excluded_product_ids text[] NOT NULL DEFAULT '{}'::text[],
 created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 CONSTRAINT daily_category_discounts_weekday_category_key UNIQUE (weekday, category)
);
ALTER TABLE public.daily_category_discounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily_category_discounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.daily_category_discounts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.daily_category_discounts TO authenticated;
DROP POLICY IF EXISTS daily_category_discounts_public_active_read ON public.daily_category_discounts;
CREATE POLICY daily_category_discounts_public_active_read ON public.daily_category_discounts FOR SELECT TO anon USING (is_active = true);
DROP POLICY IF EXISTS daily_category_discounts_authenticated_read ON public.daily_category_discounts;
CREATE POLICY daily_category_discounts_authenticated_read ON public.daily_category_discounts FOR SELECT TO authenticated USING (is_active = true OR public.is_current_user_admin());
DROP POLICY IF EXISTS daily_category_discounts_admin_insert ON public.daily_category_discounts;
CREATE POLICY daily_category_discounts_admin_insert ON public.daily_category_discounts FOR INSERT TO authenticated WITH CHECK (public.is_current_user_admin());
DROP POLICY IF EXISTS daily_category_discounts_admin_update ON public.daily_category_discounts;
CREATE POLICY daily_category_discounts_admin_update ON public.daily_category_discounts FOR UPDATE TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());
DROP POLICY IF EXISTS daily_category_discounts_admin_delete ON public.daily_category_discounts;
CREATE POLICY daily_category_discounts_admin_delete ON public.daily_category_discounts FOR DELETE TO authenticated USING (public.is_current_user_admin());
INSERT INTO public.daily_category_discounts (weekday, category, percent, is_active, excluded_product_ids) VALUES
 (1,'Polpas e Congelados',10,false,'{}'::text[]),
 (2,'Verduras e legumes',10,false,'{}'::text[]),
 (3,'Farinhas e derivados',10,false,'{}'::text[]),
 (5,'Frutas',10,false,'{}'::text[]),
 (6,'Pescados e frutos do mar',10,false,'{}'::text[])
ON CONFLICT (weekday, category) DO NOTHING;
COMMENT ON TABLE public.daily_category_discounts IS 'Regras de desconto diário por categoria. Todas começam desligadas; horário válido 06:00–12:59 em America/Manaus.';
COMMIT;
