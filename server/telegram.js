import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { parseMessageToEvents, extractAlarmSignals } from "./transform.js";
import { getTelegramChannels } from "./config/source-presets.js";

const apiId = process.env.TG_API_ID ? Number(process.env.TG_API_ID) : null;
const apiHash = process.env.TG_API_HASH || null;
const sessionString = process.env.TG_SESSION || "";
const channels = getTelegramChannels();
const testChannels = new Set(
  (process.env.TG_TEST_CHANNELS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean)
);
const limit = Number(process.env.TG_LIMIT || 100);
const contextWindowMs = Number(process.env.TG_CONTEXT_WINDOW_MS || 8 * 60 * 1000);
const contextMaxSignals = Number(process.env.TG_CONTEXT_MAX_SIGNALS || 10);
const channelConcurrency = Math.max(1, Number(process.env.TG_CHANNEL_CONCURRENCY || 8));
const channelTimeoutMs = Math.max(1000, Number(process.env.TG_CHANNEL_TIMEOUT_MS || 4000));
const clientStartTimeoutMs = Math.max(1000, Number(process.env.TG_CLIENT_START_TIMEOUT_MS || 8000));
const disabledChannels = new Set();

let client = null;
let clientReady = false;

function normalizeChannelKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isPermanentChannelError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("username_invalid") ||
    message.includes("no user has") ||
    message.includes("no channel has") ||
    message.includes("resolveusername")
  );
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

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
  if ([
    "свернув",
    "свернул",
    "повернув",
    "повернул",
    "змінив курс",
    "изменил курс",
    "курс на",
    "в сторону"
  ].some((key) => lower.includes(key))) {
    return true;
  }

  if (/\b\d{1,3}\s*км\s*(?:до|від|от)\s*берега\b/u.test(lower)) {
    return true;
  }

  if (lower.includes("до берега") || lower.includes("від берега") || lower.includes("от берега")) {
    return true;
  }

  return /\bтузл[а-яіїє']*\b/u.test(lower);
}

function isTrackGoneMessage(text) {
  const lower = normalizeText(text);
  return [
    "пропал",
    "пропали",
    "зник",
    "зникли",
    "исчез",
    "исчезли",
    "lost contact"
  ].some((key) => lower.includes(key));
}

function preferredRegionIdForChannel(channel) {
  const lower = String(channel || "").toLowerCase().replace(/^@/, "");
  if (lower.includes("xydessa_live") || lower.includes("pivdenmedia")) return "odeska";
  if (lower.includes("kyivoperat")) return "kyiv";
  if (lower.includes("dneproperatyv")) return "dniprovska";
  if (lower.includes("dnipro_alerts")) return "dniprovska";
  if (lower.includes("onemaster_kr")) return "dniprovska";
  if (lower.includes("chernigivoperative")) return "chernihivska";
  return null;
}

function extractBaseLabel(event) {
  const comment = String(event?.comment || "");
  const match = comment.match(/Локація:\s*([^.;]+?)(?:[.;]|$)/u);
  if (match?.[1]) return match[1].trim();
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
  }
  return refined;
}

async function disconnectClient() {
  try {
    await client?.disconnect();
  } catch {}
  client = null;
  clientReady = false;
}

async function getClient() {
  if (!apiId || !apiHash) return null;
  if (clientReady && client) return client;

  if (!client) {
    client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 2,
      receiveUpdates: false
    });
  }

  try {
    if (sessionString) {
      await client.connect();
    } else {
      await withTimeout(
        client.start({
          phoneNumber: async () => process.env.TG_PHONE || "",
          password: async () => process.env.TG_PASSWORD || "",
          phoneCode: async () => process.env.TG_CODE || "",
          onError: (err) => console.error("Telegram auth error", err)
        }),
        clientStartTimeoutMs,
        "telegram start"
      );
    }
    clientReady = true;
    return client;
  } catch (error) {
    console.warn("Telegram client init failed", error?.message || error);
    await disconnectClient();
    return null;
  }
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

  async function readChannel(channel) {
    if (disabledChannels.has(normalizeChannelKey(channel))) {
      return { channel, ordered: [] };
    }
    try {
      const messages = await withTimeout(
        tgClient.getMessages(channel, { limit }),
        channelTimeoutMs,
        `telegram channel ${channel}`
      );
      return { channel, ordered: [...messages].filter(Boolean).reverse() };
    } catch (error) {
      if (isPermanentChannelError(error)) {
        disabledChannels.add(normalizeChannelKey(channel));
        console.warn("Disabled invalid Telegram channel", channel, error?.message || error);
        return { channel, ordered: [] };
      }
      console.warn("Failed to read channel", channel, error?.message || error);
      return { channel, ordered: [] };
    }
  }

  try {
    const results = [];
    let cursor = 0;

    async function worker() {
      while (cursor < channels.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await readChannel(channels[index]);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(channelConcurrency, channels.length) }, () => worker())
    );

    for (const { channel, ordered } of results.filter(Boolean)) {
      channelMessages.set(channel, ordered);
      ordered.forEach((msg) => {
        allMessages.push({ channel, msg });
      });
      for (const msg of ordered) {
        if (!msg.message) continue;
        const signal = extractAlarmSignals(msg.message);
        if (!signal) continue;
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
      const isTestChannel = testChannels.has(String(channel || "").toLowerCase().replace(/^@/, ""));
      const parseMeta = {
        source: channel,
        timestamp: msg.date * 1000,
        raw_text: msg.message,
        is_test: isTestChannel,
        preferred_region_id: regionPreference,
        context_texts: contextTexts,
        has_reply: replyContext.hasReply,
        base_lat: baseEvent?.lat,
        base_lng: baseEvent?.lng,
        base_label: extractBaseLabel(baseEvent),
        allow_bearing_from_base: turnSignal,
        track_key: rootKey
      };

      if (isTrackGoneMessage(msg.message)) {
        const prefix = `${rootKey}-`;
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (String(events[i]?.id || "").startsWith(prefix)) {
            events.splice(i, 1);
          }
        }
        if (lastTrackKey === rootKey) {
          lastTrackKey = null;
          lastTrackEvent = null;
        }
        if (regionPreference && lastTrackByRegion.get(regionPreference) === rootKey) {
          lastTrackByRegion.delete(regionPreference);
          lastTrackEventByRegion.delete(regionPreference);
        }
        continue;
      }

      const eventsFromMsg = parseMessageToEvents(msg.message, parseMeta);
      if (!eventsFromMsg.length) continue;

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

    return {
      events: refineEventsByConsensus(events),
      alarms: Array.from(alarmSet),
      district_alarms: Array.from(districtAlarmMap.values()),
      alarms_updated: alarmsUpdated
    };
  } catch (error) {
    console.warn("Telegram load failed", error?.message || error);
    await disconnectClient();
    return { events: [], alarms: [], district_alarms: [], alarms_updated: false };
  }
}
