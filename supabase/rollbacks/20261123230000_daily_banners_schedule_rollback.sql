DELETE FROM public.store_banners
WHERE action_type = 'kit'
  AND title IN (
    '🧃 Segunda da Polpa',
    '🥗 Terça Verde',
    '🌾 Bateu vontade de farofa e tapioca?',
    '🥕 Quinta dos Legumes',
    '🍌 Sexta das Frutas',
    '🦐 Sábado dos Frutos do Mar'
  );

ALTER TABLE public.store_banners
  DROP CONSTRAINT IF EXISTS store_banners_weekdays_valid,
  DROP CONSTRAINT IF EXISTS store_banners_schedule_time_pair;
ALTER TABLE public.store_banners
  DROP COLUMN IF EXISTS weekdays,
  DROP COLUMN IF EXISTS start_time,
  DROP COLUMN IF EXISTS end_time;

ALTER TABLE public.store_banners
  DROP CONSTRAINT IF EXISTS store_banners_action_type_check;
ALTER TABLE public.store_banners
  ADD CONSTRAINT store_banners_action_type_check
  CHECK (action_type = ANY (ARRAY['products','category','product','whatsapp','assistant','request_product','maps']::text[]));
