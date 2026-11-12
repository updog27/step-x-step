const ORS_URL = "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson";
const MAX_ROUTE_DISTANCE_ERROR_METERS = 80.5; // 0.05 miles

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: JSON.stringify(body) };
}

function destinationPoint(lat, lon, distanceMeters, bearingDegrees) {
  const R = 6371000, bearing = bearingDegrees * Math.PI / 180;
  const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180, angular = distanceMeters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI];
}

async function getRoute(coordinates, apiKey) {
  const response = await fetch(ORS_URL, {
    method: "POST",
    headers: { "Authorization": apiKey, "Content-Type": "application/json", "Accept": "application/geo+json" },
    body: JSON.stringify({
      coordinates, instructions: false, preference: "recommended", units: "m",
      extra_info: ["waycategory", "waytype", "noise", "green", "suitability", "roadaccessrestrictions"]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.error || payload.message || "The routing service could not create this route.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  const feature = payload.features?.[0], coords = feature?.geometry?.coordinates, meters = feature?.properties?.summary?.distance;
  if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(meters)) throw new Error("The routing service returned an incomplete route.");
  const extras = feature.properties?.extras || {};
  const summaries = {
    waycategory: extras.waycategory || extras.waycategories,
    waytype: extras.waytype || extras.waytypes,
    noise: extras.noise,
    green: extras.green,
    suitability: extras.suitability,
    access: extras.roadaccessrestrictions
  };
  const totalFor = (extra, predicate) => (extra?.summary || [])
    .filter(item => predicate(item.value))
    .reduce((sum, item) => sum + (Number(item.distance) || 0), 0);
  // ORS waytype IDs: 1 state road; 2 secondary/tertiary/unclassified road;
  // 3 residential/service/living street; 4 path; 5 track; 6 cycleway;
  // 7 footway/pedestrian/crossing; 8 steps; 9 ferry; 10 construction.
  const highwayMeters = totalFor(summaries.waycategory, value => (Number(value) & 1) === 1);
  const stateRoadMeters = totalFor(summaries.waytype, value => Number(value) === 1);
  const generalRoadMeters = totalFor(summaries.waytype, value => Number(value) === 2);
  const residentialStreetMeters = totalFor(summaries.waytype, value => Number(value) === 3);
  const pathMeters = totalFor(summaries.waytype, value => Number(value) === 4);
  const trackMeters = totalFor(summaries.waytype, value => Number(value) === 5);
  const cyclewayMeters = totalFor(summaries.waytype, value => Number(value) === 6);
  const pedestrianWayMeters = totalFor(summaries.waytype, value => Number(value) === 7);
  const stepsMeters = totalFor(summaries.waytype, value => Number(value) === 8);
  const ferryMeters = totalFor(summaries.waytype, value => Number(value) === 9);
  const constructionMeters = totalFor(summaries.waytype, value => Number(value) === 10);
  const noisyMeters = totalFor(summaries.noise, value => Number(value) >= 7);
  const lowGreenMeters = totalFor(summaries.green, value => Number(value) <= 3);
  const lowSuitabilityMeters = totalFor(summaries.suitability, value => Number(value) <= 3);
  // The hosted foot-walking service may not provide every optional extra-info
  // layer (notably access restrictions). Missing data is unknown, not evidence
  // that a route is unrestricted or especially suitable.
  const qualityDataAvailable = {
    waytype: Array.isArray(summaries.waytype?.summary),
    suitability: Array.isArray(summaries.suitability?.summary),
    green: Array.isArray(summaries.green?.summary),
    noise: Array.isArray(summaries.noise?.summary),
    accessRestrictions: Array.isArray(summaries.access?.summary)
  };
  // ORS encodes access restrictions as bit flags: no=1, customers=2,
  // destination=4, delivery=8, private=16, permissive=32, permit=64.
  const restrictedMeters = totalFor(summaries.access, value => {
    const flags = Number(value);
    return (flags & (1 | 2 | 4 | 8 | 16 | 64)) !== 0;
  });
  const missingQualityLayers = ["waytype", "suitability", "green", "noise"]
    .filter(key => !qualityDataAvailable[key]).length;
  const missingQualityPenalty = missingQualityLayers * meters * 0.25;
  // Reject motorway/primary/state-road travel and inaccessible segments.
  // Among remaining candidates, prefer residential streets and pedestrian
  // infrastructure over secondary/tertiary roads, noisy segments and poor
  // walking-suitability sections. These are map-derived estimates, not guarantees.
  const unsafeMajorRoad = highwayMeters > 10 || stateRoadMeters > 10;
  const hasRestrictedAccess = restrictedMeters > 5;
  const qualityPenalty =
    generalRoadMeters * 1.5 +
    residentialStreetMeters * 0.05 +
    pathMeters * 0.02 +
    trackMeters * 0.12 +
    cyclewayMeters * 0.18 +
    pedestrianWayMeters * 0.01 +
    stepsMeters * 0.3 +
    ferryMeters * 5 +
    constructionMeters * 8 +
    noisyMeters * 3 +
    lowGreenMeters * 0.2 +
    lowSuitabilityMeters * 1.5 +
    missingQualityPenalty;
  const safetyPenalty = (highwayMeters * 100) + (stateRoadMeters * 80) +
    (restrictedMeters * 150) + qualityPenalty;
  return { coordinates: coords, meters, safety: {
    highwayMeters, stateRoadMeters, generalRoadMeters, residentialStreetMeters,
    pathMeters, trackMeters, cyclewayMeters, pedestrianWayMeters, stepsMeters,
    ferryMeters, constructionMeters, noisyMeters, lowGreenMeters, lowSuitabilityMeters,
    restrictedMeters, unsafeMajorRoad, hasRestrictedAccess,
    qualityDataAvailable, missingQualityLayers, missingQualityPenalty,
    qualityPenalty, safetyPenalty
  } };
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function pointOnSegment(p, a, b) {
  const eps = 1e-10;
  return Math.abs(orientation(a, b, p)) <= eps &&
    p[0] >= Math.min(a[0], b[0]) - eps && p[0] <= Math.max(a[0], b[0]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps && p[1] <= Math.max(a[1], b[1]) + eps;
}
function segmentsProperlyIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
    ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

// A route vertex on a road is a crossing only when the route enters and
// leaves on opposite sides. Merely starting, ending, or turning alongside
// a mapped road does not count as a crossing.
function routeCrossesRoadVertex(path, roadSegments) {
  for (let i = 1; i < path.length - 1; i++) {
    const previous = path[i - 1], vertex = path[i], next = path[i + 1];
    for (const segment of roadSegments) {
      if (vertex[0] < segment.minX - 1e-10 || vertex[0] > segment.maxX + 1e-10 ||
          vertex[1] < segment.minY - 1e-10 || vertex[1] > segment.maxY + 1e-10 ||
          !pointOnSegment(vertex, segment.a, segment.b)) continue;
      const before = orientation(segment.a, segment.b, previous);
      const after = orientation(segment.a, segment.b, next);
      if ((before > 1e-10 && after < -1e-10) ||
          (before < -1e-10 && after > 1e-10)) return true;
    }
  }
  return false;
}
// Use the dedicated overpass.ch service for predictable, per-account
// capacity. OVERPASS_CH_API_KEY is read only on the server and never returned.
async function fetchOverpass(query, purpose, timeoutMs) {
  const apiKey = process.env.OVERPASS_CH_API_KEY;
  if (!apiKey) {
    throw new Error("Map-data service is not configured. Add OVERPASS_CH_API_KEY to the Netlify environment for this deploy preview.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = "https://api.overpass.ch/v1/" + encodeURIComponent(apiKey) + "/interpreter";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
      signal: controller.signal
    });
    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); }
    catch {
      throw new Error("The dedicated map-data service returned an unreadable response (HTTP " + response.status + ").");
    }
    if (!response.ok) {
      const detail = data.error || data.message || data.status || ("HTTP " + response.status);
      throw new Error("The dedicated map-data service rejected the request: " +
        (typeof detail === "string" ? detail : JSON.stringify(detail)));
    }
    if (typeof data?.remark === "string" && data.remark.trim()) {
      throw new Error("The dedicated map-data service returned incomplete map data: " + data.remark);
    }
    if (!Array.isArray(data?.elements)) {
      throw new Error("The dedicated map-data service returned an invalid map-data response.");
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(purpose + " could not be verified because the dedicated map-data service timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function screenMajorRoadCrossings(candidates) {
  if (!candidates.length) return candidates;
  // Accumulate bounds without spreading large coordinate arrays into Math.min/max.
  // Long routes can contain enough vertices to exceed a JavaScript argument limit.
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const route of candidates) {
    for (const point of route.coordinates || []) {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      west = Math.min(west, point[0]);
      east = Math.max(east, point[0]);
      south = Math.min(south, point[1]);
      north = Math.max(north, point[1]);
    }
  }
  if (![south, west, north, east].every(Number.isFinite)) {
    throw new Error("Could not verify nearby road crossings because route geometry was incomplete.");
  }
  const pad = 0.0015;
  south -= pad; west -= pad; north += pad; east += pad;
  const query = `[out:json][timeout:8];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"][!"bridge"][!"tunnel"](${south},${west},${north},${east});out geom;`;
  const data = await fetchOverpass(query, "Nearby road crossings", 10000);
  if (data.elements.length === 0) {
    throw new Error("Could not verify nearby road crossings because map data was incomplete. Please try again.");
  }
  const roads = data.elements.filter(el => el.type === "way" && Array.isArray(el.geometry))
    .map((el, roadId) => ({
      id: roadId, highway: el.tags?.highway,
      segments: el.geometry.slice(1).map((p, index) => {
        const a = [el.geometry[index].lon, el.geometry[index].lat];
        const b = [p.lon, p.lat];
        return { a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
          minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) };
      })
    }));
  if (!roads.length) throw new Error("Could not verify nearby road crossings because no road geometry was returned.");
  return candidates.map(route => {
    let majorCrossings = 0, secondaryCrossings = 0, tertiaryCrossings = 0;
    const path = route.coordinates || [];
    const hitRoads = new Set();
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
      const minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
      for (const road of roads) {
        if (hitRoads.has(road.id)) continue;
        const nearbySegments = road.segments.filter(segment =>
          segment.maxX >= minX && segment.minX <= maxX &&
          segment.maxY >= minY && segment.minY <= maxY);
        const hit = nearbySegments.some(segment =>
          segmentsProperlyIntersect(a, b, segment.a, segment.b));
        if (hit) hitRoads.add(road.id);
      }
    }
    for (const road of roads) {
      if (hitRoads.has(road.id)) continue;
      if (routeCrossesRoadVertex(path, road.segments)) hitRoads.add(road.id);
    }
    for (const roadId of hitRoads) {
      const highway = roads[roadId].highway;
      if (["motorway", "trunk", "primary"].includes(highway)) majorCrossings++;
      else if (highway === "secondary") secondaryCrossings++;
      else if (highway === "tertiary") tertiaryCrossings++;
    }
    return { ...route, safety: { ...route.safety,
      majorRoadCrossings: majorCrossings, secondaryRoadCrossings: secondaryCrossings,
      tertiaryRoadCrossings: tertiaryCrossings, crossingCheck: "completed",
      safetyPenalty: route.safety.safetyPenalty + majorCrossings * 100000 +
        secondaryCrossings * 50000 + tertiaryCrossings * 5000 } };
  }).filter(route => route.safety.majorRoadCrossings === 0 && route.safety.secondaryRoadCrossings === 0);
}


function pointSegmentDistanceMeters(point, a, b) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(point[1] * Math.PI / 180);
  const px = point[0] * lonScale, py = point[1] * latScale;
  const ax = a[0] * lonScale, ay = a[1] * latScale;
  const bx = b[0] * lonScale, by = b[1] * latScale;
  const dx = bx - ax, dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

async function scorePedestrianInfrastructure(candidates) {
  if (!candidates.length) return candidates;
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const route of candidates) for (const point of route.coordinates || []) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    west = Math.min(west, point[0]); east = Math.max(east, point[0]);
    south = Math.min(south, point[1]); north = Math.max(north, point[1]);
  }
  if (![south, west, north, east].every(Number.isFinite)) {
    throw new Error("Could not verify pedestrian infrastructure because route geometry was incomplete.");
  }
  const pad = 0.001;
  south -= pad; west -= pad; north += pad; east += pad;
  // Collect separately mapped sidewalks/footpaths and carriageways carrying
  // an explicit sidewalk tag. Missing tags remain unknown, not "no sidewalk".
  const query = `[out:json][timeout:10];
(
 way["highway"~"^(footway|path|pedestrian|steps)$"](${south},${west},${north},${east});
 way["highway"]["sidewalk"~"^(yes|both|left|right|separate)$"](${south},${west},${north},${east});
 way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|service)$"]["sidewalk"="no"](${south},${west},${north},${east});
 way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|service)$"]["sidewalk:both"="no"](${south},${west},${north},${east});
 way["highway"]["sidewalk:both"~"^(yes|separate)$"](${south},${west},${north},${east});
 way["highway"]["sidewalk:left"~"^(yes|separate)$"](${south},${west},${north},${east});
 way["highway"]["sidewalk:right"~"^(yes|separate)$"](${south},${west},${north},${east});
);
out tags geom;`;
  const data = await fetchOverpass(query, "Pedestrian infrastructure", 12000);

  const features = data.elements.filter(el => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 1)
    .map(el => {
      const tags = el.tags || {};
      const footway = ["footway", "path", "pedestrian", "steps"].includes(tags.highway);
      const sidewalkTagged = ["yes", "both", "left", "right", "separate"].includes(tags.sidewalk) ||
        ["yes", "separate"].includes(tags["sidewalk:both"]) ||
        ["yes", "separate"].includes(tags["sidewalk:left"]) ||
        ["yes", "separate"].includes(tags["sidewalk:right"]);
      const sidewalkExplicitlyAbsent = tags.sidewalk === "no" || tags["sidewalk:both"] === "no";
      const segments = el.geometry.slice(1).map((p, i) => ({
        a: [el.geometry[i].lon, el.geometry[i].lat], b: [p.lon, p.lat]
      }));
      return { footway, sidewalkTagged, sidewalkExplicitlyAbsent, segments };
    });
  const dedicatedPathSegments = features.flatMap(feature => feature.footway ? feature.segments : []);
  const mappedSidewalkSegments = features.flatMap(feature => feature.sidewalkTagged ? feature.segments : []);
  const infrastructureSegments = [...dedicatedPathSegments, ...mappedSidewalkSegments];
  const explicitNoSidewalkSegments = features.flatMap(feature =>
    feature.sidewalkExplicitlyAbsent ? feature.segments : []);
  return candidates.map(route => {
    const sampleCount = Math.max(12, Math.min(120, Math.ceil(route.distanceMeters / 20)));
    const samples = sampleRoute(route.coordinates, sampleCount);
    const cumulative = [0];
    for (let i = 1; i < route.coordinates.length; i++) {
      cumulative.push(cumulative[i - 1] + haversineMeters(route.coordinates[i - 1], route.coordinates[i]));
    }
    const totalLength = cumulative[cumulative.length - 1] || route.distanceMeters;
    let supported = 0, currentGap = 0, longestUnsupportedGap = 0;
    let unsupportedLength = 0, previousSampleDistance = 0;
    let knownNoSidewalkSamples = 0, knownRoadSamples = 0, uncertainSamples = 0;
    let dedicatedPathSamples = 0, mappedSidewalkSamples = 0;
    for (let i = 0; i < samples.length; i++) {
      const point = samples[i];
      const sampleDistance = totalLength * i / Math.max(1, samples.length - 1);
      const stepLength = i === 0 ? 0 : sampleDistance - previousSampleDistance;
      previousSampleDistance = sampleDistance;
      const nearestTo = segments => {
        let nearest = Infinity;
        for (const segment of segments) {
          if (Math.abs(segment.a[1] - point[1]) > 0.00025 && Math.abs(segment.b[1] - point[1]) > 0.00025) continue;
          nearest = Math.min(nearest, pointSegmentDistanceMeters(point, segment.a, segment.b));
          if (nearest <= 18) break;
        }
        return nearest;
      };
      const nearestPath = nearestTo(dedicatedPathSegments);
      const nearestSidewalk = nearestTo(mappedSidewalkSegments);
      const nearest = Math.min(nearestPath, nearestSidewalk);
      if (nearestPath <= 18) dedicatedPathSamples++;
      else if (nearestSidewalk <= 18) mappedSidewalkSamples++;
      let explicitNoSidewalk = false;
      let nearestRoadWithoutSidewalk = Infinity;
      for (const segment of explicitNoSidewalkSegments) {
        if (Math.abs(segment.a[1] - point[1]) > 0.00025 && Math.abs(segment.b[1] - point[1]) > 0.00025) continue;
        nearestRoadWithoutSidewalk = Math.min(nearestRoadWithoutSidewalk, pointSegmentDistanceMeters(point, segment.a, segment.b));
        if (nearestRoadWithoutSidewalk <= 12) break;
      }
      explicitNoSidewalk = nearestRoadWithoutSidewalk <= 12;
      if (nearest <= 18) {
        supported++;
        currentGap = 0;
      } else {
        currentGap += stepLength;
        unsupportedLength += stepLength;
        longestUnsupportedGap = Math.max(longestUnsupportedGap, currentGap);
        if (explicitNoSidewalk) knownNoSidewalkSamples++;
        else uncertainSamples++;
      }
      if (explicitNoSidewalk) knownRoadSamples++;
    }
    const coverage = samples.length ? supported / samples.length : 0;
    const hasMappedInfrastructure = samples.length > 0 && (supported + knownNoSidewalkSamples + uncertainSamples) > 0;
    const unknown = supported === 0 && knownNoSidewalkSamples === 0;
    const unsupportedRatio = hasMappedInfrastructure ? 1 - coverage : 0;
    const knownNoSidewalkRatio = samples.length ? knownNoSidewalkSamples / samples.length : 0;
    // Explicit sidewalk=no is stronger negative evidence than an untagged gap.
    // Untagged locations remain uncertain and receive only a modest ranking
    // penalty. This still cannot prove a pedestrian must walk in the roadway.
    const gapPenalty = hasMappedInfrastructure
      ? Math.min(route.distanceMeters * 1.5, longestUnsupportedGap * 2.5)
      : 0;
    const infrastructurePenalty = unknown
      ? route.distanceMeters * 0.2
      : unsupportedRatio * route.distanceMeters * 0.55 +
        knownNoSidewalkRatio * route.distanceMeters * 1.4 + gapPenalty;
    return { ...route, safety: { ...route.safety,
      pedestrianInfrastructure: unknown ? "unknown" : coverage >= 0.75 && longestUnsupportedGap < 60 ? "strong-mapped-support" : coverage >= 0.4 && longestUnsupportedGap < 120 ? "partial-mapped-support" : "limited-mapped-support",
      pedestrianInfrastructureCoverage: hasMappedInfrastructure ? Math.round(coverage * 100) : null,
      longestMappedInfrastructureGapMeters: hasMappedInfrastructure ? Math.round(longestUnsupportedGap) : null,
      estimatedUnsupportedInfrastructureMeters: hasMappedInfrastructure ? Math.round(unsupportedLength) : null,
      explicitNoSidewalkCoverage: samples.length ? Math.round(knownNoSidewalkRatio * 100) : null,
      uncertainInfrastructureCoverage: samples.length ? Math.round(uncertainSamples / samples.length * 100) : null,
      dedicatedPathCoverage: samples.length ? Math.round(dedicatedPathSamples / samples.length * 100) : null,
      mappedSidewalkCoverage: samples.length ? Math.round(mappedSidewalkSamples / samples.length * 100) : null,
      pedestrianInfrastructurePenalty: infrastructurePenalty,
      safetyPenalty: route.safety.safetyPenalty + infrastructurePenalty
    }};
  });
}

function haversineMeters(a, b) {
  const R = 6371000, rad = value => value * Math.PI / 180;
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const lat1 = rad(a[1]), lat2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function withinNeighborhood(route, start, targetMeters) {
  // Keep return-to-start routes in a compact local area. One-way routes get
  // a larger radius because their destination is intentionally away from start.
  const limit = route.type === "oneway" ? targetMeters + 100 : targetMeters * 0.6 + 100;
  let farthest = 0;
  for (const point of route.coordinates) {
    farthest = Math.max(farthest, haversineMeters(start, point));
  }
  route.safety = { ...route.safety, neighborhoodRadiusMeters: farthest,
    neighborhoodLimitMeters: limit };
  return farthest <= limit;
}

function sampleRoute(coords, maxSamples = 32) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  // Sample by traveled distance rather than vertex index. Routing providers
  // may emit dense geometry on curves and sparse geometry on straightaways;
  // index sampling can otherwise bias the route-similarity comparison.
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  }
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0) return [coords[0], coords[coords.length - 1]];
  const samples = [];
  let segmentIndex = 1;
  for (let sampleIndex = 0; sampleIndex < maxSamples; sampleIndex++) {
    const target = total * sampleIndex / (maxSamples - 1);
    while (segmentIndex < cumulative.length - 1 && cumulative[segmentIndex] < target) segmentIndex++;
    const startDistance = cumulative[segmentIndex - 1];
    const segmentLength = cumulative[segmentIndex] - startDistance;
    const ratio = segmentLength > 0 ? (target - startDistance) / segmentLength : 0;
    const a = coords[segmentIndex - 1], b = coords[segmentIndex];
    samples.push([
      a[0] + (b[0] - a[0]) * ratio,
      a[1] + (b[1] - a[1]) * ratio
    ]);
  }
  return samples;
}

function routesAreNearDuplicates(routeA, routeB) {
  const a = sampleRoute(routeA.coordinates), b = sampleRoute(routeB.coordinates);
  if (!a.length || !b.length) return false;
  const withinThreshold = (points, other) => {
    let close = 0;
    for (const point of points) {
      let nearest = Infinity;
      for (const candidate of other) {
        nearest = Math.min(nearest, haversineMeters(point, candidate));
        if (nearest <= 30) break;
      }
      if (nearest <= 30) close++;
    }
    return close / points.length;
  };
  // Compare both directions so a route and its reverse are treated alike.
  return withinThreshold(a, b) >= 0.75 && withinThreshold(b, a) >= 0.75;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST for route requests." });
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return json(503, { error: "Route generation is not configured yet. The site owner must add ORS_API_KEY in Netlify." });

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "The request body must be valid JSON." }); }
  const lat = Number(input.latitude), lon = Number(input.longitude), distance = Number(input.distanceMeters), type = input.routeType;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return json(400, { error: "A valid starting GPS location is required." });
  if (!Number.isFinite(distance) || distance < 300 || distance > 50000) return json(400, { error: "Choose a distance between 300 meters and 50 kilometers." });
  if (type !== "loop" && type !== "outback" && type !== "oneway") return json(400, { error: "Choose Out-and-back, One-way, or Loop to generate a route." });

  try {
    const start = [lon, lat];
    if (type === "outback") {
      const candidates = [];
      let providerFailure = null;
      // Route each candidate on the pedestrian network, then tune the outbound
      // endpoint against the actual routed distance. The return retraces that
      // same network path, making the turn-around the true route midpoint.
      const bearings = Array.from({ length: 8 }, (_, index) => index * 45);
      const candidateResults = await Promise.all(bearings.map(async bearing => {
        let endpointDistance = distance / 2 / 1.25;
        let best = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            const endpoint = destinationPoint(lat, lon, endpointDistance, bearing);
            const outbound = await getRoute([start, endpoint], apiKey);
            const total = outbound.meters * 2;
            if (!best || Math.abs(total - distance) < Math.abs(best.meters * 2 - distance)) best = outbound;
            const ratio = (distance / 2) / outbound.meters;
            if (Math.abs(total - distance) <= MAX_ROUTE_DISTANCE_ERROR_METERS) break;
            endpointDistance *= Math.max(0.65, Math.min(1.5, ratio));
          } catch (error) {
            providerFailure = error.message || "The routing service could not create this route.";
            if (attempt === 5 && !best) break;
            endpointDistance *= 0.75;
          }
        }
        if (!best || best.safety.unsafeMajorRoad || best.safety.hasRestrictedAccess) return null;
        const returnCoordinates = [...best.coordinates].reverse().slice(1);
        const fullCoordinates = [...best.coordinates, ...returnCoordinates];
        const totalMeters = best.meters * 2;
        return {
          id: "outback-" + bearing, type: "outback", distanceMeters: totalMeters,
          outboundDistanceMeters: best.meters, coordinates: fullCoordinates,
          turnaround: best.coordinates[best.coordinates.length - 1],
          label: "Out-and-back", differenceMeters: Math.abs(totalMeters - distance),
          differencePercent: Math.round(Math.abs(totalMeters - distance) / distance * 100),
          safety: best.safety
        };
      }));
      candidates.push(...candidateResults.filter(Boolean));
      const crossingScreened = await screenMajorRoadCrossings(candidates);
      const screenedCandidates = (await scorePedestrianInfrastructure(crossingScreened))
        .filter(route => withinNeighborhood(route, start, distance))
        .filter(route => route.differenceMeters <= MAX_ROUTE_DISTANCE_ERROR_METERS);
      candidates.length = 0;
      candidates.push(...screenedCandidates);
      candidates.sort((a, b) => a.safety.safetyPenalty - b.safety.safetyPenalty || a.differenceMeters - b.differenceMeters);
      const distinct = [];
      for (const candidate of candidates) {
        if (distinct.some(existing => routesAreNearDuplicates(existing, candidate))) continue;
        distinct.push(candidate);
        if (distinct.length === 3) break;
      }
      if (!distinct.length && providerFailure) return json(502, { error: "The routing service could not generate routes: " + providerFailure });
      if (!distinct.length) return json(422, { error: "No out-and-back route passed the available map checks within 0.05 miles of your requested distance. Try another distance or starting point." });
      return json(200, { routes: distinct, targetDistanceMeters: distance, toleranceMeters: MAX_ROUTE_DISTANCE_ERROR_METERS });
    }

    if (type === "oneway") {
      const candidates = [];
      let providerFailure = null;
      const bearings = [0, 60, 120, 180, 240, 300];
      const candidateResults = await Promise.all(bearings.map(async bearing => {
        let endpointDistance = distance / 1.25, best = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const endpoint = destinationPoint(lat, lon, endpointDistance, bearing);
            const route = await getRoute([start, endpoint], apiKey);
            if (!best || Math.abs(route.meters - distance) < Math.abs(best.meters - distance)) best = route;
            const ratio = distance / route.meters;
            if (Math.abs(route.meters - distance) <= MAX_ROUTE_DISTANCE_ERROR_METERS) break;
            endpointDistance *= Math.max(.55, Math.min(1.65, ratio));
          } catch (error) { providerFailure = error.message || "The routing service could not create this route."; endpointDistance *= .75; }
        }
        if (!best || best.safety.unsafeMajorRoad || best.safety.hasRestrictedAccess) return null;
        return { id: "oneway-" + bearing, type: "oneway", distanceMeters: best.meters, coordinates: best.coordinates, label: "One-way destination", differenceMeters: Math.abs(best.meters - distance), differencePercent: Math.round(Math.abs(best.meters - distance) / distance * 100), safety: best.safety };
      }));
      candidates.push(...candidateResults.filter(Boolean));
      const crossingScreened = await screenMajorRoadCrossings(candidates);
      const screenedCandidates = (await scorePedestrianInfrastructure(crossingScreened))
        .filter(route => withinNeighborhood(route, start, distance))
        .filter(route => route.differenceMeters <= MAX_ROUTE_DISTANCE_ERROR_METERS);
      candidates.length = 0;
      candidates.push(...screenedCandidates);
      candidates.sort((a, b) => a.safety.safetyPenalty - b.safety.safetyPenalty || a.differenceMeters - b.differenceMeters);
      const distinct = [];
      for (const candidate of candidates) {
        if (distinct.some(existing => routesAreNearDuplicates(existing, candidate))) continue;
        distinct.push(candidate);
        if (distinct.length === 3) break;
      }
      if (!distinct.length && providerFailure) return json(502, { error: "The routing service could not generate routes: " + providerFailure });
      if (!distinct.length) return json(422, { error: "No one-way route passed the available map checks within 0.05 miles of your requested distance. Try another distance or starting point." });
      return json(200, { routes: distinct, targetDistanceMeters: distance, toleranceMeters: MAX_ROUTE_DISTANCE_ERROR_METERS });
    }

    // Tune three loop orientations against the routed pedestrian-network
    // distance. The first route is not assumed to match the requested distance.
    const candidates = [];
    let providerFailure = null;
    const bearings = [0, 60, 120, 180, 240, 300];
    const candidateResults = await Promise.all(bearings.map(async bearing => {
      let radius = distance / 5.2;
      let best = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const points = [start];
        for (let i = 0; i < 3; i++) points.push(destinationPoint(lat, lon, radius, bearing + i * 120));
        points.push(start);
        try {
          const route = await getRoute(points, apiKey);
          if (!best || Math.abs(route.meters - distance) < Math.abs(best.meters - distance)) best = route;
          const ratio = distance / route.meters;
          if (Math.abs(route.meters - distance) <= MAX_ROUTE_DISTANCE_ERROR_METERS) break;
          radius *= Math.max(0.65, Math.min(1.45, ratio));
        } catch (error) { providerFailure = error.message || "The routing service could not create this route."; radius *= 0.8; }
      }
      if (!best || best.safety.unsafeMajorRoad || best.safety.hasRestrictedAccess) return null;
      return { id: "loop-" + bearing, type: "loop", distanceMeters: best.meters, coordinates: best.coordinates, label: "Loop", differenceMeters: Math.abs(best.meters - distance), differencePercent: Math.round(Math.abs(best.meters - distance) / distance * 100), safety: best.safety };
    }));
    candidates.push(...candidateResults.filter(Boolean));
    const crossingScreened = await screenMajorRoadCrossings(candidates);
      const screenedCandidates = (await scorePedestrianInfrastructure(crossingScreened))
        .filter(route => withinNeighborhood(route, start, distance))
        .filter(route => route.differenceMeters <= MAX_ROUTE_DISTANCE_ERROR_METERS);
      candidates.length = 0;
      candidates.push(...screenedCandidates);
      candidates.sort((a, b) => a.safety.safetyPenalty - b.safety.safetyPenalty || a.differenceMeters - b.differenceMeters);
    const distinctLoops = [];
    for (const candidate of candidates) {
      if (distinctLoops.some(existing => routesAreNearDuplicates(existing, candidate))) continue;
      distinctLoops.push(candidate);
      if (distinctLoops.length === 3) break;
    }
    if (!distinctLoops.length && providerFailure) return json(502, { error: "The routing service could not generate routes: " + providerFailure });
    if (!distinctLoops.length) return json(422, { error: "No loop passed the available map checks within 0.05 miles of your requested distance. Try another distance or starting point." });
    return json(200, { routes: distinctLoops, targetDistanceMeters: distance, toleranceMeters: MAX_ROUTE_DISTANCE_ERROR_METERS });
  } catch (error) {
    return json(502, { error: error.message || "The routing service is temporarily unavailable." });
  }
};
