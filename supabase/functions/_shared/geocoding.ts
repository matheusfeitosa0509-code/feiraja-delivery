export type DeliveryCoordinates = { lat: string; lng: string };
type GoogleGeocodeResult = {
  partial_match?: boolean;
  types?: string[];
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
  geometry?: { location?: { lat?: number; lng?: number } };
};

const MANAUS_BOUNDS = { south: -3.55, north: -2.45, west: -60.75, east: -59.15 };

function component(result: GoogleGeocodeResult, type: string) {
  return result.address_components?.find((item) => item.types.includes(type));
}

export function formatManausGeocodeQuery(address: string): string {
  const value = String(address || "").trim();
  if (!value) throw new Error("ADDRESS_NOT_FOUND");
  return /Manaus\s*[-,]/i.test(value) && /Amazonas|\bAM\b/i.test(value)
    ? value
    : value + ", Manaus - AM, Brasil";
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
      !types.some((type) => ["street_address", "premise", "subpremise", "route"].includes(type))) {
    throw new Error("ADDRESS_NOT_FOUND");
  }
  return { lat: String(lat), lng: String(lng) };
}

export async function geocodeManausAddress(
  address: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<DeliveryCoordinates> {
  if (!apiKey.trim()) throw new Error("GEOCODER_NOT_CONFIGURED");
  const query = formatManausGeocodeQuery(address);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:BR|administrative_area:AM");
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
  if (payload.status === "ZERO_RESULTS") throw new Error("ADDRESS_NOT_FOUND");
  if (payload.status !== "OK" || !Array.isArray(payload.results) || !payload.results.length) {
    const status = String(payload.status || "UNKNOWN");
    if (status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT" ||
        status === "OVER_DAILY_LIMIT" || status === "UNKNOWN_ERROR") {
      throw new Error("GEOCODER_UNAVAILABLE");
    }
    throw new Error("ADDRESS_NOT_FOUND");
  }
  let outsideManaus = false;
  for (const result of payload.results as GoogleGeocodeResult[]) {
    try {
      return validateManausGeocodeResult(result);
    } catch (error) {
      if (error instanceof Error && error.message === "ADDRESS_OUTSIDE_MANAUS") outsideManaus = true;
    }
  }
  throw new Error(outsideManaus ? "ADDRESS_OUTSIDE_MANAUS" : "ADDRESS_NOT_FOUND");
}
