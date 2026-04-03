import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runtime } from "./config/runtime.js";

const execFileAsync = promisify(execFile);
const REPORT_WINDOW_MS = 15 * 60 * 1000;
const ACTIVE_WINDOW_MS = Math.max(1, Number(runtime.eventTtlMin || 10)) * 60 * 1000;
const TEMPLATE_PATH = path.resolve("public", "ico", "map-creation-teamplate.png");
const WATERMARK_PATH = path.resolve("public", "ico", "watermark.png");
const TEMPLATE_WIDTH = 928;
const TEMPLATE_HEIGHT = 588;
const DEFAULT_TEMPLATE_CALIBRATION_POINTS = [
  { name: "Lviv", lat: 49.8397, lng: 24.0297, x: 112, y: 179 },
  { name: "Kyiv", lat: 50.4501, lng: 30.5234, x: 430, y: 152 },
  { name: "Odesa", lat: 46.4825, lng: 30.7233, x: 426, y: 427 },
  { name: "Kharkiv", lat: 49.9935, lng: 36.2304, x: 717, y: 165 },
  { name: "Dnipro", lat: 48.4647, lng: 35.0462, x: 622, y: 281 },
  { name: "Chernihiv", lat: 51.4982, lng: 31.2893, x: 496, y: 86 }
];
const ICON_PATHS = {
  shahed: path.resolve("public", "ico", "shahed.png"),
  missile: path.resolve("public", "ico", "missle.png"),
  airplane: path.resolve("public", "ico", "airplane.png"),
  kab: path.resolve("public", "ico", "kab.png"),
  recon: path.resolve("public", "ico", "bplaviewer.png"),
  other: path.resolve("public", "ico", "bplaviewer.png")
};
const TYPE_COLORS = {
  shahed: "#ffb703",
  missile: "#ff5f5f",
  airplane: "#7dd3fc",
  recon: "#c084fc",
  kab: "#fb7185",
  other: "#93c5fd"
};

let assetsPromise = null;

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeReportType(type) {
  const key = String(type || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(TYPE_COLORS, key) ? key : "other";
}

function reportTypeLabel(type) {
  const key = normalizeReportType(type);
  if (key === "shahed") return "БпЛА";
  if (key === "missile") return "Ракета";
  if (key === "airplane") return "Літак";
  if (key === "recon") return "Розвідка";
  if (key === "kab") return "КАБ";
  return "Ціль";
}

function extractLocationLabel(event) {
  const match = String(event?.comment || "").match(/Локація:\s*([^.;]+?)(?:[.;]|$)/u);
  if (match?.[1]) return match[1].trim();
  if (event?.target_label) return String(event.target_label).trim();
  return "";
}

function formatKyivDate(value = Date.now()) {
  return new Date(value).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour12: false
  });
}

function parseCalibrationPoints(raw) {
  if (!raw) return DEFAULT_TEMPLATE_CALIBRATION_POINTS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 3) return DEFAULT_TEMPLATE_CALIBRATION_POINTS;
    return parsed
      .filter((item) =>
        item &&
        Number.isFinite(Number(item.lat)) &&
        Number.isFinite(Number(item.lng)) &&
        Number.isFinite(Number(item.x)) &&
        Number.isFinite(Number(item.y))
      )
      .map((item) => ({
        lat: Number(item.lat),
        lng: Number(item.lng),
        x: Number(item.x),
        y: Number(item.y)
      }));
  } catch {
    return DEFAULT_TEMPLATE_CALIBRATION_POINTS;
  }
}

function solveAffineLatLng(points, valueKey) {
  if (points.length < 3) return null;
  const [p1, p2, p3] = points;
  const x1 = p1.lat;
  const y1 = p1.lng;
  const x2 = p2.lat;
  const y2 = p2.lng;
  const x3 = p3.lat;
  const y3 = p3.lng;
  const v1 = p1[valueKey];
  const v2 = p2[valueKey];
  const v3 = p3[valueKey];

  const det =
    x1 * (y2 - y3) -
    y1 * (x2 - x3) +
    (x2 * y3 - x3 * y2);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;

  const a =
    (v1 * (y2 - y3) - y1 * (v2 - v3) + (v2 * y3 - v3 * y2)) / det;
  const b =
    (x1 * (v2 - v3) - v1 * (x2 - x3) + (x2 * v3 - x3 * v2)) / det;
  const c =
    (x1 * (y3 * v2 - y2 * v3) -
      y1 * (x3 * v2 - x2 * v3) +
      v1 * (x3 * y2 - x2 * y3)) / det;

  return { a, b, c };
}

function buildLatLngProjector(points) {
  if (points.length < 3) return null;
  const xAffine = solveAffineLatLng(points, "x");
  const yAffine = solveAffineLatLng(points, "y");
  if (!xAffine || !yAffine) return null;
  return (lat, lng) => ({
    x: xAffine.a * lat + xAffine.b * lng + xAffine.c,
    y: yAffine.a * lat + yAffine.b * lng + yAffine.c
  });
}

async function toDataUri(filePath) {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "application/octet-stream";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const background = await toDataUri(TEMPLATE_PATH);
      const watermark = await toDataUri(WATERMARK_PATH);
      const icons = {};
      for (const [key, filePath] of Object.entries(ICON_PATHS)) {
        icons[key] = await toDataUri(filePath);
      }
      const calibrationPoints = parseCalibrationPoints(
        process.env.MAP_REPORT_CALIBRATION_POINTS || ""
      );
      const project = buildLatLngProjector(calibrationPoints);
      if (!project) {
        throw new Error("MAP_REPORT_CALIBRATION_POINTS missing or invalid for map report");
      }
      return { background, watermark, icons, project };
    })();
  }
  return assetsPromise;
}

function projectEvent(project, event) {
  const lat = Number(event?.lat);
  const lng = Number(event?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return project(lat, lng);
}

function buildArrow(point, event) {
  const rawDirection = Number(event?.direction);
  if (!Number.isFinite(rawDirection)) return null;
  const direction = rawDirection;
  const radians = ((direction - 90) * Math.PI) / 180;
  const length = normalizeReportType(event?.type) === "missile" ? 72 : 56;
  const endX = point.x + Math.cos(radians) * length;
  const endY = point.y + Math.sin(radians) * length;
  const wing = 9;
  const left = radians + Math.PI * 0.82;
  const right = radians - Math.PI * 0.82;
  return {
    line: `M ${point.x.toFixed(1)} ${point.y.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`,
    head: `${(endX + Math.cos(left) * wing).toFixed(1)},${(endY + Math.sin(left) * wing).toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)} ${(endX + Math.cos(right) * wing).toFixed(1)},${(endY + Math.sin(right) * wing).toFixed(1)}`
  };
}

function renderLegend(events) {
  const counts = new Map();
  events.forEach((event) => {
    const type = normalizeReportType(event.type);
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count], index) => {
      const y = 112 + index * 22;
      return `
        <circle cx="742" cy="${y}" r="5" fill="${TYPE_COLORS[type]}" />
        <text x="756" y="${y + 4}" fill="#f8fafc" font-size="13">${escapeXml(reportTypeLabel(type))}: ${count}</text>
      `;
    })
    .join("");
}

function renderEvents(project, icons, events) {
  const nodes = [];
  const placed = [];
  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  sorted.forEach((event) => {
    const point = projectEvent(project, event);
    if (!point) return;

    let x = point.x;
    let y = point.y;
    for (const prior of placed) {
      if (Math.abs(prior.x - x) < 18 && Math.abs(prior.y - y) < 18) {
        x += 14;
        y -= 10;
      }
    }
    placed.push({ x, y });

    const type = normalizeReportType(event.type);
    const iconHref = icons[type] || icons.other;
    const color = TYPE_COLORS[type];
    const arrow = buildArrow({ x, y }, event);
    const ageMin = Math.max(0, Math.floor((Date.now() - Date.parse(event.timestamp)) / 60000));
    const location = extractLocationLabel(event);

    if (arrow) {
      nodes.push(`<path d="${arrow.line}" stroke="${color}" stroke-width="3.4" stroke-linecap="round" fill="none" opacity="0.98" />`);
      nodes.push(`<polygon points="${arrow.head}" fill="${color}" opacity="0.98" />`);
    }

    nodes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18" fill="rgba(15,23,42,0.78)" stroke="${color}" stroke-width="2.8" />`);
    nodes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="23" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.30" />`);
    nodes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2" fill="${color}" />`);
    nodes.push(`<image href="${iconHref}" x="${(x - 14).toFixed(1)}" y="${(y - 14).toFixed(1)}" width="28" height="28" />`);

    if (location) {
      nodes.push(`
        <g>
          <rect x="${(x + 14).toFixed(1)}" y="${(y - 26).toFixed(1)}" rx="8" width="${Math.max(62, location.length * 7.1).toFixed(1)}" height="18" fill="rgba(2,6,23,0.72)" />
          <text x="${(x + 20).toFixed(1)}" y="${(y - 13).toFixed(1)}" fill="#f8fafc" font-size="12" font-weight="700">${escapeXml(location)}</text>
        </g>
      `);
    }

    nodes.push(`<text x="${(x + 16).toFixed(1)}" y="${(y + 22).toFixed(1)}" fill="rgba(248,250,252,0.78)" font-size="11">≈ ${ageMin} хв</text>`);
  });

  return nodes.join("");
}

function buildSvg(background, watermark, icons, project, events) {
  const nowLabel = formatKyivDate();
  const legend = renderLegend(events);
  const eventLayer = renderEvents(project, icons, events);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TEMPLATE_WIDTH}" height="${TEMPLATE_HEIGHT}" viewBox="0 0 ${TEMPLATE_WIDTH} ${TEMPLATE_HEIGHT}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#020617" flood-opacity="0.46" />
    </filter>
  </defs>

  <image href="${background}" x="0" y="0" width="${TEMPLATE_WIDTH}" height="${TEMPLATE_HEIGHT}" />

  <g filter="url(#shadow)">
    <rect x="18" y="18" width="330" height="80" rx="18" fill="rgba(2,6,23,0.82)" stroke="rgba(34,211,238,0.22)" />
    <text x="36" y="48" fill="#f8fafc" font-size="18" font-weight="800">AirWatcher</text>
    <text x="36" y="70" fill="rgba(226,232,240,0.92)" font-size="14">Час: ${escapeXml(nowLabel)}</text>
    <text x="36" y="90" fill="rgba(226,232,240,0.92)" font-size="14">Активних цілей: ${events.length}</text>
  </g>

  <g filter="url(#shadow)">
    <rect x="726" y="18" width="184" height="150" rx="18" fill="rgba(2,6,23,0.82)" stroke="rgba(248,250,252,0.12)" />
    <text x="742" y="44" fill="#f8fafc" font-size="16" font-weight="800">Активні цілі</text>
    <text x="742" y="78" fill="#22d3ee" font-size="30" font-weight="800">${events.length}</text>
    ${legend}
  </g>

  <g>
    ${eventLayer}
  </g>

  <image href="${watermark}" x="${(TEMPLATE_WIDTH / 2 - 130).toFixed(1)}" y="${(TEMPLATE_HEIGHT - 72).toFixed(1)}" width="260" height="46" opacity="0.28" />
  <image href="${watermark}" x="${(TEMPLATE_WIDTH - 162).toFixed(1)}" y="10" width="144" height="26" opacity="0.42" />
</svg>`;
}

async function svgToPng(svgPath, pngPath) {
  await execFileAsync("convert", [svgPath, pngPath], { timeout: 30000 });
}

export async function generateRecentMapReport(events) {
  const now = Date.now();
  const recent = (Array.isArray(events) ? events : [])
    .filter((event) => !event?.is_test)
    .filter((event) => {
      const ts = Date.parse(event?.timestamp);
      return Number.isFinite(ts) && now - ts <= REPORT_WINDOW_MS;
    });

  const active = recent.filter((event) => {
    const ts = Date.parse(event?.timestamp);
    return Number.isFinite(ts) && now - ts <= ACTIVE_WINDOW_MS;
  });

  if (active.length === 0) {
    return null;
  }

  const { background, watermark, icons, project } = await loadAssets();
  const svg = buildSvg(background, watermark, icons, project, active);
  const reportId = `airwatcher-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = path.resolve("server", "tmp");
  const svgPath = path.join(tmpDir, `${reportId}.svg`);
  const pngPath = path.join(tmpDir, `${reportId}.png`);

  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(svgPath, svg, "utf8");
  await svgToPng(svgPath, pngPath);
  await fs.unlink(svgPath).catch(() => {});

  return {
    path: pngPath,
    caption: `AirWatcher map | ${formatKyivDate(now)} | Активних цілей: ${active.length}`,
    count: active.length
  };
}
