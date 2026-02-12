import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseCalibrationPoints(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
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
    return [];
  }
}

function solveAffine(points, valueKey) {
  if (points.length < 3) return null;
  const [p1, p2, p3] = points;
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;
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

function buildPixelMapper(points) {
  if (points.length < 3) return null;
  const latAffine = solveAffine(points, "lat");
  const lngAffine = solveAffine(points, "lng");
  if (!latAffine || !lngAffine) return null;
  return (x, y) => ({
    lat: latAffine.a * x + latAffine.b * y + latAffine.c,
    lng: lngAffine.a * x + lngAffine.b * y + lngAffine.c
  });
}

function parseConnectedComponents(output) {
  const lines = String(output || "").split(/\r?\n/);
  const points = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !/^\d+:\s+/.test(trimmed)) continue;
    const match = trimmed.match(/^\d+:\s+\S+\s+(\d+)\s+([0-9.]+),([0-9.]+)/);
    if (!match) continue;
    const area = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (!Number.isFinite(area) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y, area });
  }
  return points;
}

export async function extractImageMarkers(imagePath) {
  const calibrationRaw = process.env.MAP_CALIBRATION_POINTS || "";
  const calibrationPoints = parseCalibrationPoints(calibrationRaw);
  const mapPixel = buildPixelMapper(calibrationPoints);
  if (!mapPixel) {
    console.warn("Image markers skipped: MAP_CALIBRATION_POINTS missing or invalid.");
    return [];
  }

  const commandArgs = [
    imagePath,
    "-alpha",
    "off",
    "-colorspace",
    "RGB",
    "-fx",
    "r>0.6 && g>0.6 && b<0.5 ? 1 : 0",
    "-threshold",
    "50%",
    "-define",
    "connected-components:verbose=true",
    "-define",
    "connected-components:area-threshold=30",
    "-connected-components",
    "8",
    "null:"
  ];

  try {
    const { stdout, stderr } = await execFileAsync("magick", commandArgs, { timeout: 15000 });
    const markers = parseConnectedComponents(`${stdout}\n${stderr}`);
    return markers.map((marker) => ({
      ...mapPixel(marker.x, marker.y),
      x: marker.x,
      y: marker.y,
      area: marker.area
    }));
  } catch (error) {
    console.warn("Failed to extract image markers via ImageMagick:", error?.message || error);
    return [];
  }
}
