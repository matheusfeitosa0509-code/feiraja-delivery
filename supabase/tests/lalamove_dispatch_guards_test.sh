#!/usr/bin/env bash
set -euo pipefail
export PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=lalamove_guards_test
psql -v ON_ERROR_STOP=1 -f supabase/tests/lalamove_dispatch_guards_base.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261122010000_lalamove_dispatch_database_guards.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/lalamove_dispatch_guards_cases.sql

# Race two independent database sessions against one eligible order.
psql -v ON_ERROR_STOP=1 -c "SELECT pg_temp.seed_dispatch_case('guard-race');" 2>/dev/null || true
psql -v ON_ERROR_STOP=1 -c "INSERT INTO public.orders(id,status,payment_method,payment_provider,payment_id,is_test_order,delivery_type) VALUES('guard-race','Pagamento Confirmado','Pix','asaas','pay_race',false,'delivery'); INSERT INTO feira_cost_private.lalamove_dispatches(order_id,state,quote_session_id,quote_moto,quote_car,quote_moto_expires_at,quote_car_expires_at,ambiente) VALUES('guard-race','quoted','00000000-0000-4000-8000-000000000099','{}','{}',now()+interval '10 minutes',now()+interval '10 minutes','sandbox');"
psql -v ON_ERROR_STOP=1 -c "BEGIN; SELECT public.service_begin_lalamove_dispatch('guard-race','00000000-0000-4000-8000-000000000099','MOTO','sandbox',false); SELECT pg_sleep(1); COMMIT;" > /tmp/lalamove-race-a.log &
pid_a=$!
sleep 0.15
psql -v ON_ERROR_STOP=1 -c "SELECT public.service_begin_lalamove_dispatch('guard-race','00000000-0000-4000-8000-000000000099','MOTO','sandbox',false);" > /tmp/lalamove-race-b.log
wait "$pid_a"
count="$(psql -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM feira_cost_private.lalamove_dispatches WHERE order_id='guard-race' AND state='creating';")"
[[ "$count" == "1" ]] || { echo "::error::Concorrência: esperado exatamente 1 reserva; encontrado $count"; exit 1; }
grep -q '"started": true' /tmp/lalamove-race-a.log
grep -q '"started": false' /tmp/lalamove-race-b.log
echo "PASSOU | duas chamadas simultâneas: exatamente uma reserva"
