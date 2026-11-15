import { assertEquals } from "jsr:@std/assert@1.0.14";
import { isTerminalTrackingStatus, normalizeTrackingCoordinates, publicDriverDetails, safeTrackingPhoto } from "../_shared/lalamove-tracking.ts";

Deno.test("posição do motorista valida latitude e longitude", () => {
  assertEquals(normalizeTrackingCoordinates({ lat: "-3.12", lng: "-60.02", updatedAt: "2026-11-15T12:00:00Z" }), {
    lat: -3.12, lng: -60.02, updatedAt: "2026-11-15T12:00:00Z",
  });
  assertEquals(normalizeTrackingCoordinates({ lat: 120, lng: -60 }), null);
  assertEquals(normalizeTrackingCoordinates({ lat: -3, lng: "NaN" }), null);
});

Deno.test("dados públicos do motorista não incluem telefone nem IDs privados", () => {
  assertEquals(publicDriverDetails({
    driverId: "private-driver-id", name: "João", phone: "+5511999999999", plateNumber: "**ABC*",
    photo: "https://cdn.example.test/driver.jpg", coordinates: { lat: -3.1, lng: -60.1 },
  }), {
    name: "João", plateNumber: "**ABC*", photo: "https://cdn.example.test/driver.jpg",
    coordinates: { lat: -3.1, lng: -60.1 },
  });
  assertEquals(safeTrackingPhoto("javascript:alert(1)"), "");
});

Deno.test("rastreio para em estados terminais distintos", () => {
  assertEquals(isTerminalTrackingStatus("delivered"), true);
  assertEquals(isTerminalTrackingStatus("cancelled"), true);
  assertEquals(isTerminalTrackingStatus("expired"), true);
  assertEquals(isTerminalTrackingStatus("assigned"), false);
});
