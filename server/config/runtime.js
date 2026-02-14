function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toList(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const runtime = {
  appVersion: process.env.APP_VERSION || "2.0.0 beta",
  apiDefaultVersion: process.env.API_DEFAULT_VERSION || "v1",
  port: toNumber(process.env.PORT, 8787),
  sessionDays: toNumber(process.env.ADMIN_SESSION_DAYS, 7),
  refreshMs: toNumber(process.env.REFRESH_MS, 12000),
  eventTtlMin: toNumber(process.env.EVENT_TTL_MIN, 8),
  eventStaleKeepMin: toNumber(process.env.EVENT_STALE_KEEP_MIN, 90),
  dedupRadiusKm: toNumber(process.env.EVENT_DEDUP_RADIUS_KM, 5),
  dedupWindowMin: toNumber(process.env.EVENT_DEDUP_WINDOW_MIN, 5),
  sourceWeightDefault: toNumber(process.env.SOURCE_WEIGHT_DEFAULT, 1),
  forcedAlarmIds: toList(
    process.env.ALARM_FORCE_ON,
    ["luhanska", "donetska", "khersonska", "chernihivska"]
  ),
  featureFlags: {
    enableV2Api: toBoolean(process.env.ENABLE_V2_API, false),
    enableV2Ui: toBoolean(process.env.ENABLE_V2_UI, false)
  }
};

