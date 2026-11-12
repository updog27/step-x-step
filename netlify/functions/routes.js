const ORS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";
const MAX_OUTBACK_ERROR_METERS = 80.5; // 0.05 miles

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
      extra_info: ["waycategory", "waytype", "noise", "roadaccessrestrictions"]
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
    access: extras.roadaccessrestrictions
  };
  const totalFor = (extra, predicate) => (extra?.summary || [])
    .filter(item => predicate(item.value))
    .reduce((sum, item) => sum + (Number(item.distance) || 0), 0);
  const highwayMeters = totalFor(summaries.waycategory, value => (Number(value) & 1) === 1);
  const stateRoadMeters = totalFor(summaries.waytype, value => Number(value) === 1);
  const secondaryRoadMeters = totalFor(summaries.waytype, value => Number(value) === 2);
  const noisyMeters = totalFor(summaries.noise, value => Number(value) >= 7);
  // ORS encodes access restrictions as bit flags: no=1, customers=2,
  // destination=4, delivery=8, private=16, permissive=32, permit=64.
  const restrictedMeters = totalFor(summaries.access, value => {
    const flags = Number(value);
    return (flags & (1 | 2 | 4 | 8 | 16 | 64)) !== 0;
  });
  // Reject motorway links and primary/state-road segments; downgrade secondary
  // roads and noisy segments. This is a conservative map-data screen, not a
  // guarantee that every street crossing or access restriction is mapped.
  const unsafeMajorRoad = highwayMeters > 10 || stateRoadMeters > 10;
  const hasRestrictedAccess = restrictedMeters > 5;
  const safetyPenalty = (highwayMeters * 100) + (stateRoadMeters * 80) +
    (restrictedMeters * 150) + (secondaryRoadMeters * 0.15) + (noisyMeters * 2);
  return { coordinates: coords, meters, safety: {
    highwayMeters, stateRoadMeters, secondaryRoadMeters, noisyMeters,
    restrictedMeters, unsafeMajorRoad, hasRestrictedAccess, safetyPenalty
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
function routeCrossesRoad(path, roadSegments) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    for (const segment of roadSegments) {
      if (segmentsProperlyIntersect(a, b, segment.a, segment.b)) return true;
    }
  }
  for (let i = 1; i < path.length - 1; i++) {
    const previous = path[i - 1], vertex = path[i], next = path[i + 1];
    for (const segment of roadSegments) {
      if (!pointOnSegment(vertex, segment.a, segment.b)) continue;
      const before = orientation(segment.a, segment.b, previous);
      const after = orientation(segment.a, segment.b, next);
      if ((before > 1e-10 && after < -1e-10) ||
          (before < -1e-10 && after > 1e-10)) return true;
    }
  }
  return false;
}
async function screenMajorRoadCrossings(candidates) {
  if (!candidates.length) return candidates;
  const points = candidates.flatMap(route => route.coordinates || []);
  const lats = points.map(p => p[1]), lons = points.map(p => p[0]);
  const pad = 0.0015;
  const south = Math.min(...lats) - pad, west = Math.min(...lons) - pad;
  const north = Math.max(...lats) + pad, east = Math.max(...lons) + pad;
  const query = `[out:json][timeout:8];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["bridge"!="yes"]["tunnel"!="yes"](${south},${west},${north},${east});out geom;`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  let data;
  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query), signal: controller.signal
    });
    if (!response.ok) throw new Error("Major-road crossing data is temporarily unavailable.");
    data = await response.json();
  } catch (error) {
    throw new Error("Could not verify nearby road crossings. Please try again. " + (error.name === "AbortError" ? "The map service timed out." : error.message));
  } finally { clearTimeout(timeout); }
  if (typeof data?.remark === "string" && data.remark.trim()) {
    throw new Error("The road map service returned an incomplete result. Please try again.");
  }
  if (!Array.isArray(data?.elements) || data.elements.length === 0) {
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
      if (routeCrossesRoad(path, road.segments)) hitRoads.add(road.id);
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
  const farthest = Math.max(...route.coordinates.map(point => haversineMeters(start, point)));
  route.safety = { ...route.safety, neighborhoodRadiusMeters: farthest,
    neighborhoodLimitMeters: limit };
  return farthest <= limit;
}

function routeSignature(coords) {
  return coords.filter((_, i) => i % Math.max(1, Math.floor(coords.length / 12)) === 0)
    .map(([x, y]) => x.toFixed(4) + "," + y.toFixed(4)).join("|");
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
            if (Math.abs(total - distance) <= MAX_OUTBACK_ERROR_METERS) break;
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
      const screenedCandidates = (await screenMajorRoadCrossings(candidates))
        .filter(route => withinNeighborhood(route, start, distance));
      candidates.length = 0;
      candidates.push(...screenedCandidates);
      candidates.sort((a, b) => a.safety.safetyPenalty - b.safety.safetyPenalty || a.differenceMeters - b.differenceMeters);
      const distinct = [];
      const signatures = [];
      for (const candidate of candidates) {
        const signature = routeSignature(candidate.coordinates);
        if (signatures.some(s => s === signature)) continue;
        signatures.push(signature);
        distinct.push(candidate);
        if (distinct.length === 3) break;
      }
      if (!distinct.length && providerFailure) return json(502, { error: "The routing service could not generate routes: " + providerFailure });
      if (!distinct.length) return json(422, { error: "No walkable out-and-back routes could be found. Try another distance or starting point." });
      return json(200, { routes: distinct, targetDistanceMeters: distance, toleranceMeters: MAX_OUTBACK_ERROR_METERS });
    }

    if (type === "oneway") {
      const candidates = [];
      let providerFailure = null;
      const bearings = [0, 120, 240];
      const candidateResults = await Promise.all(bearings.map(async bearing => {
        let endpointDistance = distance / 1.25, best = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const endpoint = destinationPoint(lat, lon, endpointDistance, bearing);
            const route = await getRoute([start, endpoint], apiKey);
            if (!best || Math.abs(route.meters - distance) < Math.abs(best.meters - distance)) best = route;
            const ratio = distance / route.meters;
            if (Math.abs(route.meters - distance) <= MAX_OUTBACK_ERROR_METERS) break;
            endpointDistance *= Math.max(.55, Math.min(1.65, ratio));
          } catch (error) { providerFailure = error.message || "The routing service could not create this route."; endpointDistance *= .75; }
        }
        if (!best || best.safety.unsafeMajorRoad || best.safety.hasRestrictedAccess) return null;
        return { id: "oneway-" + bearing, type: "oneway", distanceMeters: best.meters, coordinates: best.coordinates, label: "One-way destination", differenceMeters: Math.abs(best.meters - distance), differencePercent: Math.round(Math.abs(best.meters - distance) / distance * 100), safety: best.safety };
      }));
      candidates.push(...candidateResults.filter(Boolean));
      const screenedCandidates = (await screenMajorRoadCrossings(candidates))
        .filter(route => withinNeighborhood(route, start, distance));
      candidates.length = 0;
      candidates.push(...screenedCandidates);
      candidates.sort((a, b) => a.safety.safetyPenalty - b.safety.safetyPenalty || a.differenceMeters - b.differenceMeters);
      const distinct = [];
      const signatures = [];
      for (const candidate of candidates) {
        const signature = routeSignature(candidate.coordinates);
        if (signatures.includes(signature)) continue;
        signatures.push(signature);
        distinct.push(candidate);
        if (distinct.length === 3) break;
      }
      if (!distinct.length && providerFailure) return json(502, { error: "The routing service could not generate routes: " + providerFailure });
      if (!distinct.length) return json(422, { error: "No walkable one-way destinations could be found. Try another distance or starting point." });
      return json(200, { routes: distinct, targetDistanceMeters: distance, toleranceMeters: MAX_OUTBACK_ERROR_METERS });
    }

    // Tune three loop orientations against the routed pedestrian-network
    // distance. The first route is not assumed to match the requested distance.
    const candidates = [];
    let providerFailure = null;
    const bearings = [0, 120, 240];
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
          if (Math.abs(route.meters - distance) <= MAX_OUTBACK_ERROR_METERS) break;
          radius *= Math.max(0.65, Math.min(1.45, ratio));
        } catch (error) { providerFailure = error.message || "The routing service could not create this route."; radius *= 0.8; }
      }
      if (!best || best.safety.unsafeMajorRoad || best.safety.hasRestrictedAccess) return null;
      return { id: "loop-" + bearing, type: "loop", distanceMeters: best.meters, coordinates: best.coordinates, label: "Loop", differenceMeters: Math.abs(best.meters - distance), differencePercent: Math.round(Math.abs(best.meters - distance) / distance * 100), safety: best.safety };
    }));
    candidates.push(...candidateResults.filter(Boolean));
    const screenedCandidates = (await screenMajorRoadCrossings(candidates))
        .filter(route => withinNeighborhood(route, start, distance));
      candidates.length = 0;
      candidates.push(...screenedCandidates);
      candidates.sort((a, b) => a.safety.safetyPenalty - b.safety.safetyPenalty || a.differenceMeters - b.differenceMeters);
    const distinctLoops = [];
    const loopSignatures = [];
    for (const candidate of candidates) {
      const signature = routeSignature(candidate.coordinates);
      if (loopSignatures.includes(signature)) continue;
      loopSignatures.push(signature);
      distinctLoops.push(candidate);
      if (distinctLoops.length === 3) break;
    }
    if (!distinctLoops.length && providerFailure) return json(502, { error: "The routing service could not generate routes: " + providerFailure });
    if (!distinctLoops.length) return json(422, { error: "No walkable loop could be found near this location. Try a different distance or starting point." });
    return json(200, { routes: distinctLoops, targetDistanceMeters: distance, toleranceMeters: MAX_OUTBACK_ERROR_METERS });
  } catch (error) {
    return json(502, { error: error.message || "The routing service is temporarily unavailable." });
  }
};
