\set ON_ERROR_STOP on
\i supabase/tests/first_delivery_promo_base.sql
CREATE TABLE auth.users(id uuid PRIMARY KEY);
ALTER TABLE public.orders ADD COLUMN payment_method text;
