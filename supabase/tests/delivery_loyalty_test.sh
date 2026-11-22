#!/usr/bin/env bash
set -euo pipefail
export PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=delivery_loyalty_test
psql -v ON_ERROR_STOP=1 -f supabase/tests/delivery_loyalty_base.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261121140000_first_delivery_promo_server_a1.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261122145825_first_delivery_promo_ui_a2.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261122194500_cartao_fidelidade_entrega.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/delivery_loyalty_cases.sql

# Two simultaneous checkouts race for one six-stamp reward. Exactly one wins.
psql -v ON_ERROR_STOP=1 -c "UPDATE promo_private.promo_settings SET enabled=false WHERE singleton=true; UPDATE promo_private.delivery_loyalty_settings SET enabled=true,stamps_required=6,discount_cap=NULL WHERE singleton=true; INSERT INTO promo_private.delivery_loyalty_balances(user_id,stamps) VALUES ('00000000-0000-4000-8000-000000000005',6);"
psql -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status,payment_method) VALUES ('loyalty-race-a','00000000-0000-4000-8000-000000000005','92955550005','delivery','{\"postal_code\":\"69000-055\",\"number\":\"55\"}',40,12,52,'Pagamento Pendente','Asaas Pix'); SELECT pg_sleep(2); COMMIT;" &
pid_a=$!
sleep 0.2
psql -v ON_ERROR_STOP=1 -c "INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status,payment_method) VALUES ('loyalty-race-b','00000000-0000-4000-8000-000000000005','92955550006','delivery','{\"postal_code\":\"69000-056\",\"number\":\"56\"}',40,12,52,'Pagamento Pendente','Asaas Pix');"
wait "$pid_a"
count="$(psql -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.orders WHERE id IN ('loyalty-race-a','loyalty-race-b') AND promo_code='FIDELIDADE';")"
[[ "$count" == "1" ]] || { echo "::error::Reserva concorrente concedeu $count prêmios; esperado 1."; exit 1; }
echo "PASSOU | corrida simultânea de dois checkouts: exatamente um prêmio"
