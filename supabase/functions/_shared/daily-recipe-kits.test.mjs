import test from "node:test";
import assert from "node:assert/strict";
import { isDailyRecipeKitAvailable, areDailyRecipeKitItemsAvailable } from "./daily-recipe-kits.js";

const kit={weekday:1,is_active:true};
const at=iso=>new Date(iso);

test("Monday kit window starts Saturday at 13:00, includes Sunday and ends Monday at 13:00 Manaus",()=>{
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-28T16:59:00Z")),false); // Sat 12:59
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-28T17:01:00Z")),true);  // Sat 13:01
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-29T09:00:00Z")),true);  // Sun 05:00
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-30T09:59:00Z")),true);  // Mon 05:59
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-30T10:00:00Z")),true);  // Mon 06:00
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-30T16:59:00Z")),true);  // Mon 12:59
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-30T17:00:00Z")),false); // Mon 13:00
});
test("kit weekday and active flag are enforced",()=>{
 assert.equal(isDailyRecipeKitAvailable({...kit,weekday:5},at("2026-11-23T10:00:00Z")),false);
 assert.equal(isDailyRecipeKitAvailable({...kit,is_active:false},at("2026-11-30T10:00:00Z")),false);
 assert.equal(isDailyRecipeKitAvailable({...kit,weekday:5},at("2026-11-27T10:00:00Z")),true);
});
test("a kit is hidden if any component is missing, inactive or invalid",()=>{
 const items=[{product_id:"a",quantity:1},{product_id:"b",quantity:.5}];
 assert.equal(areDailyRecipeKitItemsAvailable(items,[{id:"a",available:true},{id:"b",available:true}]),true);
 assert.equal(areDailyRecipeKitItemsAvailable(items,[{id:"a",available:true},{id:"b",available:false}]),false);
 assert.equal(areDailyRecipeKitItemsAvailable(items,[{id:"a",available:true}]),false);
 assert.equal(areDailyRecipeKitItemsAvailable([{product_id:"a",quantity:0}], [{id:"a",available:true}]),false);
});
