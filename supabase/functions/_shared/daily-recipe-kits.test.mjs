import test from "node:test";
import assert from "node:assert/strict";
import { isDailyRecipeKitAvailable, areDailyRecipeKitItemsAvailable } from "./daily-recipe-kits.js";

const kit={weekday:1,is_active:true};
const at=iso=>new Date(iso);

test("Monday kit is available only between 06:00 and 12:59 Manaus",()=>{
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-23T10:00:00Z")),true);
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-23T09:59:00Z")),false);
 assert.equal(isDailyRecipeKitAvailable(kit,at("2026-11-23T17:00:00Z")),false);
});
test("kit weekday and active flag are enforced",()=>{
 assert.equal(isDailyRecipeKitAvailable({...kit,weekday:5},at("2026-11-23T10:00:00Z")),false);
 assert.equal(isDailyRecipeKitAvailable({...kit,is_active:false},at("2026-11-23T10:00:00Z")),false);
 assert.equal(isDailyRecipeKitAvailable({...kit,weekday:5},at("2026-11-27T10:00:00Z")),true);
});
test("a kit is hidden if any component is missing, inactive or invalid",()=>{
 const items=[{product_id:"a",quantity:1},{product_id:"b",quantity:.5}];
 assert.equal(areDailyRecipeKitItemsAvailable(items,[{id:"a",available:true},{id:"b",available:true}]),true);
 assert.equal(areDailyRecipeKitItemsAvailable(items,[{id:"a",available:true},{id:"b",available:false}]),false);
 assert.equal(areDailyRecipeKitItemsAvailable(items,[{id:"a",available:true}]),false);
 assert.equal(areDailyRecipeKitItemsAvailable([{product_id:"a",quantity:0}], [{id:"a",available:true}]),false);
});
