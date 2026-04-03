import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPORT_WINDOW_MS = 15 * 60 * 1000;
const WIDTH = 1600;
const HEIGHT = 900;
const PADDING = 48;
const TYPE_COLORS = {
  shahed: "#ffb703",
  missile: "#ff5f5f",
  airplane: "#7dd3fc",
  recon: "#c084fc",
  kab: "#fb7185",
  other: "#93c5fd"
};

let featureCollectionPromise = null;
let projectedShapesPromise = null;

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
  const date = new Date(value);
  return date.toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour12: false
  });
}

function geometryToPolygons(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") {
    return [geometry.coordinates];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates;
  }
  return [];
}

async function loadFeatureCollection() {
  if (!featureCollectionPromise) {
    const geojsonPath = path.resolve("public", "data", "ukr-adm1.geojson");
    featureCollectionPromise = fs.readFile(geojsonPath, "utf8").then((raw) => JSON.parse(raw));
  }
  return featureCollectionPromise;
}

function buildProjector(features) {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    const polygons = geometryToPolygons(feature?.geometry);
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const point of ring) {
          const lng = Number(point?.[0]);
          const lat = Number(point?.[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      }
    }
  }

  const lngSpan = Math.max(1e-6, maxLng - minLng);
  const latSpan = Math.max(1e-6, maxLat - minLat);
  const innerWidth = WIDTH - PADDING * 2;
  const innerHeight = HEIGHT - PADDING * 2;
  const scale = Math.min(innerWidth / lngSpan, innerHeight / latSpan);
  const usedWidth = lngSpan * scale;
  const usedHeight = latSpan * scale;
  const offsetX = (WIDTH - usedWidth) / 2;
  const offsetY = (HEIGHT - usedHeight) / 2;

  return (lng, lat) => ({
    x: offsetX + (lng - minLng) * scale,
    y: HEIGHT - (offsetY + (lat - minLat) * scale)
  });
}

async function loadProjectedShapes() {
  if (!projectedShapesPromise) {
    projectedShapesPromise = loadFeatureCollection().then((collection) => {
      const features = Array.isArray(collection?.features) ? collection.features : [];
      const project = buildProjector(features);
      const shapes = [];
      for (const feature of features) {
        const polygons = geometryToPolygons(feature?.geometry);
        for (const polygon of polygons) {
          const rings = polygon
            .map((ring) =>
              ring
                .map((point) => {
                  const lng = Number(point?.[0]);
                  const lat = Number(point?.[1]);
                  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                  return project(lng, lat);
                })
                .filter(Boolean)
            )
            .filter((ring) => ring.length >= 2);
          if (rings.length > 0) {
            shapes.push(rings);
          }
        }
      }
      return { shapes, project };
    });
  }
  return projectedShapesPromise;
}

function buildPathData(rings) {
  return rings
    .map((ring) => {
      const [first, ...rest] = ring;
      const segments = [`M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`];
      rest.forEach((point) => {
        segments.push(`L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
      });
      segments.push("Z");
      return segments.join(" ");
    })
    .join(" ");
}

function projectEvent(project, event) {
  const lat = Number(event?.lat);
  const lng = Number(event?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return project(lng, lat);
}

function buildArrow(project, event) {
  const center = projectEvent(project, event);
  if (!center) return null;
  const rawDirection = Number(event?.direction);
  const direction = Number.isFinite(rawDirection) ? rawDirection : null;
  if (direction === null) return null;

  const radians = ((direction - 90) * Math.PI) / 180;
  const length = normalizeReportType(event?.type) === "missile" ? 88 : 62;
  const endX = center.x + Math.cos(radians) * length;
  const endY = center.y + Math.sin(radians) * length;
  const wing = 11;
  const left = radians + Math.PI * 0.82;
  const right = radians - Math.PI * 0.82;
  const leftX = endX + Math.cos(left) * wing;
  const leftY = endY + Math.sin(left) * wing;
  const rightX = endX + Math.cos(right) * wing;
  const rightY = endY + Math.sin(right) * wing;
  return {
    line: `M ${center.x.toFixed(1)} ${center.y.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`,
    head: `${leftX.toFixed(1)},${leftY.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}`
  };
}

function renderEventLayer(project, events) {
  const nodes = [];
  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  sorted.forEach((event, index) => {
    const point = projectEvent(project, event);
    if (!point) return;
    const type = normalizeReportType(event.type);
    const color = TYPE_COLORS[type];
    const arrow = buildArrow(project, event);
    const ageMin = Math.max(0, Math.floor((Date.now() - Date.parse(event.timestamp)) / 60000));
    const label = `${reportTypeLabel(type)}${extractLocationLabel(event) ? ` · ${extractLocationLabel(event)}` : ""}`;
    const labelY = point.y - 16 - (index % 2) * 10;

    if (arrow) {
      nodes.push(`<path d="${arrow.line}" stroke="${color}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.9" />`);
      nodes.push(`<polygon points="${arrow.head}" fill="${color}" opacity="0.95" />`);
    }

    nodes.push(`<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="11" fill="rgba(8,16,28,0.92)" stroke="${color}" stroke-width="3" />`);
    nodes.push(`<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" fill="${color}" />`);
    nodes.push(`<text x="${(point.x + 16).toFixed(1)}" y="${labelY.toFixed(1)}" fill="#f8fafc" font-size="20" font-weight="700">${escapeXml(label)}</text>`);
    nodes.push(`<text x="${(point.x + 16).toFixed(1)}" y="${(labelY + 22).toFixed(1)}" fill="rgba(226,232,240,0.82)" font-size="15">≈ ${ageMin} хв тому</text>`);
  });
  return nodes.join("");
}

function renderLegend(events) {
  const counts = new Map();
  events.forEach((event) => {
    const type = normalizeReportType(event.type);
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ordered
    .slice(0, 5)
    .map(([type, count], index) => {
      const y = 146 + index * 30;
      return `
        <circle cx="1268" cy="${y}" r="7" fill="${TYPE_COLORS[type]}" />
        <text x="1286" y="${y + 5}" fill="rgba(226,232,240,0.88)" font-size="18">${escapeXml(reportTypeLabel(type))}: ${count}</text>
      `;
    })
    .join("");
}

function buildSvg(shapes, project, events) {
  const nowLabel = formatKyivDate();
  const mapPaths = shapes
    .map((rings) => `<path d="${buildPathData(rings)}" fill="rgba(15,23,42,0.92)" stroke="rgba(71,85,105,0.62)" stroke-width="1.15" />`)
    .join("");
  const eventLayer = renderEventLayer(project, events);
  const legend = renderLegend(events);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07111d" />
      <stop offset="100%" stop-color="#0b1f2e" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#020617" flood-opacity="0.48" />
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <rect x="28" y="28" width="${WIDTH - 56}" height="${HEIGHT - 56}" rx="28" fill="rgba(5,10,18,0.34)" stroke="rgba(34,211,238,0.22)" />
  <g filter="url(#shadow)">
    <rect x="52" y="52" width="520" height="126" rx="24" fill="rgba(2,6,23,0.76)" stroke="rgba(34,211,238,0.20)" />
    <text x="84" y="100" fill="#f8fafc" font-size="36" font-weight="800">AirWatcher Map Report</text>
    <text x="84" y="136" fill="rgba(226,232,240,0.86)" font-size="22">Час: ${escapeXml(nowLabel)} (Kyiv)</text>
    <text x="84" y="166" fill="rgba(226,232,240,0.86)" font-size="22">Цілей за 15 хв: ${events.length}</text>
  </g>

  <g>
    ${mapPaths}
  </g>
  <g>
    ${eventLayer}
  </g>

  <g>
    <rect x="1228" y="58" width="320" height="152" rx="22" fill="rgba(2,6,23,0.76)" stroke="rgba(248,250,252,0.10)" />
    <text x="1260" y="102" fill="#f8fafc" font-size="28" font-weight="800">Кількість цілей</text>
    <text x="1260" y="132" fill="#22d3ee" font-size="44" font-weight="800">${events.length}</text>
    ${legend}
  </g>

  <text x="${WIDTH / 2}" y="${HEIGHT - 34}" text-anchor="middle" fill="rgba(248,250,252,0.12)" font-size="54" font-weight="800">t.me/airwatcher</text>
  <text x="${WIDTH - 36}" y="${HEIGHT - 24}" text-anchor="end" fill="rgba(226,232,240,0.60)" font-size="18">t.me/airwatcher</text>
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

  if (recent.length === 0) {
    return null;
  }

  const { shapes, project } = await loadProjectedShapes();
  const svg = buildSvg(shapes, project, recent);
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
    caption: `AirWatcher map | ${formatKyivDate(now)} | Цілей: ${recent.length}`,
    count: recent.length
  };
}
