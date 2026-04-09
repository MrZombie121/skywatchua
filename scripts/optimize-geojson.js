#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'public', 'data');

/**
 * Simplify GeoJSON coordinates by reducing decimal precision
 * 5-6 decimals = ~1m precision (overkill for regional boundaries)
 * 4 decimals = ~11m precision (good for oblast-level)
 * 3 decimals = ~111m precision (still acceptable)
 */
function simplifyCoordinates(coord, precision = 4) {
  const multiplier = Math.pow(10, precision);
  if (Array.isArray(coord[0])) {
    return coord.map(c => simplifyCoordinates(c, precision));
  }
  return [
    Math.round(coord[0] * multiplier) / multiplier,
    Math.round(coord[1] * multiplier) / multiplier
  ];
}

function simplifyGeometry(geometry, precision = 4) {
  if (!geometry) return geometry;
  
  return {
    ...geometry,
    coordinates: simplifyCoordinates(geometry.coordinates, precision)
  };
}

function optimizeGeojson(geojsonPath, outputPath, precision = 4) {
  console.log(`📦 Reading GeoJSON from ${geojsonPath}...`);
  const startSize = fs.statSync(geojsonPath).size;
  console.log(`   Original size: ${(startSize / 1024 / 1024).toFixed(2)} MB`);
  
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
  
  // Simplify all features
  if (geojson.features) {
    geojson.features = geojson.features.map(feature => ({
      ...feature,
      geometry: simplifyGeometry(feature.geometry, precision)
    }));
  }
  
  // Remove unnecessary properties to save space
  if (geojson.features) {
    geojson.features.forEach(feature => {
      const props = feature.properties || {};
      // Keep only essential properties
      feature.properties = {
        shapeName: props.shapeName,
        NAME_1: props.NAME_1,
        name: props.name,
        shapeNameEnglish: props.shapeNameEnglish,
        shapeISO: props.shapeISO,
        ISO_3166_2: props.ISO_3166_2,
        iso: props.iso
      };
    });
  }
  
  const optimized = JSON.stringify(geojson);
  const endSize = optimized.length;
  const reduction = ((1 - endSize / startSize) * 100).toFixed(1);
  
  console.log(`✨ Optimized size: ${(endSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`🎯 Size reduction: ${reduction}%`);
  
  fs.writeFileSync(outputPath, optimized, 'utf-8');
  console.log(`💾 Saved to ${outputPath}`);
  
  return {
    originalSize: startSize,
    optimizedSize: endSize,
    reduction: parseFloat(reduction)
  };
}

// Main execution
const geojsonFile = path.join(dataDir, 'ukr-adm1.geojson');
const outputFile = path.join(dataDir, 'ukr-adm1.geojson');

if (!fs.existsSync(geojsonFile)) {
  console.error(`❌ GeoJSON file not found: ${geojsonFile}`);
  process.exit(1);
}

try {
  const result = optimizeGeojson(geojsonFile, outputFile, 4);
  console.log(`\n✅ GeoJSON optimization complete!`);
  console.log(`   Total reduction: ${result.reduction}%`);
} catch (error) {
  console.error('❌ Error optimizing GeoJSON:', error);
  process.exit(1);
}
