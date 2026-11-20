-- Parte 2b: organizar Produtos e administrar solicitações de produtos.
-- Somente product_requests; nenhuma permissão de tabela ou política RLS é alterada.

ALTER TABLE public.product_requests ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS product_requests_active_created_idx
  ON public.product_requests (created_at DESC) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_list_product_requests()
RETURNS TABLE (id uuid, product_name text, note text, created_at timestamptz, customer_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.product_name, pr.note, pr.created_at,
    CASE WHEN pr.user_id IS NULL THEN NULL
      ELSE COALESCE(NULLIF(pg_catalog.btrim(cp.full_name), ''), 'Cliente sem nome')
    END AS customer_name
  FROM public.product_requests AS pr
  LEFT JOIN public.customer_profiles AS cp ON cp.user_id = pr.user_id
  WHERE pr.archived_at IS NULL
  ORDER BY pr.created_at DESC LIMIT 200;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_archive_product_request(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.product_requests SET archived_at = pg_catalog.now()
  WHERE id = p_request_id AND archived_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_product_request(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_deleted integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.product_requests WHERE id = p_request_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_product_requests() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_archive_product_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_product_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_product_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_product_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_product_request(uuid) TO authenticated;
