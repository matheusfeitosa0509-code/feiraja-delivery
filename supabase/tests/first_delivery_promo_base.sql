\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

CREATE TABLE public.orders (
  id text PRIMARY KEY,
  user_id uuid,
  customer_name text NOT NULL DEFAULT 'Teste',
  customer_phone text NOT NULL,
  delivery_type text NOT NULL,
  delivery_address jsonb,
  subtotal numeric(12,2) NOT NULL,
  delivery_fee numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  status text NOT NULL,
  is_test_order boolean NOT NULL DEFAULT false
);
