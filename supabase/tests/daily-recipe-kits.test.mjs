import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getDailyRecipeKitWindowStatus, isDailyRecipeKitAvailable } from "../functions/_shared/daily-recipe-kits.js";
import { isStoreBannerScheduleActive } from "../functions/_shared/store-banner-schedule.js";
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
test("advance-sale window uses Manaus time, includes Monday from Saturday 13h and ends at 13h",()=>{
 const friday={weekday:5,is_active:true,name:"Kit de Sexta"};
 const monday={weekday:1,is_active:true,name:"Kit de Segunda"};
 const at=(iso)=>new Date(iso);
 assert.equal(isDailyRecipeKitAvailable(friday,at("2026-11-26T16:59:00Z")),false); // Thu 12:59
 assert.equal(isDailyRecipeKitAvailable(friday,at("2026-11-26T17:01:00Z")),true);  // Thu 13:01
 assert.match(getDailyRecipeKitWindowStatus(friday,at("2026-11-26T17:01:00Z")).label,/^Amanhã: Kit de Sexta/);
 assert.equal(isDailyRecipeKitAvailable(friday,at("2026-11-27T11:00:00Z")),true);  // Fri 07:00
 assert.match(getDailyRecipeKitWindowStatus(friday,at("2026-11-27T11:00:00Z")).label,/^Hoje: Kit de Sexta/);
 assert.equal(isDailyRecipeKitAvailable(friday,at("2026-11-27T17:01:00Z")),false); // Fri 13:01
 assert.equal(isDailyRecipeKitAvailable(monday,at("2026-11-28T18:00:00Z")),true); // Sat 14:00
 assert.match(getDailyRecipeKitWindowStatus(monday,at("2026-11-28T18:00:00Z")).label,/segunda cedo/i);
 assert.equal(isDailyRecipeKitAvailable(monday,at("2026-11-29T16:00:00Z")),true); // Sunday
 assert.equal(isDailyRecipeKitAvailable(monday,at("2026-11-30T16:59:00Z")),true); // Mon 12:59
 assert.equal(isDailyRecipeKitAvailable(monday,at("2026-11-30T17:01:00Z")),false); // Mon 13:01
});
test("kit banners share the same advance-sale window and keep other banner schedules unchanged",()=>{
 const banner={action_type:"kit",weekdays:[5],start_time:"06:00:00",end_time:"13:00:00"};
 assert.equal(isStoreBannerScheduleActive(banner,new Date("2026-11-26T16:59:00Z")),false);
 assert.equal(isStoreBannerScheduleActive(banner,new Date("2026-11-26T17:01:00Z")),true);
 assert.equal(isStoreBannerScheduleActive(banner,new Date("2026-11-27T17:01:00Z")),false);
 const ordinary={action_type:"products",weekdays:[4],start_time:"06:00:00",end_time:"13:00:00"};
 assert.equal(isStoreBannerScheduleActive(ordinary,new Date("2026-11-26T16:59:00Z")),true);
 assert.equal(isStoreBannerScheduleActive(ordinary,new Date("2026-11-26T17:01:00Z")),false);
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

test("storefront hides kits outside the Manaus window, prioritizes the kit category and removes stale cart kits",()=>{
 const store=fs.readFileSync("loja.html","utf8");
 assert.match(store,/dailyKitWindowStatus/);
 assert.match(store,/category:'Kits do dia 🧺'/);
 assert.match(store,/getStorefrontCategories\(\)/);
 assert.match(store,/cartKitRemovedWarning/);
 assert.match(store,/startDailyKitWindowMonitor/);
 assert.match(store,/kit_schedule_label/);
 assert.match(store,/dailyKitBannerLabel/);
 assert.match(store,/kit_id:x\.p\.kit_id/);
});
test("admin kit editor exposes name, description, photo URL, items, fixed price, weekday and activation",()=>{
 const panel=fs.readFileSync("painel.html","utf8");
 assert.match(panel,/dailyRecipeKitsManager/);
 assert.match(panel,/Foto \(URL opcional\)/);
 assert.match(panel,/Preço fixo \(R\$\)/);
 assert.match(panel,/Dia da semana/);
 assert.match(panel,/Itens do kit/);
 assert.match(panel,/Soma dos itens:/);
 assert.match(panel,/Desconto do kit:/);
});
test("customer order and panel separation render the kit composition",()=>{
 const store=fs.readFileSync("loja.html","utf8");
 const panel=fs.readFileSync("painel.html","utf8");
 assert.match(store,/formatOrderKitComponentsMarkup/);
 assert.match(panel,/formatOrderKitComponentsMarkup/);
 assert.match(panel,/kit_name:item\.name/);
 const worker=fs.readFileSync("supabase/functions/super-worker/index.ts","utf8");
 assert.match(worker,/buildMarketChecklistItems/);
});
