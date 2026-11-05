-- Restringe os privilégios padrão de objetos novos no schema public.
-- Aplica-se somente aos objetos criados por postgres e supabase_admin.
-- Revoga apenas concessões padrão explícitas a anon e authenticated.
-- Não revoga privilégios de service_role nem do proprietário.
--
-- IMPORTANTE: o EXECUTE concedido por padrão a PUBLIC em funções novas
-- não é removido por estas instruções. Cada CREATE FUNCTION futuro deve
-- revogar PUBLIC, anon e authenticated individualmente; veja README.md.

-- Objetos criados por postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Objetos criados por supabase_admin.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
