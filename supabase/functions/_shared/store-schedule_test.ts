import { assertEquals } from "jsr:@std/assert@1.0.14";
import { getStoreSchedule } from "./store-schedule.js";

Deno.test("segunda à noite agenda terça às 6h em Manaus", () => {
  assertEquals(getStoreSchedule(new Date("2026-11-16T22:00:00.000Z")), {
    within: false, label: "terça, 17/11", scheduledFor: "2026-11-17T10:00:00.000Z",
  });
});
Deno.test("sábado às 14h agenda segunda às 6h", () => {
  assertEquals(getStoreSchedule(new Date("2026-11-14T18:00:00.000Z")), {
    within: false, label: "segunda, 16/11", scheduledFor: "2026-11-16T10:00:00.000Z",
  });
});
Deno.test("domingo agenda segunda às 6h", () => {
  assertEquals(getStoreSchedule(new Date("2026-11-15T12:00:00.000Z")), {
    within: false, label: "segunda, 16/11", scheduledFor: "2026-11-16T10:00:00.000Z",
  });
});
Deno.test("durante o horário não agenda", () => {
  assertEquals(getStoreSchedule(new Date("2026-11-16T14:00:00.000Z")), {
    within: true, label: "hoje", scheduledFor: null,
  });
});
