const GEO_ENABLED = (process.env.GEOCODER_ENABLED || "true").toLowerCase() !== "false";
const cache = new Map();

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.,;:()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    /(?:район|область|обл\.?)\s+([a-zа-яіїє' -]{3,40})/giu
  ];

  patterns.forEach((pattern) => {
    let hit = pattern.exec(lower);
    while (hit) {
      const cleaned = cleanupCandidate(hit[1]);
      if (cleaned.length >= 3) matches.push(cleaned);
      hit = pattern.exec(lower);
    }
  });

  const unique = [];
  const seen = new Set();
  matches.forEach((item) => {
    if (seen.has(item)) return;
    seen.add(item);
    unique.push(item);
  });
  return unique.slice(0, 4);
}

async function geocodeWithNominatim(query) {
  const cacheKey = query.toLowerCase();
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
        "User-Agent": "SkywatchUA/1.4.1 (geocoder fallback)"
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const out = { lat, lng, label: first.display_name || query };
    cache.set(cacheKey, out);
    return out;
  } catch {
    return null;
  }
}

export async function resolvePointFromMessage(text) {
  if (!GEO_ENABLED) return null;
  const candidates = extractPlaceCandidates(text);
  for (const candidate of candidates) {
    const point = await geocodeWithNominatim(candidate);
    if (point) return point;
  }
  return null;
}

