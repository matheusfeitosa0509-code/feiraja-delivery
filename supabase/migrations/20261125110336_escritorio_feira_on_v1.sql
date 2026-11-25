-- Escritório Feira On V1: tabelas isoladas e acesso exclusivo a administradores.
begin;
create table if not exists public.agents (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check (slug in ('ceo','executora','marketing','artes','sac')),
 name text not null, role text not null, color text not null,
 status text not null default 'livre' check (status in ('trabalhando','esperando_dono','travado','livre')),
 current_task_id uuid, rules_text text not null default '', rules_updated_at timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.agent_tasks (
 id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agents(id) on delete restrict,
 title text not null, details text not null default '',
 priority text not null default 'melhoria' check (priority in ('urgente','importante','melhoria','crescimento')),
 status text not null default 'a_fazer' check (status in ('a_fazer','fazendo','esperando_aprovacao','feito','cancelado')),
 due_at timestamptz, created_by uuid references auth.users(id) on delete set null default auth.uid(),
 source text not null default 'manual' check (source in ('manual','api')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), done_at timestamptz
);
alter table public.agents drop constraint if exists agents_current_task_id_fkey;
alter table public.agents add constraint agents_current_task_id_fkey foreign key(current_task_id) references public.agent_tasks(id) on delete set null;
create table if not exists public.agent_messages (
 id uuid primary key default gen_random_uuid(), from_agent uuid not null references public.agents(id) on delete restrict,
 to_agent uuid references public.agents(id) on delete set null, task_id uuid references public.agent_tasks(id) on delete set null,
 body text not null check(length(trim(body))>0), source text not null default 'manual' check(source in ('manual','api')),
 created_at timestamptz not null default now()
);
create table if not exists public.owner_approvals (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.agent_tasks(id) on delete cascade,
 requested_by uuid not null references public.agents(id) on delete restrict, question text not null,
 options jsonb not null default '[]'::jsonb, decision text check(decision in ('aprovado','recusado')),
 decided_at timestamptz, note text
);
create index if not exists agent_tasks_agent_status_idx on public.agent_tasks(agent_id,status);
create index if not exists agent_tasks_priority_created_idx on public.agent_tasks(priority,created_at desc);
create index if not exists agent_messages_created_idx on public.agent_messages(created_at desc);
create index if not exists owner_approvals_pending_idx on public.owner_approvals(decision) where decision is null;
create or replace function public.escritorio_set_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now(); return new; end; $$;
drop trigger if exists escritorio_agents_updated_at on public.agents;
create trigger escritorio_agents_updated_at before update on public.agents for each row execute function public.escritorio_set_updated_at();
drop trigger if exists escritorio_tasks_updated_at on public.agent_tasks;
create trigger escritorio_tasks_updated_at before update on public.agent_tasks for each row execute function public.escritorio_set_updated_at();
alter table public.agents enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_messages enable row level security;
alter table public.owner_approvals enable row level security;
create policy escritorio_admin_all_agents on public.agents for all to authenticated using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))) with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy escritorio_admin_all_tasks on public.agent_tasks for all to authenticated using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))) with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy escritorio_admin_all_messages on public.agent_messages for all to authenticated using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))) with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy escritorio_admin_all_approvals on public.owner_approvals for all to authenticated using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))) with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
grant select,insert,update,delete on public.agents,public.agent_tasks,public.agent_messages,public.owner_approvals to authenticated;
revoke all on public.agents,public.agent_tasks,public.agent_messages,public.owner_approvals from anon;
insert into public.agents(slug,name,role,color,status) values
 ('ceo','CEO','Estratégia e decisões','#d9a441','livre'),
 ('executora','Executora','Tecnologia e operação','#3478c8','livre'),
 ('marketing','Marketing','Campanhas e comunicação','#e66b43','livre'),
 ('artes','Artes','Identidade visual e fotografia','#9a68c9','livre'),
 ('sac','SAC','Atendimento e relacionamento','#269c91','livre')
on conflict(slug) do update set name=excluded.name,role=excluded.role,color=excluded.color;
with tasks(slug,title,details,priority) as (values
 ('executora','Bloquear Pix/checkout fora do horário','Verificar regra de bloqueio fora do horário comercial; qualquer alteração financeira exige autorização separada.','urgente'),
 ('executora','Corrigir o funil “Pago”','Investigar a etapa Pago e validar contagem e transições.','importante'),
 ('executora','Ícone 🧺 dos kits','Ajustar a identificação visual dos kits.','melhoria'),
 ('executora','Link direto do kit','Garantir navegação direta para o kit do dia.','melhoria'),
 ('executora','Unidade “un” x “kg” no pedido','Revisar consistência de unidade exibida nos itens do pedido.','melhoria'),
 ('executora','Teste automático kit → Pix mock','Criar teste automatizado sem transação financeira real.','melhoria'),
 ('marketing','Artes dos kits de quinta, sexta e sábado','Criar fotos dos kits montados na mesa.','importante'),
 ('marketing','Post fixo da semana','Preparar publicação; liberar somente em 30/11.','crescimento'),
 ('artes','Fotos de laranja, maçã, ovos, cenoura e cebola comum','Produzir no padrão fotográfico da loja.','melhoria'),
 ('sac','Retorno pendente a cliente','Responder ao atendimento pendente; dados pessoais e identificadores do pedido ficam fora do Escritório.','urgente'),
 ('ceo','[Dono] Corrigir preços de Coentro e Cebolinha','Pendência do dono; revisar preços pelo fluxo administrativo habitual.','urgente'),
 ('ceo','[Dono] Subir fotos novas','Alface, tomate, batata e Kit Salada.','importante'),
 ('ceo','Analisar funil de terça e quarta','Analisar desempenho dos kits e do anúncio de R$ 10.','importante')
)
insert into public.agent_tasks(agent_id,title,details,priority,status,source)
select a.id,t.title,t.details,t.priority,'a_fazer','manual' from tasks t join public.agents a on a.slug=t.slug
where not exists(select 1 from public.agent_tasks x where x.agent_id=a.id and x.title=t.title);
commit;
