import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const migration=fs.readFileSync("supabase/migrations/20261123193000_daily_recipe_kits.sql","utf8");
test("all six kits are seeded inactive on their requested weekdays and fixed prices",()=>{
 for(const row of [
  /\('kit-suco-semana','Kit Suco da Semana',[\s\S]*?52\.99,1,false/,
  /\('kit-salada-fresca','Kit Salada Fresca',[\s\S]*?53\.99,2,false/,
  /\('kit-farinhas-tapioca','Kit Farinhas e Tapioca',[\s\S]*?63\.99,3,false/,
  /\('kit-legumes-refogados','Kit Legumes Refogados',[\s\S]*?53\.99,4,false/,
  /\('kit-salada-frutas','Kit Salada de Frutas',[\s\S]*?61\.99,5,false/,
  /\('kit-camarao-alho-oleo','Kit Camarão Alho e Óleo',[\s\S]*?64\.99,6,false/
 ])assert.match(migration,row);
});
test("kit items are relational, ordered and reference real products",()=>{
 assert.match(migration,/product_id text NOT NULL REFERENCES public\.products\(id\)/);
 assert.match(migration,/UNIQUE \(kit_id, product_id\)/);
 assert.match(migration,/ON CONFLICT \(kit_id,product_id\) DO NOTHING/);
 const itemRows=(migration.match(/\('kit-[^']+','[^']+',\d+\.\d{3},\d+\)/g)||[]).length;
 assert.equal(itemRows,39);
});
test("RLS permits public reads only for active kits and protects admin writes",()=>{
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/daily_recipe_kits_public_active_read[\s\S]*?USING \(is_active = true\)/);
 assert.match(migration,/public\.is_current_user_admin\(\)/);
 assert.match(migration,/daily_recipe_kit_items_public_active_read[\s\S]*?k\.is_active = true/);
});
test("server enforces kit window, component stock and fixed kit pricing",()=>{
 const worker=fs.readFileSync("supabase/functions/super-worker/index.ts","utf8");
 assert.match(worker,/isDailyRecipeKitAvailable/);
 assert.match(worker,/areDailyRecipeKitItemsAvailable/);
 assert.match(worker,/saleMode === "kit"/);
 assert.match(worker,/is_kit: true/);
});
