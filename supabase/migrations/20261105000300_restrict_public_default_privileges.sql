-- Endurece os privilégios padrão de objetos novos no schema public.
-- A conexão usada nesta auditoria/migrations é postgres. O projeto também tem
-- ACLs padrão registradas para supabase_admin, então cobrimos ambos os criadores.
--
-- IMPORTANTE: EXECUTE de PUBLIC é privilégio global padrão do PostgreSQL.
-- Não é possível revogá-lo apenas no escopo IN SCHEMA; por isso a revogação
-- de PUBLIC abaixo é global para novas funções criadas por cada papel.
-- Os GRANTs explícitos para service_role e para o proprietário são preservados.

-- Objetos criados por postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Objetos criados por supabase_admin.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
