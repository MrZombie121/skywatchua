const GEO_ENABLED = (process.env.GEOCODER_ENABLED || "true").toLowerCase() !== "false";
const GEO_PROVIDER = String(process.env.GEOCODER_PROVIDER || "hybrid").toLowerCase();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const cache = new Map();

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.,;:()\[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inUkraineBounds(lat, lng) {
  return lat >= 43 && lat <= 53 && lng >= 21 && lng <= 41;
}

function cleanupCandidate(raw) {
  const stopWords = [
    "район",
    "область",
    "обл",
    "курс",
    "напрямок",
    "направление",
    "летить",
    "летят",
    "рухається",
    "движется",
    "шахед",
    "бпла",
    "дрон",
    "ракета",
    "каб"
  ];

  let value = String(raw || "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return "";
  const words = value.split(" ").filter(Boolean);
  const filtered = words.filter((word) => !stopWords.includes(word.toLowerCase()));
  return filtered.slice(0, 3).join(" ").trim();
}

function extractPlaceCandidates(text) {
  const lower = normalizeText(text);
  const matches = [];
  const patterns = [
    /(?:в|у|над|біля|поблизу|через|до|на|в районі|в районе|в р-ні|в р-не)\s+([a-zа-яіїє' -]{3,40})/giu,
    /(?:район|область|обл\.?|місто|город)\s+([a-zа-яіїє' -]{3,40})/giu
  ];

  patterns.forEach((pattern) => {
    let hit = pattern.exec(lower);
    while (hit) {
      const cleaned = cleanupCandidate(hit[1]);
      if (cleaned.length >= 3) matches.push(cleaned);
      hit = pattern.exec(lower);
    }
  });

  const seen = new Set();
  return matches.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  }).slice(0, 4);
}

async function geocodeWithNominatim(query) {
  const cacheKey = `osm:${query.toLowerCase()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${query}, Ukraine`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ua");
  url.searchParams.set("accept-language", "uk");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "SkywatchUA/1.4.1 (osm geocoder)"
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!inUkraineBounds(lat, lng)) return null;
    const out = { lat, lng, label: first.display_name || query, provider: "osm" };
    cache.set(cacheKey, out);
    return out;
  } catch {
    return null;
  }
}

function tryParseGeminiJson(text) {
  const direct = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  if (direct && typeof direct === "object") return direct;

  const codeFence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFence?.[1]) {
    try {
      return JSON.parse(codeFence[1]);
    } catch {
      return null;
    }
  }

  const jsonLike = String(text).match(/\{[\s\S]*\}/);
  if (jsonLike?.[0]) {
    try {
      return JSON.parse(jsonLike[0]);
    } catch {
      return null;
    }
  }

  return null;
}

async function geocodeWithGemini(messageText) {
  if (!GEMINI_API_KEY) return null;

  const cacheKey = `gemini:${normalizeText(messageText)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const prompt = [
    "You extract one target location in Ukraine from alert text.",
    "Return JSON only with fields: found(boolean), location(string), lat(number), lng(number), confidence(number 0..1).",
    "If location is unknown return: {\"found\":false}.",
    "Coordinates must be in Ukraine bounds (lat 43..53, lng 21..41).",
    "Input text:",
    String(messageText || "")
  ].join("\n");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 180
        }
      })
    });

    if (!response.ok) return null;
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
    const parsed = tryParseGeminiJson(text);
    if (!parsed || parsed.found !== true) return null;

    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!inUkraineBounds(lat, lng)) return null;

    const confidence = Number(parsed.confidence);
    if (Number.isFinite(confidence) && confidence < 0.55) return null;

    const out = {
      lat,
      lng,
      label: String(parsed.location || "Gemini location"),
      provider: "gemini"
    };
    cache.set(cacheKey, out);
    return out;
  } catch {
    return null;
  }
}

async function resolveByOsm(text) {
  const candidates = extractPlaceCandidates(text);
  for (const candidate of candidates) {
    const point = await geocodeWithNominatim(candidate);
    if (point) return point;
  }
  return null;
}

export async function resolvePointFromMessage(text) {
  if (!GEO_ENABLED) return null;

  if (GEO_PROVIDER === "osm") {
    return resolveByOsm(text);
  }

  if (GEO_PROVIDER === "gemini") {
    return geocodeWithGemini(text);
  }

  const osmPoint = await resolveByOsm(text);
  if (osmPoint) return osmPoint;
  return geocodeWithGemini(text);
}
