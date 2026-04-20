function toList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeChannel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("@") ? text : `@${text}`;
}

const coreTelegramChannels = [
  "@kpszsu",
  "@air_alert_ua",
  "@war_monitor",
  "@tlknewsua",
  "@xydessa_live",
  "@oddesitmedia",
  "@pivdenmedia",
  "@dneproperatyv",
  "@kyivoperat",
  "@ChernigivOperative",
  "@dnipro_alerts",
  "@onemaster_kr"
];

const extendedTelegramChannels = [
  "@povitryanatrivogaaa",
  "@Ukrainian_Intelligence",
  "@kudy_letyt",
  "@raketa_trevoga",
  "@StrategicaviationT",
  "@avimonitor",
  "@monitor_ukraine",
  "@monitorwar",
  "@novynylive",
  "@operativnoZSU",
  "@zradaperemoga",
  "@UkraineNow",
  "@informnapalm",
  "@insiderUKR"
];

export function getTelegramChannels() {
  const fromEnv = toList(process.env.TG_CHANNELS).map(normalizeChannel).filter(Boolean);
  const usePresets = String(process.env.TG_USE_PRESET_CHANNELS || "true").toLowerCase() !== "false";
  const useExtended = String(process.env.TG_USE_EXTENDED_CHANNELS || "false").toLowerCase() === "true";
  const presetChannels = useExtended ? [...coreTelegramChannels, ...extendedTelegramChannels] : coreTelegramChannels;
  const combined = usePresets ? [...presetChannels, ...fromEnv] : fromEnv;
  return Array.from(new Set(combined.map(normalizeChannel).filter(Boolean)));
}

export function getRssUrls() {
  return Array.from(
    new Set([...toList(process.env.RSS_URLS), ...toList(process.env.OSINT_RSS_URLS)])
  );
}

export function getOpenJsonUrls() {
  return Array.from(
    new Set([...toList(process.env.OPEN_JSON_FEEDS), ...toList(process.env.OSINT_JSON_FEEDS)])
  );
}
