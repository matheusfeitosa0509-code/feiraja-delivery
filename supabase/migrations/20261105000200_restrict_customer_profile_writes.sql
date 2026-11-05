-- Limita gravações de customer_profiles ao conjunto de colunas editáveis pelo próprio cliente.
-- A policy RLS existente continua exigindo auth.uid() = user_id em USING e WITH CHECK.
REVOKE INSERT, UPDATE ON TABLE public.customer_profiles FROM authenticated;

-- user_id é necessário no INSERT e no upsert por conflito. A policy WITH CHECK
-- impede que o usuário transfira a linha para outro user_id.
GRANT INSERT (user_id, full_name, phone, cpf, address)
ON TABLE public.customer_profiles TO authenticated;

GRANT UPDATE (user_id, full_name, phone, cpf, address)
ON TABLE public.customer_profiles TO authenticated;

-- updated_at passa a ser gerenciado pelo banco em qualquer INSERT/UPDATE.
CREATE OR REPLACE FUNCTION public.customer_profiles_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.customer_profiles_touch_updated_at()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_profiles_touch_updated_at
ON public.customer_profiles;

CREATE TRIGGER customer_profiles_touch_updated_at
BEFORE INSERT OR UPDATE ON public.customer_profiles
FOR EACH ROW
EXECUTE FUNCTION public.customer_profiles_touch_updated_at();
