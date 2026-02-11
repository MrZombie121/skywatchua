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
const testChannels = new Set(
  (process.env.TG_TEST_CHANNELS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean)
);
const limit = Number(process.env.TG_LIMIT || 100);
const contextWindowMs = Number(process.env.TG_CONTEXT_WINDOW_MS || 8 * 60 * 1000);
const contextMaxSignals = Number(process.env.TG_CONTEXT_MAX_SIGNALS || 10);

let client;
let clientReady = false;

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.,;:()\[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTurnMessage(text) {
  const lower = normalizeText(text);
  return [
    "свернув",
    "свернул",
    "повернув",
    "повернул",
    "змінив курс",
    "изменил курс",
    "курс на",
    "в сторону"
  ].some((key) => lower.includes(key));
}

function preferredRegionIdForChannel(channel) {
  const lower = String(channel || "").toLowerCase().replace(/^@/, "");
  if (lower.includes("xydessa_live") || lower.includes("pivdenmedia")) return "odeska";
  if (lower.includes("kyivoperat")) return "kyiv";
  if (lower.includes("dneproperatyv")) return "dniprovska";
  if (lower.includes("chernigivoperative")) return "chernihivska";
  return null;
}

function haversineKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function refineEventsByConsensus(events) {
  const refined = events.map((event) => ({ ...event }));
  const windowMs = 6 * 60 * 1000;
  const radiusKm = 80;
  for (let i = 0; i < refined.length; i += 1) {
    const current = refined[i];
    const ts = Date.parse(current.timestamp);
    if (!Number.isFinite(ts)) continue;

    const peers = [];
    for (let j = 0; j < refined.length; j += 1) {
      if (i === j) continue;
      const candidate = refined[j];
      if (candidate.type !== current.type) continue;
      const candidateTs = Date.parse(candidate.timestamp);
      if (!Number.isFinite(candidateTs)) continue;
      if (Math.abs(ts - candidateTs) > windowMs) continue;
      const distance = haversineKm(
        { lat: current.lat, lng: current.lng },
        { lat: candidate.lat, lng: candidate.lng }
      );
      if (distance > radiusKm) continue;
      peers.push(candidate);
    }
    if (peers.length === 0) continue;

    const all = [current, ...peers];
    current.lat = Number((all.reduce((sum, item) => sum + Number(item.lat || 0), 0) / all.length).toFixed(4));
    current.lng = Number((all.reduce((sum, item) => sum + Number(item.lng || 0), 0) / all.length).toFixed(4));
    // Do not infer heading from neighboring signals to avoid unsolicited course changes.
  }
  return refined;
}

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
    return { events: [], alarms: [], district_alarms: [], alarms_updated: false };
  }

  const events = [];
  const alarmSet = new Set();
  const districtAlarmMap = new Map();
  let alarmsUpdated = false;

  const channelMessages = new Map();
  const allMessages = [];
  for (const channel of channels) {
    try {
      const messages = await tgClient.getMessages(channel, { limit });
      const ordered = [...messages].filter(Boolean).reverse();
      channelMessages.set(channel, ordered);
      ordered.forEach((msg) => {
        allMessages.push({ channel, msg });
      });
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
          (signal.districts || []).forEach((district) => {
            if (signal.status === "off") {
              districtAlarmMap.delete(district.id);
            } else {
              districtAlarmMap.set(district.id, district);
            }
          });
        }
      }
    } catch (error) {
      console.warn("Failed to read channel", channel, error?.message || error);
    }
  }

  allMessages.sort((a, b) => (a.msg.date || 0) - (b.msg.date || 0));

  function findReplyContext(channel, msg) {
    const replyTo = msg.replyTo || {};
    const replyId = replyTo.replyToMsgId;
    if (!replyId) {
      return {
        hasReply: false,
        rootKey: `${channel}:${msg.id}`,
        parentText: null,
        baseEvent: null
      };
    }

    const sameChannel = channelMessages.get(channel) || [];
    const parent = sameChannel.find((item) => item.id === replyId);
    const root = replyTo.replyToTopId || replyId;
    let baseEvent = null;
    if (parent?.message) {
      const parentEvents = parseMessageToEvents(parent.message, {
        source: channel,
        timestamp: parent.date * 1000,
        raw_text: parent.message
      });
      if (parentEvents.length) {
        baseEvent = parentEvents[0];
      }
    }
    return {
      hasReply: true,
      rootKey: `${channel}:${root}`,
      parentText: parent?.message || null,
      baseEvent
    };
  }

  let lastTrackKey = null;
  let lastTrackEvent = null;
  const lastTrackByRegion = new Map();
  const lastTrackEventByRegion = new Map();

  for (const item of allMessages) {
    const { channel, msg } = item;
    if (!msg?.message) continue;

    const nowTs = Number(msg.date || 0) * 1000;
    const turnSignal = isTurnMessage(msg.message);
    const replyContext = findReplyContext(channel, msg);
    const regionPreference = preferredRegionIdForChannel(channel);
    const regionTrackKey = regionPreference ? lastTrackByRegion.get(regionPreference) : null;
    const regionTrackEvent = regionPreference ? lastTrackEventByRegion.get(regionPreference) : null;
    const useRegionalTrack =
      !replyContext.hasReply && turnSignal && typeof regionTrackKey === "string";
    const useLastTrack =
      !replyContext.hasReply &&
      turnSignal &&
      !useRegionalTrack &&
      typeof lastTrackKey === "string";
    const rootKey = useRegionalTrack
      ? regionTrackKey
      : useLastTrack
        ? lastTrackKey
        : replyContext.rootKey;
    const parentText = useRegionalTrack || useLastTrack ? null : replyContext.parentText;
    const baseEvent = useRegionalTrack
      ? regionTrackEvent
      : useLastTrack
        ? lastTrackEvent
        : replyContext.baseEvent;
    const nearbySignals = [];
    for (let i = allMessages.length - 1; i >= 0 && nearbySignals.length < contextMaxSignals; i -= 1) {
      const current = allMessages[i];
      const currentText = current.msg?.message;
      if (!currentText || current.msg.id === msg.id) continue;
      const ts = Number(current.msg.date || 0) * 1000;
      if (Math.abs(nowTs - ts) > contextWindowMs) continue;
      nearbySignals.push(currentText);
    }

    const contextTexts = [parentText, ...nearbySignals].filter(Boolean);
    const eventsFromMsg = parseMessageToEvents(msg.message, {
      source: channel,
      timestamp: msg.date * 1000,
      raw_text: msg.message,
      is_test: testChannels.has(String(channel || "").toLowerCase().replace(/^@/, "")),
      context_texts: contextTexts,
      base_lat: baseEvent?.lat,
      base_lng: baseEvent?.lng,
      allow_bearing_from_base: turnSignal,
      track_key: rootKey
    });
    if (eventsFromMsg.length) {
      events.push(...eventsFromMsg);
      lastTrackKey = rootKey;
      lastTrackEvent = eventsFromMsg[0];
      eventsFromMsg.forEach((eventItem) => {
        if (eventItem?.region_id) {
          lastTrackByRegion.set(eventItem.region_id, rootKey);
          lastTrackEventByRegion.set(eventItem.region_id, eventItem);
        }
      });
    }
  }

  return {
    events: refineEventsByConsensus(events),
    alarms: Array.from(alarmSet),
    district_alarms: Array.from(districtAlarmMap.values()),
    alarms_updated: alarmsUpdated
  };
}
