import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { geocodeManausAddress, geocodeManausCoordinates } from "../_shared/geocoding.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const BOUNDS = { south: -3.55, north: -2.45, west: -60.75, east: -59.15 };
const rateWindows = new Map<string, { startedAt: number; count: number }>();
function allowAddressRequest(userId: string) {
  const now = Date.now();
  const current = rateWindows.get(userId);
  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 30;
}
const safeSessionToken = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function component(components: any[], type: string) {
  return components.find((item) => Array.isArray(item.types) && item.types.includes(type));
}
function isManausPoint(location: any) {
  const lat = Number(location?.latitude), lng = Number(location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;
}
function addressFromPlace(place: any) {
  const components = Array.isArray(place?.addressComponents) ? place.addressComponents : [];
  const country = component(components, "country");
  const state = component(components, "administrative_area_level_1");
  const city = component(components, "locality") || component(components, "administrative_area_level_2");
  if (country?.shortText !== "BR" || state?.shortText !== "AM" ||
      (city && !String(city.longText || "").toLocaleLowerCase("pt-BR").includes("manaus")) ||
      !isManausPoint(place?.location)) throw new Error("ADDRESS_OUTSIDE_MANAUS");
  const route = component(components, "route");
  const number = component(components, "street_number");
  const neighborhood = component(components, "neighborhood") ||
    component(components, "sublocality_level_1") || component(components, "sublocality") ||
    component(components, "administrative_area_level_3");
  return {
    place_id: String(place.id || ""),
    formatted_address: String(place.formattedAddress || ""),
    street: String(route?.longText || place.formattedAddress || "").slice(0, 160),
    reference: String(place.displayName?.text || "").slice(0, 160),
    number: String(number?.longText || "").slice(0, 30),
    neighborhood: String(neighborhood?.longText || city?.longText || "").slice(0, 100),
    lat: String(place.location.latitude),
    lng: String(place.location.longitude),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) return json({ error: "Configuração interna incompleta." }, 500);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Sessão necessária." }, 401);
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData?.user || authData.user.is_anonymous) return json({ error: "Sessão válida necessária." }, 401);

    if (!allowAddressRequest(authData.user.id)) return json({ error: "Muitas consultas de endereço. Aguarde um minuto." }, 429);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Requisição inválida." }, 400);
    const action = String(body.action || "");
    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || Deno.env.get("GOOGLE_GEOCODING_API_KEY") || "";
    if (!apiKey.trim()) return json({ error: "Serviço de endereços não configurado.", code: "GOOGLE_PLACES_NOT_CONFIGURED" }, 503);

    if (action === "autocomplete") {
      const input = String(body.input || "").trim();
      const sessionToken = body.session_token;
      if (input.length < 3 || input.length > 120 || !safeSessionToken(sessionToken)) {
        return json({ error: "Consulta de endereço inválida." }, 400);
      }
      const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat" },
        body: JSON.stringify({
          input, sessionToken, includedRegionCodes: ["br"], languageCode: "pt-BR", regionCode: "BR",
          locationBias: { circle: { center: { latitude: -3.1190, longitude: -60.0217 }, radius: 30000 } },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("google_places", { stage: "autocomplete", http_status: response.status });
        return json({ error: "Não foi possível sugerir endereços agora.", code: "PLACES_UNAVAILABLE" }, 503);
      }
      const suggestions = (Array.isArray(payload.suggestions) ? payload.suggestions : [])
        .map((item: any) => item?.placePrediction)
        .filter((item: any) => item?.placeId && item?.text?.text)
        .slice(0, 6)
        .map((item: any) => ({
          place_id: String(item.placeId),
          description: String(item.text.text).slice(0, 220),
          main_text: String(item.structuredFormat?.mainText?.text || item.text.text).slice(0, 160),
          secondary_text: String(item.structuredFormat?.secondaryText?.text || "").slice(0, 120),
        }));
      return json({ suggestions });
    }

    if (action === "details") {
      const placeId = String(body.place_id || "");
      const sessionToken = body.session_token;
      if (!/^[A-Za-z0-9_-]{8,200}$/.test(placeId) || !safeSessionToken(sessionToken)) {
        return json({ error: "Seleção de endereço inválida." }, 400);
      }
      const url = new URL("https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId));
      url.searchParams.set("sessionToken", sessionToken);
      const response = await fetch(url, {
        method: "GET",
        headers: { "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents,types" },
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("google_places", { stage: "details", http_status: response.status });
        return json({ error: "Não foi possível carregar o endereço selecionado.", code: "PLACES_UNAVAILABLE" }, 503);
      }
      try {
        return json({ address: addressFromPlace(payload) });
      } catch (error) {
        const code = error instanceof Error ? error.message : "ADDRESS_NOT_FOUND";
        return json({ error: code === "ADDRESS_OUTSIDE_MANAUS"
          ? "Selecione um endereço dentro de Manaus - AM." : "O Google não retornou rua e bairro suficientes.", code }, 422);
      }
    }

    if (action === "geocode") {
      const address = String(body.address || "").trim();
      if (address.length < 12 || address.length > 400 || !/\\d/.test(address)) {
        return json({ error: "Informe rua e número para localizar o endereço.", code: "ADDRESS_NOT_FOUND" }, 400);
      }
      const coordinates = await geocodeManausAddress(address, Deno.env.get("GOOGLE_GEOCODING_API_KEY") || apiKey);
      return json({ coordinates, precision: "street_address" });
    }

    if (action === "reverse") {
      const address = await geocodeManausCoordinates(body.lat, body.lng,
        Deno.env.get("GOOGLE_GEOCODING_API_KEY") || apiKey);
      return json({ address });
    }
    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "ADDRESS_OUTSIDE_MANAUS") return json({ error: "Este ponto fica fora de Manaus - AM.", code }, 422);
    if (code === "ADDRESS_NOT_FOUND") return json({ error: "Não foi possível identificar o endereço neste ponto.", code }, 422);
    if (code === "GEOCODER_NOT_CONFIGURED") return json({ error: "Geocodificação não configurada.", code }, 503);
    if (code === "GEOCODER_UNAVAILABLE") return json({ error: "Não foi possível localizar este ponto agora.", code }, 503);
    console.error("delivery-address", { stage: "request", code });
    return json({ error: "Erro interno ao consultar o endereço." }, 500);
  }
});
