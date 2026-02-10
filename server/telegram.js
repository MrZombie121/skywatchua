import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { parseMessageToEvents, extractAlarmSignals } from "./transform.js";

const apiId = process.env.TG_API_ID ? Number(process.env.TG_API_ID) : null;
const apiHash = process.env.TG_API_HASH || null;
const sessionString = process.env.TG_SESSION || "";
const channels = (process.env.TG_CHANNELS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const limit = Number(process.env.TG_LIMIT || 12);

let client;
let clientReady = false;

async function getClient() {
  if (!apiId || !apiHash) return null;
  if (clientReady) return client;

  client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3
  });

  await client.start({
    phoneNumber: async () => process.env.TG_PHONE || "",
    password: async () => process.env.TG_PASSWORD || "",
    phoneCode: async () => process.env.TG_CODE || "",
    onError: (err) => console.error("Telegram auth error", err)
  });

  clientReady = true;
  return client;
}

export async function loadTelegramEvents() {
  const tgClient = await getClient();
  if (!tgClient || channels.length === 0) {
    return { events: [], alarms: [], alarms_updated: false };
  }

  const events = [];
  const alarmSet = new Set();
  let alarmsUpdated = false;
  for (const channel of channels) {
    try {
      const messages = await tgClient.getMessages(channel, { limit });
      const ordered = [...messages].reverse();
      for (const msg of ordered) {
        if (!msg.message) continue;
        const signal = extractAlarmSignals(msg.message);
        if (signal) {
          alarmsUpdated = true;
          signal.regions.forEach((region) => {
            if (signal.status === "off") {
              alarmSet.delete(region);
            } else {
              alarmSet.add(region);
            }
          });
        }
        const eventsFromMsg = parseMessageToEvents(msg.message, {
          source: channel,
          timestamp: msg.date * 1000,
          raw_text: msg.message
        });
        if (eventsFromMsg.length) events.push(...eventsFromMsg);
      }
    } catch (error) {
      console.warn("Failed to read channel", channel, error?.message || error);
    }
  }

  return { events, alarms: Array.from(alarmSet), alarms_updated: alarmsUpdated };
}
