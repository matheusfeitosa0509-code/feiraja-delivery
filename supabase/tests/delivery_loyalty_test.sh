#!/usr/bin/env bash
set -euo pipefail
export PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=delivery_loyalty_test
psql -v ON_ERROR_STOP=1 -f supabase/tests/delivery_loyalty_base.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261121140000_first_delivery_promo_server_a1.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261122145825_first_delivery_promo_ui_a2.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261122194500_cartao_fidelidade_entrega.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/delivery_loyalty_cases.sql
