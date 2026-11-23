import test from "node:test";
import assert from "node:assert/strict";
import { getManausDayHour, getActiveDailyCategoryDiscount, calculateDailyDiscountedPriceCents, calculateBestUnitPriceCents } from "./daily-category-discounts.js";
const rule={weekday:1,category:"Frutas",percent:10,is_active:true,excluded_product_ids:["banana"]};
const at=iso=>new Date(iso);
test("Monday discount starts at 06:00 Manaus",()=>{assert.deepEqual(getManausDayHour(at("2026-11-23T10:00:00Z")),{weekday:1,hour:6});assert.equal(getActiveDailyCategoryDiscount([rule],"Frutas","maca",at("2026-11-23T10:00:00Z")),10);assert.equal(getActiveDailyCategoryDiscount([rule],"Frutas","maca",at("2026-11-23T09:59:00Z")),null);});
test("discount stops exactly at 13:00 and never runs Sunday",()=>{assert.equal(getActiveDailyCategoryDiscount([rule],"Frutas","maca",at("2026-11-23T17:00:00Z")),null);assert.equal(getActiveDailyCategoryDiscount([rule],"Frutas","maca",at("2026-11-22T10:00:00Z")),null);});
test("inactive, wrong-category and excluded products are ignored",()=>{assert.equal(getActiveDailyCategoryDiscount([{...rule,is_active:false}],"Frutas","maca",at("2026-11-23T10:00:00Z")),null);assert.equal(getActiveDailyCategoryDiscount([rule],"Verduras e legumes","maca",at("2026-11-23T10:00:00Z")),null);assert.equal(getActiveDailyCategoryDiscount([rule],"Frutas","banana",at("2026-11-23T10:00:00Z")),null);});
test("daily discount never stacks over a lower old_price promotion",()=>{assert.equal(calculateDailyDiscountedPriceCents(800,1000,10),800);assert.equal(calculateDailyDiscountedPriceCents(1000,null,10),900);assert.equal(calculateDailyDiscountedPriceCents(1000,1200,10),1000);});

test("resale competes with the category discount instead of stacking",()=>{
 assert.equal(calculateBestUnitPriceCents(1000,null,10,850),850);
 assert.equal(calculateBestUnitPriceCents(1000,null,10,950),900);
 assert.equal(calculateBestUnitPriceCents(800,1000,10,750),750);
});
