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
    body: JSON.stringify({ coordinates, instructions: false, preference: "recommended", units: "m" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.error || payload.message || "The routing service could not create this route.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  const feature = payload.features?.[0], coords = feature?.geometry?.coordinates, meters = feature?.properties?.summary?.distance;
  if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(meters)) throw new Error("The routing service returned an incomplete route.");
  return { coordinates: coords, meters };
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
  if (type !== "loop" && type !== "outback") return json(400, { error: "Choose Loop or Out-and-back to generate a route." });

  try {
    const start = [lon, lat];
    if (type === "outback") {
      // Route each candidate on the pedestrian network, then tune the outbound
      // endpoint against the actual routed distance. The return retraces that
      // same network path, making the turn-around the true route midpoint.
      const bearings = [0, 60, 120, 180, 240, 300];
      const candidates = [];
      for (const bearing of bearings) {
        let endpointDistance = distance / 2 / 1.25;
        let best = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const endpoint = destinationPoint(lat, lon, endpointDistance, bearing);
            const outbound = await getRoute([start, endpoint], apiKey);
            const total = outbound.meters * 2;
            if (!best || Math.abs(total - distance) < Math.abs(best.meters * 2 - distance)) best = outbound;
            const ratio = (distance / 2) / outbound.meters;
            if (Math.abs(total - distance) <= MAX_OUTBACK_ERROR_METERS) break;
            endpointDistance *= Math.max(0.55, Math.min(1.65, ratio));
          } catch (error) {
            if (attempt === 2 && !best) break;
            endpointDistance *= 0.75;
          }
        }
        if (!best) continue;
        const returnCoordinates = [...best.coordinates].reverse().slice(1);
        const fullCoordinates = [...best.coordinates, ...returnCoordinates];
        const totalMeters = best.meters * 2;
        candidates.push({
          id: "outback-" + bearing, type: "outback", distanceMeters: totalMeters,
          outboundDistanceMeters: best.meters, coordinates: fullCoordinates,
          turnaround: best.coordinates[best.coordinates.length - 1],
          label: "Out-and-back", differenceMeters: Math.abs(totalMeters - distance),
          differencePercent: Math.round(Math.abs(totalMeters - distance) / distance * 100)
        });
      }
      candidates.sort((a, b) => a.differenceMeters - b.differenceMeters);
      const distinct = [];
      const signatures = [];
      for (const candidate of candidates) {
        const signature = routeSignature(candidate.coordinates);
        if (signatures.some(s => s === signature)) continue;
        signatures.push(signature);
        distinct.push(candidate);
        if (distinct.length === 3) break;
      }
      if (!distinct.length) return json(422, { error: "No walkable out-and-back routes could be found. Try another distance or starting point." });
      return json(200, { routes: distinct, targetDistanceMeters: distance, toleranceMeters: MAX_OUTBACK_ERROR_METERS });
    }

    const radiusBase = distance / 5.2, candidates = [];
    const attempts = [{ bearing: 0, scale: .82 }, { bearing: 60, scale: .82 }, { bearing: 120, scale: .82 }, { bearing: 0, scale: 1.08 }, { bearing: 60, scale: 1.08 }, { bearing: 120, scale: 1.08 }];
    for (const attempt of attempts) {
      const radius = radiusBase * attempt.scale, points = [start];
      for (let i = 0; i < 3; i++) points.push(destinationPoint(lat, lon, radius, attempt.bearing + i * 120));
      points.push(start);
      try {
        const route = await getRoute(points, apiKey);
        candidates.push({ id: "loop-" + (candidates.length + 1), type: "loop", distanceMeters: route.meters, coordinates: route.coordinates, label: "Loop", differenceMeters: Math.abs(route.meters - distance), differencePercent: Math.round(Math.abs(route.meters - distance) / distance * 100) });
      } catch (error) { /* Try the next loop orientation. */ }
    }
    candidates.sort((a, b) => a.differenceMeters - b.differenceMeters);
    if (!candidates.length) return json(422, { error: "No walkable loop could be found near this location. Try a different distance or starting point." });
    return json(200, { routes: candidates.slice(0, 3), targetDistanceMeters: distance });
  } catch (error) {
    return json(502, { error: error.message || "The routing service is temporarily unavailable." });
  }
};
