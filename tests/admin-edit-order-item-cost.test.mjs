import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync('painel.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20261119150000_admin_edit_order_item_cost.sql','utf8');
const rollback=fs.readFileSync('supabase/rollback/20261119150000_admin_edit_order_item_cost.sql','utf8');

assert.match(panel,/data-edit-order-cost/,'each order item exposes the admin cost editor');
assert.match(panel,/Custo pago hoje \(por unidade\/kg\)/,'editor labels the paid unit cost');
assert.match(panel,/id="orderCostUpdateProduct" type="checkbox" checked/,'product default update is checked by default');
assert.match(panel,/Atualizar também o custo padrão do produto/,'editor explains the product default option');
assert.match(panel,/amount>=0/,'cost parser accepts zero and rejects negative values');
assert.match(panel,/Atenção: custo maior que a venda, prejuízo neste item/,'loss warning is shown without blocking save');
assert.match(panel,/admin_update_order_item_cost/,'panel saves through the admin-only RPC');
assert.match(panel,/await loadOrderProfit\(\)/,'saving reloads item/order/day profit');
assert.match(panel,/shoppingCostEditButton/,'shopping list has an item cost editing entry point');
assert.match(panel,/shoppingCostProfitByOrder/,'shopping list loads protected snapshots before editing');

assert.match(migration,/CREATE TABLE feira_cost_private\.order_item_cost_history/,'cost changes are audited in the private schema');
assert.match(migration,/old_unit_cost[\s\S]*new_unit_cost[\s\S]*changed_at[\s\S]*changed_by/,'audit stores old/new value, timestamp and actor');
assert.match(migration,/SECURITY DEFINER/,'RPC runs with owner privileges');
assert.match(migration,/auth\.uid\(\) IS NULL OR NOT public\.is_current_user_admin\(\)/,'RPC rejects non-admin users');
assert.match(migration,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,'RPC is not executable by public or anon');
assert.match(migration,/GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated/,'authenticated panel can call guarded RPC');
assert.match(migration,/UPDATE feira_cost_private\.order_item_snapshots[\s\S]*cost_total[\s\S]*profit/,'snapshot item cost and profit are recalculated');
assert.match(migration,/product_default_updated/,'audit records whether the product default was updated');
assert.match(rollback,/DROP FUNCTION IF EXISTS public\.admin_update_order_item_cost/,'rollback removes the RPC');
assert.match(rollback,/DROP TABLE IF EXISTS feira_cost_private\.order_item_cost_history/,'rollback removes the audit table');

console.log('Admin item cost editor: panel, shopping list, profit recalculation, audit and RPC security OK.');
