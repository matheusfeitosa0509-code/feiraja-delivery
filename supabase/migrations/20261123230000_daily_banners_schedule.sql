ALTER TABLE public.store_banners
  ADD COLUMN IF NOT EXISTS weekdays smallint[],
  ADD COLUMN IF NOT EXISTS start_time time without time zone,
  ADD COLUMN IF NOT EXISTS end_time time without time zone;

ALTER TABLE public.store_banners
  DROP CONSTRAINT IF EXISTS store_banners_action_type_check;
ALTER TABLE public.store_banners
  ADD CONSTRAINT store_banners_action_type_check
  CHECK (action_type = ANY (ARRAY['products','category','product','kit','whatsapp','assistant','request_product','maps']::text[]));

ALTER TABLE public.store_banners
  DROP CONSTRAINT IF EXISTS store_banners_weekdays_valid,
  DROP CONSTRAINT IF EXISTS store_banners_schedule_time_pair;
ALTER TABLE public.store_banners
  ADD CONSTRAINT store_banners_weekdays_valid
  CHECK (weekdays IS NULL OR (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  )),
  ADD CONSTRAINT store_banners_schedule_time_pair
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  );

WITH themed_banners (
  weekday, title, subtitle, button_text, theme, kit_slug, sort_order
) AS (
  VALUES
    (1::smallint, '🧃 Segunda da Polpa', 'Polpas com 10% OFF + Kit Suco da Semana', 'Aproveitar', 'orange', 'kit-suco-semana', 10),
    (2::smallint, '🥗 Terça Verde', 'Verduras e legumes com 10% OFF + Kit Salada', 'Aproveitar', 'green', 'kit-salada-fresca', 20),
    (3::smallint, '🌾 Bateu vontade de farofa e tapioca?', 'Kit Farinhas e Tapioca + Farinhas 10% OFF', 'Quero meu kit', 'yellow', 'kit-farinhas-tapioca', 30),
    (4::smallint, '🥕 Quinta dos Legumes', 'Kit Legumes Refogados com preço especial', 'Quero meu kit', 'orange', 'kit-legumes-refogados', 40),
    (5::smallint, '🍌 Sexta das Frutas', 'Frutas com 10% OFF + Kit Salada de Frutas', 'Aproveitar', 'red', 'kit-salada-frutas', 50),
    (6::smallint, '🦐 Sábado dos Frutos do Mar', 'Kit Camarão Alho e Óleo com preço especial', 'Quero meu kit', 'green', 'kit-camarao-alho-oleo', 60)
)
INSERT INTO public.store_banners (
  title, subtitle, button_text, action_type, action_value, theme, audience,
  starts_at, ends_at, weekdays, start_time, end_time, is_active, sort_order
)
SELECT
  themed.title, themed.subtitle, themed.button_text, 'kit', kit.id::text,
  themed.theme, 'all', '2026-11-30 06:00:00-04'::timestamptz, NULL,
  ARRAY[themed.weekday]::smallint[], '06:00'::time, '13:00'::time, false, themed.sort_order
FROM themed_banners themed
JOIN public.daily_recipe_kits kit ON kit.slug = themed.kit_slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.store_banners existing
  WHERE existing.title = themed.title
    AND existing.action_type = 'kit'
    AND existing.action_value = kit.id::text
);
