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
const limit = Math.max(10, Math.min(200, Number(process.env.TG_LIMIT || 100)));
const contextWindowMs = Number(process.env.TG_CONTEXT_WINDOW_MS || 8 * 60 * 1000);
const contextMaxSignals = Number(process.env.TG_CONTEXT_MAX_SIGNALS || 4);
const channelConcurrency = Math.max(1, Math.min(24, Number(process.env.TG_CHANNEL_CONCURRENCY || 1)));
const channelTimeoutMs = Math.max(1000, Number(process.env.TG_CHANNEL_TIMEOUT_MS || 8000));
const clientStartTimeoutMs = Math.max(1000, Number(process.env.TG_CLIENT_START_TIMEOUT_MS || 20000));
const entityResolveTimeoutMs = Math.max(channelTimeoutMs, Number(process.env.TG_ENTITY_RESOLVE_TIMEOUT_MS || 15000));
const messageFreshWindowMs = Math.max(contextWindowMs, Number(process.env.TG_MESSAGE_WINDOW_MS || 30 * 60 * 1000));
const disabledChannels = new Map();
const disabledChannelRetryMs = Math.max(60 * 1000, Number(process.env.TG_DISABLED_RETRY_MS || 10 * 60 * 1000));
const entityCache = new Map();
let dialogPeerIndex = null;

let client = null;
let clientReady = false;
let reconnectPromise = null;

function normalizeChannelKey(value) {
  return String(value || "").trim().toLowerCase();
}

function bareChannelKey(value) {
  return normalizeChannelKey(value).replace(/^@/, "");
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

function isRecoverableConnectionError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("not connected") ||
    message.includes("connection closed") ||
    message.includes("cannot send requests while disconnected") ||
    message.includes("please reconnect") ||
    message.includes("disconnected") ||
    message.includes("timeout")
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
  if (lower.includes("xydessa_live") || lower.includes("pivdenmedia") || lower.includes("oddesitmedia")) return "odeska";
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
  dialogPeerIndex = null;
  entityCache.clear();
}

function filterFreshMessages(messages) {
  const items = [...messages].filter(Boolean);
  const cutoffTs = Date.now() - messageFreshWindowMs;
  return items
    .filter((msg) => Number(msg?.date || 0) * 1000 >= cutoffTs)
    .reverse();
}

async function reconnectClient() {
  if (reconnectPromise) {
    return reconnectPromise;
  }
  reconnectPromise = (async () => {
    await disconnectClient();
    return getClient(true);
  })();
  try {
    return await reconnectPromise;
  } finally {
    reconnectPromise = null;
  }
}

async function getClient(forceReconnect = false) {
  if (!apiId || !apiHash) return null;
  const connected = Boolean(client?.connected) && !client?.disconnected;
  if (forceReconnect || (client && clientReady && !connected)) {
    await disconnectClient();
  }
  if (clientReady && client && Boolean(client.connected) && !client.disconnected) {
    return client;
  }

  if (!client) {
    client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      autoReconnect: true,
      connectionRetries: 5,
      retryDelay: 1000,
      receiveUpdates: false
    });
  }

  try {
    if (sessionString) {
      await withTimeout(client.connect(), clientStartTimeoutMs, "telegram connect");
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
    console.log(`Telegram client ready. Channels configured: ${channels.length}.`);
    return client;
  } catch (error) {
    console.warn("Telegram client init failed", error?.message || error);
    await disconnectClient();
    return null;
  }
}

async function buildDialogPeerIndex(tgClient) {
  if (dialogPeerIndex) return dialogPeerIndex;
  const dialogs = await withTimeout(
    tgClient.getDialogs({ limit: 300 }),
    entityResolveTimeoutMs,
    "telegram dialogs"
  );
  const index = new Map();
  for (const dialog of dialogs || []) {
    const entity = dialog?.entity;
    if (!entity) continue;
    const username = bareChannelKey(entity.username || "");
    if (username) {
      index.set(username, entity);
    }
  }
  dialogPeerIndex = index;
  return dialogPeerIndex;
}

async function resolveChannelPeer(tgClient, channel) {
  const key = normalizeChannelKey(channel);
  if (!key) return null;
  if (entityCache.has(key)) {
    return entityCache.get(key);
  }

  try {
    const entity = await withTimeout(
      tgClient.getEntity(channel),
      entityResolveTimeoutMs,
      `telegram entity ${channel}`
    );
    entityCache.set(key, entity);
    return entity;
  } catch (error) {
    if (isRecoverableConnectionError(error)) {
      entityCache.delete(key);
      throw error;
    }
    const dialogs = await buildDialogPeerIndex(tgClient).catch(() => null);
    const dialogEntity = dialogs?.get(bareChannelKey(channel)) || null;
    if (dialogEntity) {
      entityCache.set(key, dialogEntity);
      return dialogEntity;
    }
    throw error;
  }
}

export async function loadTelegramEvents() {
  const startTime = Date.now();
  const tgClient = await getClient();
  if (!tgClient || channels.length === 0) {
    console.warn(`Telegram not ready or no channels. Client: ${!!tgClient}, Channels: ${channels.length}`);
    return { events: [], alarms: [], district_alarms: [], alarms_updated: false };
  }
  console.log(`[TG] Reading ${channels.length} channels with limit=${limit}, concurrency=${channelConcurrency}. oddesitmedia=${channels.includes("@oddesitmedia")}`);

  const events = [];
  const alarmSet = new Set();
  const districtAlarmMap = new Map();
  let alarmsUpdated = false;
  const channelMessageIndex = new Map();
  const allMessages = [];
  let successCount = 0;
  let failureCount = 0;

async function readChannel(channel) {
    const normalizedChannel = normalizeChannelKey(channel);
    const disabledUntil = disabledChannels.get(normalizedChannel) || 0;
    if (disabledUntil > Date.now()) {
      return { channel, ordered: [] };
    }
    if (disabledUntil) {
      disabledChannels.delete(normalizedChannel);
    }
    const chStartTime = Date.now();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const activeClient = attempt > 0 ? await reconnectClient() : tgClient;
        if (!activeClient) {
          throw new Error("Telegram client unavailable");
        }
        const peer = await resolveChannelPeer(activeClient, channel);
        if (!peer) {
          throw new Error(`Unable to resolve peer for ${channel}`);
        }
        const messages = await withTimeout(
          activeClient.getMessages(peer, { limit }),
          channelTimeoutMs,
          `telegram channel ${channel}`
        );
        const ordered = filterFreshMessages(messages);
        const chDuration = Date.now() - chStartTime;
        console.log(`  ${channel}: ${ordered.length}/${[...messages].filter(Boolean).length} fresh msgs in ${chDuration}ms`);
        return { channel, ordered };
      } catch (error) {
        const chDuration = Date.now() - chStartTime;
        if (isPermanentChannelError(error)) {
          disabledChannels.set(normalizedChannel, Date.now() + disabledChannelRetryMs);
          console.warn(`  ${channel}: DISABLED for ${Math.round(disabledChannelRetryMs / 60000)}m after ${chDuration}ms - ${error?.message || error}`);
          return { channel, ordered: [] };
        }
        if (attempt === 0 && isRecoverableConnectionError(error)) {
          console.warn(`  ${channel}: reconnect after ${chDuration}ms - ${error?.message || error}`);
          await reconnectClient();
          continue;
        }
        console.warn("Failed to read channel", channel, error?.message || error);
        return { channel, ordered: [] };
      }
    }
    return { channel, ordered: [] };
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
      if (ordered.length > 0) {
        successCount++;
      } else {
        failureCount++;
      }
      channelMessageIndex.set(
        channel,
        new Map(ordered.map((msg) => [msg.id, msg]))
      );
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
    const replyContextCache = new Map();
    const baseEventCache = new Map();

    function findReplyContext(channel, msg) {
      const cacheKey = `${channel}:${msg.id}`;
      if (replyContextCache.has(cacheKey)) {
        return replyContextCache.get(cacheKey);
      }
      const replyTo = msg.replyTo || {};
      const replyId = replyTo.replyToMsgId;
      if (!replyId) {
        const context = {
          hasReply: false,
          rootKey: `${channel}:${msg.id}`,
          parentText: null,
          baseEvent: null
        };
        replyContextCache.set(cacheKey, context);
        return context;
      }

      const sameChannel = channelMessageIndex.get(channel) || new Map();
      const parent = sameChannel.get(replyId);
      const root = replyTo.replyToTopId || replyId;
      let baseEvent = null;
      if (parent?.message) {
        const baseEventKey = `${channel}:${parent.id}`;
        if (!baseEventCache.has(baseEventKey)) {
          const parentEvents = parseMessageToEvents(parent.message, {
            source: channel,
            timestamp: parent.date * 1000,
            raw_text: parent.message
          });
          baseEventCache.set(baseEventKey, parentEvents[0] || null);
        }
        baseEvent = baseEventCache.get(baseEventKey);
      }
      const context = {
        hasReply: true,
        rootKey: `${channel}:${root}`,
        parentText: parent?.message || null,
        baseEvent
      };
      replyContextCache.set(cacheKey, context);
      return context;
    }

    let lastTrackKey = null;
    let lastTrackEvent = null;
    const lastTrackByRegion = new Map();
    const lastTrackEventByRegion = new Map();
    const recentTexts = [];
    let recentCursor = 0;

    for (const item of allMessages) {
      const { channel, msg } = item;
      if (!msg?.message) continue;

      const nowTs = Number(msg.date || 0) * 1000;
      while (recentCursor < recentTexts.length && nowTs - recentTexts[recentCursor].ts > contextWindowMs) {
        recentCursor += 1;
      }
      if (recentCursor > 128 && recentCursor * 2 > recentTexts.length) {
        recentTexts.splice(0, recentCursor);
        recentCursor = 0;
      }
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
      for (let i = recentTexts.length - 1; i >= recentCursor && nearbySignals.length < contextMaxSignals; i -= 1) {
        nearbySignals.push(recentTexts[i].text);
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
        recentTexts.push({ ts: nowTs, text: msg.message });
        continue;
      }

      const eventsFromMsg = parseMessageToEvents(msg.message, parseMeta);
      if (!eventsFromMsg.length) {
        recentTexts.push({ ts: nowTs, text: msg.message });
        continue;
      }

      events.push(...eventsFromMsg);
      lastTrackKey = rootKey;
      lastTrackEvent = eventsFromMsg[0];
      eventsFromMsg.forEach((eventItem) => {
        if (eventItem?.region_id) {
          lastTrackByRegion.set(eventItem.region_id, rootKey);
          lastTrackEventByRegion.set(eventItem.region_id, eventItem);
        }
      });
      recentTexts.push({ ts: nowTs, text: msg.message });
    }

    const refinedEvents = refineEventsByConsensus(events);
    const duration = Date.now() - startTime;
    console.log(
      `Telegram load: ${refinedEvents.length} events (${successCount}/${channels.length} channels, ${failureCount} failed), ` +
      `${alarmSet.size} region alarms, ${districtAlarmMap.size} district alarms, ${duration}ms`
    );
    return {
      events: refinedEvents,
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
