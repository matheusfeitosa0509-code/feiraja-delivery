export type DeliveryCoordinates = { lat: string; lng: string };
export type ManausReverseGeocode = DeliveryCoordinates & { formattedAddress: string; street: string; number: string; neighborhood: string };
type GoogleGeocodeResult = {
  partial_match?: boolean;
  types?: string[];
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
  geometry?: { location?: { lat?: number; lng?: number } };
};

const MANAUS_BOUNDS = { south: -3.55, north: -2.45, west: -60.75, east: -59.15 };

export function validateManausCoordinates(latitude: unknown, longitude: unknown): DeliveryCoordinates {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < MANAUS_BOUNDS.south || lat > MANAUS_BOUNDS.north ||
      lng < MANAUS_BOUNDS.west || lng > MANAUS_BOUNDS.east) {
    throw new Error("ADDRESS_OUTSIDE_MANAUS");
  }
  // Seis casas decimais mantêm precisão submétrica e evitam ERR_INVALID_FIELD na Lalamove.
  return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
}

function component(result: GoogleGeocodeResult, type: string) {
  return result.address_components?.find((item) => item.types.includes(type));
}

export async function resolveDeliveryCoordinates(
  address: string,
  confirmedCoordinates: { lat: unknown; lng: unknown } | null | undefined,
  geocodeAddress: (value: string) => Promise<DeliveryCoordinates>,
): Promise<DeliveryCoordinates> {
  if (confirmedCoordinates) {
    return validateManausCoordinates(confirmedCoordinates.lat, confirmedCoordinates.lng);
  }
  return await geocodeAddress(address);
}

export function formatManausGeocodeQuery(address: string): string {
  const value = String(address || "").trim();
  if (!value) throw new Error("ADDRESS_NOT_FOUND");
  if (/Manaus\s*-\s*AM/i.test(value)) return /Brasil$/i.test(value) ? value : value + ", Brasil";
  return value + ", Manaus - AM, Brasil";
}

export function validateManausGeocodeResult(result: GoogleGeocodeResult): DeliveryCoordinates {
  const country = component(result, "country");
  const state = component(result, "administrative_area_level_1");
  const city = component(result, "locality") ||
    component(result, "administrative_area_level_2") ||
    component(result, "postal_town");
  const location = result.geometry?.location;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const validPoint = Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= MANAUS_BOUNDS.south && lat <= MANAUS_BOUNDS.north &&
    lng >= MANAUS_BOUNDS.west && lng <= MANAUS_BOUNDS.east;
  if (country?.short_name !== "BR" || state?.short_name !== "AM" ||
      !city?.long_name.toLocaleLowerCase("pt-BR").includes("manaus") || !validPoint) {
    throw new Error("ADDRESS_OUTSIDE_MANAUS");
  }
  const types = result.types || [];
  if (result.partial_match === true ||
      !types.some((type) => ["street_address", "premise", "subpremise"].includes(type))) {
    throw new Error("ADDRESS_NOT_FOUND");
  }
  return validateManausCoordinates(lat, lng);
}

export async function geocodeManausAddress(
  address: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  requireExactStreetNumber = false,
): Promise<DeliveryCoordinates> {
  if (!apiKey.trim()) throw new Error("GEOCODER_NOT_CONFIGURED");
  const query = formatManausGeocodeQuery(address);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:BR");
  url.searchParams.set("region", "br");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("key", apiKey);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("GEOCODER_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("GEOCODER_UNAVAILABLE");
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") throw new Error("GEOCODER_UNAVAILABLE");
  if (payload.status === "ZERO_RESULTS") { console.warn("google_geocoding", { stage: "forward", status: "ZERO_RESULTS", result_count: 0 }); throw new Error("ADDRESS_NOT_FOUND"); }
  if (payload.status !== "OK" || !Array.isArray(payload.results) || !payload.results.length) {
    const status = String(payload.status || "UNKNOWN");
    console.error("google_geocoding", { stage: "forward", status, result_count: Array.isArray(payload.results) ? payload.results.length : 0 });
    if (status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT" ||
        status === "OVER_DAILY_LIMIT" || status === "UNKNOWN_ERROR") {
      throw new Error("GEOCODER_UNAVAILABLE");
    }
    throw new Error("ADDRESS_NOT_FOUND");
  }
  console.info("google_geocoding", { stage: "forward", status: "OK", result_count: payload.results.length });
  let outsideManaus = false;
  for (const result of payload.results as GoogleGeocodeResult[]) {
    try {
      const coordinates = validateManausGeocodeResult(result);
      if (requireExactStreetNumber && (!component(result, "route") || !component(result, "street_number"))) continue;
      return coordinates;
    } catch (error) {
      if (error instanceof Error && error.message === "ADDRESS_OUTSIDE_MANAUS") outsideManaus = true;
    }
  }
  throw new Error(outsideManaus ? "ADDRESS_OUTSIDE_MANAUS" : "ADDRESS_NOT_FOUND");
}


export async function geocodeManausCoordinates(
  latitude: unknown,
  longitude: unknown,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ManausReverseGeocode> {
  if (!apiKey.trim()) throw new Error("GEOCODER_NOT_CONFIGURED");
  const lat = Number(latitude);
  const lng = Number(longitude);
  const validPoint = Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= MANAUS_BOUNDS.south && lat <= MANAUS_BOUNDS.north &&
    lng >= MANAUS_BOUNDS.west && lng <= MANAUS_BOUNDS.east;
  if (!validPoint) throw new Error("ADDRESS_OUTSIDE_MANAUS");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", lat + "," + lng);
  url.searchParams.set("result_type", "street_address|route|premise|neighborhood|sublocality");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("key", apiKey);
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error("GEOCODER_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("GEOCODER_UNAVAILABLE");
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") throw new Error("GEOCODER_UNAVAILABLE");
  const status = String(payload.status || "UNKNOWN");
  const results = Array.isArray(payload.results) ? payload.results as GoogleGeocodeResult[] : [];
  if (status !== "OK" || !results.length) {
    console.error("google_geocoding", { stage: "reverse", status, result_count: results.length });
    if (status === "ZERO_RESULTS") throw new Error("ADDRESS_NOT_FOUND");
    if (status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT" || status === "OVER_DAILY_LIMIT" || status === "UNKNOWN_ERROR") {
      throw new Error("GEOCODER_UNAVAILABLE");
    }
    throw new Error("ADDRESS_NOT_FOUND");
  }
  console.info("google_geocoding", { stage: "reverse", status: "OK", result_count: results.length });
  for (const result of results) {
    const country = component(result, "country");
    const state = component(result, "administrative_area_level_1");
    const city = component(result, "locality") || component(result, "administrative_area_level_2") || component(result, "postal_town");
    const point = result.geometry?.location;
    if (country?.short_name !== "BR" || state?.short_name !== "AM" ||
        !city?.long_name.toLocaleLowerCase("pt-BR").includes("manaus")) continue;
    const route = component(result, "route");
    const streetNumber = component(result, "street_number");
    const neighborhood = component(result, "neighborhood") || component(result, "sublocality_level_1") ||
      component(result, "sublocality") || component(result, "administrative_area_level_3");
    return {
      lat: String(lat), lng: String(lng),
      formattedAddress: String((result as any).formatted_address || ""),
      street: String(route?.long_name || (result as any).formatted_address || "Ponto marcado no mapa").slice(0, 160),
      number: String(streetNumber?.long_name || "").slice(0, 30),
      neighborhood: String(neighborhood?.long_name || city?.long_name || "").slice(0, 100),
    };
  }
  throw new Error("ADDRESS_OUTSIDE_MANAUS");
}
