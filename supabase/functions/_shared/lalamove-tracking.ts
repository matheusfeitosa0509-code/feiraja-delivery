export type TrackingStatus = "searching" | "assigned" | "enroute_pickup" | "picked_up" | "delivered" | "cancelled" | "rejected" | "expired";

export function isTerminalTrackingStatus(status: unknown): boolean {
  return ["delivered", "cancelled", "rejected", "expired"].includes(String(status || "").toLowerCase());
}

export function normalizeTrackingCoordinates(value: any): { lat: number; lng: number; updatedAt?: string } | null {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const updatedAt = String(value?.updatedAt || "");
  return { lat, lng, ...(updatedAt && Number.isFinite(Date.parse(updatedAt)) ? { updatedAt } : {}) };
}

export function safeTrackingPhoto(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href.slice(0, 1000) : "";
  } catch {
    return "";
  }
}

export function publicDriverDetails(value: any) {
  if (!value || typeof value !== "object") return null;
  const name = String(value.name || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 100);
  const plateNumber = String(value.plateNumber || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 20);
  const coordinates = normalizeTrackingCoordinates(value.coordinates);
  const photo = safeTrackingPhoto(value.photo);
  return {
    ...(name ? { name } : {}),
    ...(plateNumber ? { plateNumber } : {}),
    ...(photo ? { photo } : {}),
    ...(coordinates ? { coordinates } : {}),
  };
}
