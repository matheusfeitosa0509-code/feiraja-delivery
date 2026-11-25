-- Rollback do Escritório Feira On V1. Remove somente objetos desta migration.
begin;
drop trigger if exists escritorio_tasks_updated_at on public.agent_tasks;
drop trigger if exists escritorio_agents_updated_at on public.agents;
drop function if exists public.escritorio_set_updated_at();
drop table if exists public.owner_approvals cascade;
drop table if exists public.agent_messages cascade;
drop table if exists public.agents cascade;
drop table if exists public.agent_tasks cascade;
commit;
