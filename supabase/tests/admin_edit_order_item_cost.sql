-- Testes estruturais de segurança e cálculo para edição do custo do item.
DO $$
DECLARE v_def text; v_is_definer boolean;
BEGIN
  IF to_regclass('feira_cost_private.order_item_cost_history') IS NULL THEN
    RAISE EXCEPTION 'Tabela de histórico não criada';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='feira_cost_private.order_item_cost_history'::regclass) THEN
    RAISE EXCEPTION 'RLS deve permanecer habilitado no histórico';
  END IF;
  IF has_schema_privilege('anon','feira_cost_private','USAGE')
     OR has_schema_privilege('authenticated','feira_cost_private','USAGE') THEN
    RAISE EXCEPTION 'Schema privado exposto a clientes';
  END IF;
  IF has_function_privilege('anon','public.admin_update_order_item_cost(text,integer,numeric,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar a RPC';
  END IF;
  IF NOT has_function_privilege('authenticated','public.admin_update_order_item_cost(text,integer,numeric,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Painel autenticado precisa invocar a RPC (com verificação admin interna)';
  END IF;
  SELECT pg_get_functiondef(p.oid),p.prosecdef INTO v_def,v_is_definer
  FROM pg_proc p WHERE p.oid='public.admin_update_order_item_cost(text,integer,numeric,boolean)'::regprocedure;
  IF NOT v_is_definer OR position('is_current_user_admin' IN lower(v_def))=0
     OR position('auth.uid()' IN v_def)=0 THEN
    RAISE EXCEPTION 'RPC precisa ser SECURITY DEFINER e validar auth.uid + admin';
  END IF;
  IF position('order_item_cost_history' IN v_def)=0
     OR position('product_default_updated' IN v_def)=0 THEN
    RAISE EXCEPTION 'RPC precisa gravar auditoria e registrar atualização do custo padrão';
  END IF;
END $$;
