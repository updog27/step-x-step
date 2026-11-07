const ORS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function destinationPoint(lat, lon, distanceMeters, bearingDegrees) {
  const R = 6371000;
  const bearing = bearingDegrees * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const angular = distanceMeters / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [((lon2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI];
}

async function getRoute(coordinates, apiKey) {
  const response = await fetch(ORS_URL, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/geo+json"
    },
    body: JSON.stringify({
      coordinates,
      instructions: false,
      preference: "recommended",
      units: "m"
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.error || payload.message ||
      "The routing service could not create this route.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  const feature = payload.features?.[0];
  const coordinatesOut = feature?.geometry?.coordinates;
  const meters = feature?.properties?.summary?.distance;
  if (!Array.isArray(coordinatesOut) || coordinatesOut.length < 2 || !Number.isFinite(meters)) {
    throw new Error("The routing service returned an incomplete route.");
  }

  return { coordinates: coordinatesOut, meters };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST for route requests." });

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return json(503, {
    error: "Route generation is not configured yet. The site owner must add ORS_API_KEY in Netlify."
  });

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "The request body must be valid JSON." });
  }

  const lat = Number(input.latitude);
  const lon = Number(input.longitude);
  const distance = Number(input.distanceMeters);
  const type = input.routeType;

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return json(400, { error: "A valid starting GPS location is required." });
  }
  if (!Number.isFinite(distance) || distance < 300 || distance > 50000) {
    return json(400, { error: "Choose a distance between 300 meters and 50 kilometers." });
  }
  if (type !== "loop" && type !== "outback") {
    return json(400, { error: "Choose Loop or Out-and-back to generate a route." });
  }

  try {
    const start = [lon, lat];
    if (type === "outback") {
      const oneWayMeters = distance / 2;
      const endpoint = destinationPoint(lat, lon, oneWayMeters, Number(input.bearing) || 45);
      const outbound = await getRoute([start, endpoint], apiKey);
      const returnCoordinates = [...outbound.coordinates].reverse().slice(1);
      const fullCoordinates = [...outbound.coordinates, ...returnCoordinates];
      return json(200, {
        routes: [{
          id: "outback-1",
          type: "outback",
          distanceMeters: outbound.meters * 2,
          coordinates: fullCoordinates,
          label: "Out-and-back"
        }]
      });
    }

    // Try several loop orientations and radii; keep the closest matches.
    const radiusBase = distance / 5.2;
    const candidates = [];
    const attempts = [
      { bearing: 0, scale: 0.82 },
      { bearing: 60, scale: 0.82 },
      { bearing: 120, scale: 0.82 },
      { bearing: 0, scale: 1.08 },
      { bearing: 60, scale: 1.08 },
      { bearing: 120, scale: 1.08 }
    ];

    for (const attempt of attempts) {
      const radius = radiusBase * attempt.scale;
      const points = [start];
      for (let i = 0; i < 3; i++) {
        points.push(destinationPoint(lat, lon, radius, attempt.bearing + i * 120));
      }
      points.push(start);
      try {
        const route = await getRoute(points, apiKey);
        const ratio = Math.abs(route.meters - distance) / distance;
        candidates.push({
          id: "loop-" + (candidates.length + 1),
          type: "loop",
          distanceMeters: route.meters,
          coordinates: route.coordinates,
          label: "Loop option",
          differencePercent: Math.round(ratio * 100)
        });
      } catch (error) {
        // A single inaccessible waypoint should not prevent other candidates.
      }
    }

    if (!candidates.length) {
      return json(422, { error: "No walkable loop could be found near this location. Try a different distance or starting point." });
    }

    candidates.sort((a, b) =>
      Math.abs(a.distanceMeters - distance) - Math.abs(b.distanceMeters - distance)
    );
    return json(200, { routes: candidates.slice(0, 3) });
  } catch (error) {
    return json(502, { error: error.message || "The routing service is temporarily unavailable." });
  }
};
