import Parser from "rss-parser";
import { parseMessageToEvents } from "./transform.js";

const parser = new Parser();
const urls = (process.env.RSS_URLS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

export async function loadRssEvents() {
  if (urls.length === 0) return [];

  const events = [];
  for (const url of urls) {
    try {
      const feed = await parser.parseURL(url);
      const sourceId = feed.title || url;
      for (const item of feed.items || []) {
        const text = [item.title, item.contentSnippet, item.content]
          .filter(Boolean)
          .join(" ");
        const eventsFromMsg = parseMessageToEvents(text, {
          source: sourceId,
          timestamp: item.isoDate ? Date.parse(item.isoDate) : Date.now()
        });
        if (eventsFromMsg.length) events.push(...eventsFromMsg);
      }
    } catch (error) {
      console.warn("Failed to parse RSS", url, error?.message || error);
    }
  }

  return events;
}
