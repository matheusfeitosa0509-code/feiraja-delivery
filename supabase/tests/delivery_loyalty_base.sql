\set ON_ERROR_STOP on
\i supabase/tests/first_delivery_promo_base.sql
CREATE TABLE auth.users(id uuid PRIMARY KEY);
ALTER TABLE public.orders ADD COLUMN payment_method text;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets(name text,decrypted_secret text);
CREATE OR REPLACE FUNCTION public.push_orders_notify_send(p_order_id text,p_kind text,p_event_status text,p_secret text)
RETURNS void LANGUAGE plpgsql AS $stub$ BEGIN RETURN; END; $stub$;
