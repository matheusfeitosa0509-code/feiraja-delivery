#!/usr/bin/env bash
set -euo pipefail
export PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=promo_a1_test
psql -v ON_ERROR_STOP=1 -f supabase/tests/first_delivery_promo_base.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261121140000_first_delivery_promo_server_a1.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/first_delivery_promo_cases.sql

# Concurrent reservation: both sessions race for the same user/phone/address.
psql -v ON_ERROR_STOP=1 -c "TRUNCATE public.orders, public.promo_redemptions; UPDATE private.promo_settings SET enabled=true,min_subtotal=50,ends_at=now()+interval '1 day',discount_cap=NULL WHERE singleton=true;"
psql -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status) VALUES ('race-a','00000000-0000-4000-8000-000000000020','92944440020','delivery','{\"postal_code\":\"69000-020\",\"number\":\"20\"}',60,12,72,'Pagamento Pendente'); SELECT pg_sleep(2); COMMIT;" &
pid_a=$!
sleep 0.2
psql -v ON_ERROR_STOP=1 -c "INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status) VALUES ('race-b','00000000-0000-4000-8000-000000000020','92944440020','delivery','{\"postal_code\":\"69000-020\",\"number\":\"20\"}',60,12,72,'Pagamento Pendente');"
wait "$pid_a"
count="$(psql -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.orders WHERE id IN ('race-a','race-b') AND promo_code='PRIMEIRA_ENTREGA';")"
[[ "$count" == "1" ]] || { echo "::error::Corrida simultânea concedeu $count descontos; esperado 1."; exit 1; }
echo "PASSOU | 2 pedidos simultâneos da mesma conta: exatamente 1 desconto"
