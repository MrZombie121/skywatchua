import { parseMessageToEvent } from "./transform.js";

const urls = (process.env.OPEN_JSON_FEEDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function normalizeEvent(item, sourceFallback) {
  const lat = Number(item.lat ?? item.latitude ?? item.location?.lat);
  const lng = Number(item.lng ?? item.longitude ?? item.location?.lng);
  const timestamp = item.timestamp || item.time || item.date || Date.now();
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      id:
        item.id ||
        `${sourceFallback}-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      type: item.type || item.target_type || "other",
      lat,
      lng,
      direction: Number(item.direction ?? item.heading ?? 0),
      source: item.source || sourceFallback,
      timestamp: new Date(timestamp).toISOString(),
      comment: item.comment || item.note || "",
      is_test: Boolean(item.is_test ?? item.isTest ?? false),
      raw_text: item.raw_text || item.text || ""
    };
  }

  const text = item.text || item.title || item.message || "";
  if (!text) return null;
  return parseMessageToEvent(text, {
    source: item.source || sourceFallback,
    timestamp,
    raw_text: text
  });
}

export async function loadOpenEvents() {
  if (urls.length === 0) return [];

  const events = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const items = Array.isArray(payload)
        ? payload
        : payload.events || payload.items || payload.data || [];
      for (const item of items) {
        const event = normalizeEvent(item, url);
        if (event) events.push(event);
      }
    } catch (error) {
      console.warn("Failed to load open feed", url, error?.message || error);
    }
  }

  return events;
}
