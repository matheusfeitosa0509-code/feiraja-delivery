#!/usr/bin/env bash
set -euo pipefail
MIG="supabase/migrations/20261110020000_ordem_191_pickup_only.sql"
SCHEMA="supabase/tests/minimal_schema.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for n in 1 2 3 4; do
  DB="pickup_fail_$n"
  dropdb --if-exists "$DB" >/dev/null
  createdb "$DB"
  export PGDATABASE="$DB"
  psql -v ON_ERROR_STOP=1 -f "$SCHEMA" >"$TMP/schema_$n.log" 2>&1
  BEFORE="$(psql -Atqc "select md5(pg_get_functiondef('public.create_order_with_rate_limit(jsonb)'::regprocedure)) || ':' || md5(pg_get_functiondef('public.push_orders_notify()'::regprocedure))")"
  python3 - "$MIG" "$TMP/migration_$n.sql" "$n" <<'PY'
import pathlib,re,sys
src=pathlib.Path(sys.argv[1]).read_text()
dst=pathlib.Path(sys.argv[2]); n=int(sys.argv[3])
patterns={
1:r"v_old := '    delivery_type,' \|\| chr\(10\) \|\| '    payment_method,';",
2:r"v_old := '    p_order->>''delivery_type'',' \|\| chr\(10\) \|\|\s*'    p_order->>''payment_method'',';",
3:r"v_old := '''Dinheiro na entrega''';",
4:r"v_old := '''Cartão na entrega''';",
}
pat=patterns[n]
new="v_old := 'TRECHO_PROPOSITALMENTE_AUSENTE';"
out,count=re.subn(pat,new,src,count=1)
if count!=1: raise SystemExit(f'Não foi possível preparar falha {n}/4; padrão encontrado={count}')
dst.write_text(out)
PY
  set +e
  psql -v ON_ERROR_STOP=1 -f "$TMP/migration_$n.sql" >"$TMP/run_$n.log" 2>&1
  RC=$?
  set -e
  if [ "$RC" -eq 0 ]; then cat "$TMP/run_$n.log"; echo "FAIL: migration não falhou no replace $n/4"; exit 1; fi
  if ! grep -Fq "Falha no replace $n/4" "$TMP/run_$n.log"; then cat "$TMP/run_$n.log"; echo "FAIL: mensagem incorreta no replace $n/4"; exit 1; fi
  psql -v ON_ERROR_STOP=1 -Atqc "DO \$\$ BEGIN IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='pickup_code') THEN RAISE EXCEPTION 'coluna sobreviveu'; END IF; IF EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_pickup_code_format_check') THEN RAISE EXCEPTION 'constraint sobreviveu'; END IF; END \$\$;" >"$TMP/rollback_$n.log" 2>&1
  AFTER="$(psql -Atqc "select md5(pg_get_functiondef('public.create_order_with_rate_limit(jsonb)'::regprocedure)) || ':' || md5(pg_get_functiondef('public.push_orders_notify()'::regprocedure))")"
  if [ "$BEFORE" != "$AFTER" ]; then echo "FAIL: funções alteradas após rollback $n/4"; exit 1; fi
  echo "PASS replace $n/4: falhou com mensagem esperada; coluna/constraint ausentes; funções originais preservadas"
  grep -F "Falha no replace $n/4" "$TMP/run_$n.log" | tail -1
  echo "PASS rollback $n/4: sem coluna/constraint e hashes das duas funções iguais"
  dropdb "$DB"
done
