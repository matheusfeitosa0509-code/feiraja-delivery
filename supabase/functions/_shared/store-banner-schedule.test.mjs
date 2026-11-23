import test from "node:test";
import assert from "node:assert/strict";
import { isStoreBannerScheduleActive } from "./store-banner-schedule.js";

test("legacy banner without schedule fields remains visible any day and hour", () => {
  assert.equal(isStoreBannerScheduleActive({}, new Date("2026-11-29T03:00:00Z")), true);
  assert.equal(isStoreBannerScheduleActive({ weekdays: null, start_time: null, end_time: null }, new Date("2026-11-29T03:00:00Z")), true);
});

test("weekday schedule uses America/Manaus and excludes other days", () => {
  const banner = { weekdays: [1], start_time: "06:00:00", end_time: "13:00:00" };
  assert.equal(isStoreBannerScheduleActive(banner, new Date("2026-11-30T10:00:00Z")), true); // Mon 06:00
  assert.equal(isStoreBannerScheduleActive(banner, new Date("2026-12-01T10:00:00Z")), false); // Tue 06:00
});

test("time window is inclusive at start and exclusive at end", () => {
  const banner = { weekdays: [1], start_time: "06:00:00", end_time: "13:00:00" };
  assert.equal(isStoreBannerScheduleActive(banner, new Date("2026-11-30T09:59:00Z")), false); // 05:59
  assert.equal(isStoreBannerScheduleActive(banner, new Date("2026-11-30T10:00:00Z")), true); // 06:00
  assert.equal(isStoreBannerScheduleActive(banner, new Date("2026-11-30T16:59:00Z")), true); // 12:59
  assert.equal(isStoreBannerScheduleActive(banner, new Date("2026-11-30T17:00:00Z")), false); // 13:00
});

test("invalid or incomplete schedules fail closed", () => {
  assert.equal(isStoreBannerScheduleActive({ weekdays: [], start_time: null, end_time: null }, new Date("2026-11-30T10:00:00Z")), false);
  assert.equal(isStoreBannerScheduleActive({ start_time: "06:00", end_time: null }, new Date("2026-11-30T10:00:00Z")), false);
  assert.equal(isStoreBannerScheduleActive({ start_time: "13:00", end_time: "06:00" }, new Date("2026-11-30T10:00:00Z")), false);
});
