\set ON_ERROR_STOP on
DO $roles$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $roles$;
CREATE SCHEMA IF NOT EXISTS feira_cost_private;
CREATE SCHEMA IF NOT EXISTS test_support;
CREATE TABLE public.delivery_settings(singleton boolean primary key default true,lalamove_ambiente text not null);
INSERT INTO public.delivery_settings(singleton,lalamove_ambiente) VALUES(true,'sandbox');
CREATE TABLE public.orders(
 id text primary key,status text not null,payment_method text not null,
 payment_provider text,payment_id text,is_test_order boolean not null default false,
 delivery_type text not null,delivery_fee numeric not null default 10,
 created_at timestamptz not null default now(),lalamove_status text,lalamove_status_updated_at timestamptz
);
CREATE TABLE public.admin_alerts(
 id bigserial primary key,tipo text not null,order_id text not null,mensagem text not null,
 criado_em timestamptz not null default now(),lido boolean not null default false,
 unique(tipo,order_id)
);
CREATE TABLE feira_cost_private.lalamove_dispatches(
 order_id text primary key,state text not null check(state in ('quoted','creating','created','failed','cancelled')),
 quote_session_id uuid,quote_moto jsonb,quote_car jsonb,
 quote_moto_expires_at timestamptz,quote_car_expires_at timestamptz,
 selected_vehicle text, lalamove_order_id text,ambiente text not null default 'sandbox',
 updated_at timestamptz not null default now()
);
CREATE OR REPLACE FUNCTION test_support.seed_dispatch_case(
 p_id text,p_status text default 'Pagamento Confirmado',
 p_provider text default 'asaas',p_payment_id text default 'pay_test_123',
 p_is_test boolean default false,p_created_at timestamptz default now(),
 p_dispatch_state text default 'quoted'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_session uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.orders(id,status,payment_method,payment_provider,payment_id,is_test_order,delivery_type,created_at)
 VALUES(p_id,p_status,'Pix',p_provider,p_payment_id,p_is_test,'delivery',p_created_at);
 INSERT INTO feira_cost_private.lalamove_dispatches(
  order_id,state,quote_session_id,quote_moto,quote_car,quote_moto_expires_at,quote_car_expires_at,ambiente
 ) VALUES(p_id,p_dispatch_state,v_session,'{"quotationId":"moto"}','{"quotationId":"car"}',
          now()+interval '10 minutes',now()+interval '10 minutes','sandbox');
 RETURN v_session;
END $$;
