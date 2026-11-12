let map;
let userMarker;
let plannedRouteLine;
let routeLayers = [];
let turnaroundMarker = null;
let destinationMarker = null;
let actualRouteLine;
const ROUTE_COLORS = ["#1769d2", "#159b72", "#d97706"];
let selectedRoute = null;
let routeChoices = [];
let watchId = null;
let previousPosition = null;
let totalDistanceMiles = 0;
let goalDistanceMiles = 0;
let stepCount = 0;
let sessionInitialized = false;
let routeMatchIndex = 0;
let currentUnit = "miles";

const STEPS_PER_MILE = 2300;
const $ = (id) => document.getElementById(id);
const statusBox = $("statusBox");
const startButton = $("start-button");
const stopButton = $("stop-button");
const resetButton = $("reset-button");
const generateButton = $("generate-routes-button");
const distanceDisplay = $("distance");
const stepDisplay = $("steps");
const progressBar = $("progressBar");
const progressText = $("progress-text");
const routeList = $("route-list");
const routesPanel = $("routes-panel");

map = L.map("map").setView([27.95, -82.45], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

plannedRouteLine = L.polyline([], { color: ROUTE_COLORS[0], weight: 6, opacity: 0.95 }).addTo(map);
actualRouteLine = L.polyline([], { color: "#f28c28", weight: 4 }).addTo(map);

function setStatus(message) { statusBox.textContent = message; }

function getGoalMiles() {
  const value = Number($("distance-input").value);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a distance greater than zero.");
  const miles = $("distance-unit").value === "km" ? value * 0.621371 : value;
  const meters = miles * 1609.344;
  if (meters < 300 || meters > 50000) throw new Error("Choose a distance between 300 meters and 50 kilometers (about 0.19 to 31.07 miles).");
  return miles;
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device does not support location services."));
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Location access failed. Check that location permission is enabled and try again.")), {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 10000
    });
  });
}

function milesToMeters(miles) { return miles * 1609.344; }

function formatDistance(miles) {
  return currentUnit === "km" ? (miles / 0.621371).toFixed(2) + " km" : miles.toFixed(2) + " mi";
}

function coordinatesToLatLngs(coords) {
  return coords.map(([lon, lat]) => [lat, lon]);
}

function distanceToSegmentMeters(point, start, end) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos(point[0] * Math.PI / 180);
  const toLocal = ([lat, lon]) => [(lon - point[1]) * longitudeScale, (lat - point[0]) * latitudeScale];
  const p = [0, 0], a = toLocal(start), b = toLocal(end);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared)) : 0;
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}

function resetRouteMatch() {
  routeMatchIndex = 0;
}

function updateRouteAdherence(latitude, longitude, accuracy) {
  const display = $("route-follow-status");
  if (!display) return;
  if (!selectedRoute || !Array.isArray(selectedRoute.coordinates) || selectedRoute.coordinates.length < 2) {
    display.textContent = $("route-type").value === "free" ? "Free run" : "—";
    resetRouteMatch();
    return;
  }

  const path = coordinatesToLatLngs(selectedRoute.coordinates);
  const point = [latitude, longitude];
  const lastSegment = path.length - 2;
  // Match near the user's prior position in the route sequence. This avoids
  // jumping to a nearby parallel leg, loop closure, or crossing elsewhere.
  const from = Math.max(0, routeMatchIndex - 3);
  const to = Math.min(lastSegment, routeMatchIndex + 80);
  let nearest = Infinity;
  let bestIndex = routeMatchIndex;
  for (let i = from; i <= to; i++) {
    const distance = distanceToSegmentMeters(point, path[i], path[i + 1]);
    if (distance < nearest) {
      nearest = distance;
      bestIndex = i;
    }
  }

  const uncertainty = Number.isFinite(accuracy) ? accuracy : 35;
  const onThreshold = Math.max(35, uncertainty * 1.5);
  const nearThreshold = Math.max(75, uncertainty * 2.5);
  if (nearest <= nearThreshold) {
    // Permit only a little backward movement for GPS wobble; route progress
    // otherwise advances in sequence, including on the return leg.
    routeMatchIndex = Math.max(routeMatchIndex - 2, bestIndex);
    display.textContent = nearest <= onThreshold ? "On route" : "Near route";
  } else {
    display.textContent = "Away from route";
  }
}

function clearRouteLayers() {
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];
}

function drawAllRouteOptions() {
  clearRouteLayers();
  let selectedLayer = null;
  routeChoices.forEach((route, index) => {
    const layer = L.polyline(coordinatesToLatLngs(route.coordinates), {
      color: ROUTE_COLORS[index % ROUTE_COLORS.length],
      weight: selectedRoute?.id === route.id ? 7 : 5,
      opacity: selectedRoute?.id === route.id ? 0.98 : 0.48
    }).addTo(map);
    layer.on("click", () => drawSelectedRoute(route));
    routeLayers.push(layer);
    if (selectedRoute?.id === route.id) selectedLayer = layer;
  });
  if (selectedLayer) selectedLayer.bringToFront();
  const bounds = L.featureGroup(routeLayers).getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] });
}

function drawSelectedRoute(route) {
  if (selectedRoute && selectedRoute.id !== route.id) resetWalk(false);
  selectedRoute = route;
  resetRouteMatch();
  drawAllRouteOptions();
  if (turnaroundMarker) map.removeLayer(turnaroundMarker);
  if (destinationMarker) map.removeLayer(destinationMarker);
  turnaroundMarker = null;
  destinationMarker = null;
  if (route.type === "outback" && Array.isArray(route.turnaround)) {
    turnaroundMarker = L.circleMarker([route.turnaround[1], route.turnaround[0]], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#f28c28", fillOpacity: 1 }).addTo(map).bindPopup("Turnaround point - halfway along the route");
  } else if (route.type === "oneway" && Array.isArray(route.coordinates) && route.coordinates.length) {
    const end = route.coordinates[route.coordinates.length - 1];
    destinationMarker = L.marker([end[1], end[0]]).addTo(map).bindPopup("One-way destination");
  }
  const miles = route.distanceMeters / 1609.344;
  $("route-summary").textContent = formatDistance(miles) + " planned";
  startButton.disabled = false;
  renderRouteChoices();
  setStatus("Route selected. Press Start Walk when you're ready.");
}

function renderRouteChoices() {
  routeList.innerHTML = "";
  routeChoices.forEach((route, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "route-card" + (selectedRoute?.id === route.id ? " selected" : "");
    card.style.setProperty("--route-color", ROUTE_COLORS[index % ROUTE_COLORS.length]);
    const info = document.createElement("span");
    info.className = "route-card-info";
    const title = document.createElement("strong");
    title.textContent = (index === 0 ? "Recommended · " : "Alternative · ") + (route.label || ("Route " + (index + 1)));
    const detail = document.createElement("small");
    const miles = route.distanceMeters / 1609.344;
    const difference = miles - goalDistanceMiles;
    const differenceLabel = currentUnit === "km" ? (Math.abs(difference) / 0.621371).toFixed(2) + " km" : Math.abs(difference).toFixed(2) + " mi";
    const varianceLabel = Math.abs(difference) < 0.0005 ? "matches target" : difference > 0 ? differenceLabel + " over target" : differenceLabel + " under target";
    detail.textContent = formatDistance(miles) + " total · " + varianceLabel;
    const safety = route.safety || {};
    const quality = document.createElement("div");
    quality.className = "route-quality";
    const coverage = Number.isFinite(Number(safety.pedestrianInfrastructureCoverage))
      ? Math.max(0, Math.min(100, Number(safety.pedestrianInfrastructureCoverage))) : null;
    const pathPct = Math.max(0, Math.min(100, Number(safety.dedicatedPathCoverage) || 0));
    const sidewalkPct = Math.max(0, Math.min(100, Number(safety.mappedSidewalkCoverage) || 0));
    const noSidewalkPct = Math.max(0, Math.min(100, Number(safety.explicitNoSidewalkCoverage) || 0));
    const uncertainPct = Math.max(0, 100 - pathPct - sidewalkPct - noSidewalkPct);
    const summary = document.createElement("small");
    summary.className = "route-quality-summary";
    summary.textContent = coverage == null
      ? "Mapped pedestrian support: unknown"
      : "Mapped pedestrian support: " + coverage + "%";
    const bar = document.createElement("span");
    bar.className = "evidence-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", "Mapped evidence: " + pathPct + "% dedicated paths, " +
      sidewalkPct + "% mapped sidewalks, " + noSidewalkPct + "% explicit sidewalk gaps, " +
      uncertainPct + "% uncertain.");
    [["path", pathPct], ["sidewalk", sidewalkPct], ["no-sidewalk", noSidewalkPct], ["unknown", uncertainPct]]
      .forEach(([kind, percent]) => {
        if (percent <= 0) return;
        const segment = document.createElement("span");
        segment.className = "evidence-segment " + kind;
        segment.style.width = percent + "%";
        bar.appendChild(segment);
      });
    const details = document.createElement("details");
    details.className = "route-quality-details";
    const summaryToggle = document.createElement("summary");
    summaryToggle.textContent = "View map evidence";
    const legend = document.createElement("div");
    legend.className = "evidence-legend";
    [
      ["path", "Dedicated paths", pathPct],
      ["sidewalk", "Mapped sidewalks", sidewalkPct],
      ["no-sidewalk", "Explicit sidewalk=no", noSidewalkPct],
      ["unknown", "Unknown / unmapped", uncertainPct]
    ].forEach(([kind, label, percent]) => {
      const item = document.createElement("span");
      const dot = document.createElement("i");
      dot.className = "evidence-dot " + kind;
      const textNode = document.createElement("span");
      textNode.textContent = label + " " + Math.round(percent) + "%";
      item.append(dot, textNode);
      legend.appendChild(item);
    });
    const gap = safety.longestMappedInfrastructureGapMeters;
    const crossings = (Number(safety.majorRoadCrossings) || 0) +
      (Number(safety.secondaryRoadCrossings) || 0) +
      (Number(safety.tertiaryRoadCrossings) || 0);
    const note = document.createElement("small");
    note.className = "route-quality-note";
    note.textContent = (gap == null ? "Longest mapped gap: unavailable" : "Longest mapped gap: " + gap + " m") +
      " · " + (safety.crossingCheck === "completed" ? crossings + " mapped major-road crossings" : "Road-crossing check unavailable") +
      ". Map evidence is incomplete and does not guarantee sidewalk conditions.";
    details.append(summaryToggle, legend, note);
    quality.append(summary, bar, details);
    info.append(title, detail, quality);
    const marker = document.createElement("span");
    marker.className = "route-swatch";
    marker.setAttribute("aria-hidden", "true");
    card.append(info, marker);
    card.addEventListener("click", () => drawSelectedRoute(route));
    routeList.appendChild(card);
  });
}

async function generateRoutes() {
  if (watchId !== null) return setStatus("Stop your current walk before planning another route.");
  let goalMiles;
  try { goalMiles = getGoalMiles(); } catch (error) { return setStatus(error.message); }

  const type = $("route-type").value;
  currentUnit = $("distance-unit").value;
  goalDistanceMiles = goalMiles;
  selectedRoute = null;
  routeChoices = [];
  resetWalk(false);
  startButton.disabled = true;
  generateButton.disabled = true;
  routesPanel.hidden = true;
  plannedRouteLine.setLatLngs([]);
  clearRouteLayers();
  if (turnaroundMarker) map.removeLayer(turnaroundMarker);
  if (destinationMarker) map.removeLayer(destinationMarker);
  turnaroundMarker = null;
  destinationMarker = null;
  $("route-summary").textContent = "Finding routes…";

  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;
    if (userMarker) userMarker.setLatLng([latitude, longitude]);
    else userMarker = L.marker([latitude, longitude]).addTo(map).bindPopup("Your starting point");
    map.setView([latitude, longitude], 16);

    if (type === "free") {
      selectedRoute = null;
      $("route-summary").textContent = "Free run · no planned route";
      startButton.disabled = false;
      setStatus("Starting point found. Your route will be recorded as you move.");
      return;
    }

    setStatus("Finding walkable routes near your location…");
    const response = await fetch("/.netlify/functions/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude, longitude,
        distanceMeters: milesToMeters(goalMiles),
        routeType: type
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const routeError = new Error(result.error || "Route generation failed. Please try again.");
      routeError.routeDiagnostics = result.diagnostics || null;
      throw routeError;
    }
    if (!Array.isArray(result.routes) || !result.routes.length) throw new Error("No routes were returned. Try another distance.");

    routeChoices = result.routes;
    routesPanel.hidden = false;
    renderRouteChoices();
    drawSelectedRoute(routeChoices[0]);
    const availableCount = routeChoices.length;
    const targetNote = "No route exceeds your requested distance. All displayed routes are within 0.01 miles below your target.";
    if (availableCount < 3) {
      setStatus("Found " + availableCount + " distinct route option that passed the available map checks" + (availableCount === 1 ? "" : "s") +
        " near your starting point. " + targetNote +
        " We won't add routes that fail the distance or map-screening checks.");
    } else {
      setStatus("Found 3 distinct route options that passed the available map checks near your starting point. " + targetNote);
    }
  } catch (error) {
    const details = error.routeDiagnostics;
    if (details) {
      const lines = [
        error.message || "No route passed all checks.",
        "Route diagnostics — routed: " + details.routedCandidates +
          "; exact-distance failures: " + details.rejectedNoExactHalf +
          "; road/access: " + details.rejectedMajorRoadOrAccess +
          "; direction: " + details.rejectedDirection +
          "; major/secondary crossings: " + details.rejectedMajorOrSecondaryCrossing +
          "; pedestrian/commercial screening: " + details.rejectedPedestrianOrCommercialScreen +
          "; neighborhood: " + details.rejectedNeighborhood
      ];
      if (details.providerError) lines.push("Routing provider: " + details.providerError);
      setStatus(lines.join(" | "));
    } else {
      setStatus(error.message || "Unable to find routes.");
    }
    $("route-summary").textContent = "No route selected";
  } finally {
    generateButton.disabled = false;
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateProgress() {
  distanceDisplay.textContent = formatDistance(totalDistanceMiles);
  stepCount = Math.round(totalDistanceMiles * STEPS_PER_MILE);
  stepDisplay.textContent = stepCount.toLocaleString();
  const percent = goalDistanceMiles > 0 ? Math.min(100, totalDistanceMiles / goalDistanceMiles * 100) : 0;
  progressBar.style.width = percent + "%";
  progressText.textContent = Math.round(percent) + "%";
}

function startWalk() {
  if (watchId !== null) return;
  try { goalDistanceMiles = getGoalMiles(); } catch (error) { return setStatus(error.message); }
  currentUnit = $("distance-unit").value;
  if ($("route-type").value !== "free" && !selectedRoute) {
    return setStatus("Find and select a route before starting.");
  }
  if (!sessionInitialized) {
    totalDistanceMiles = 0;
    stepCount = 0;
    actualRouteLine.setLatLngs([]);
    sessionInitialized = true;
    updateProgress();
  }
  previousPosition = null;
  startButton.disabled = true;
  generateButton.disabled = true;
  $("distance-input").disabled = true;
  $("distance-unit").disabled = true;
  $("route-type").disabled = true;
  stopButton.disabled = false;
  setStatus(totalDistanceMiles > 0 ? "Walk resumed. GPS tracking is active." : "Walk started. GPS tracking is active.");

  watchId = navigator.geolocation.watchPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    const currentAccuracy = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : Infinity;
    if (currentAccuracy > 35) {
      setStatus("GPS accuracy is low. Distance updates are paused until the signal improves.");
      return; // Do not let an untrusted fix move the distance baseline.
    }
    const point = [latitude, longitude];
    if (userMarker) userMarker.setLatLng(point);
    else userMarker = L.marker(point).addTo(map);
    const timestamp = Number(position.timestamp) || Date.now();
    let acceptedPoint = false;
    if (!previousPosition) {
      acceptedPoint = true;
    } else {
      const elapsedSeconds = Math.max(0.1, (timestamp - previousPosition.timestamp) / 1000);
      const segmentMiles = calculateDistance(
        previousPosition.latitude, previousPosition.longitude, latitude, longitude
      );
      const segmentMeters = segmentMiles * 1609.344;
      const previousAccuracy = previousPosition.accuracy;
      // Filter GPS jitter relative to reported uncertainty, then reject
      // movement faster than a conservative running pace can explain.
      const jitterFloorMeters = Math.max(2, (previousAccuracy + currentAccuracy) * 0.18);
      const speedMetersPerSecond = segmentMeters / elapsedSeconds;
      acceptedPoint = segmentMeters >= jitterFloorMeters && speedMetersPerSecond <= 5.5;
      if (acceptedPoint) totalDistanceMiles += segmentMiles;
    }

    if (acceptedPoint) {
      const points = actualRouteLine.getLatLngs();
      points.push(point);
      actualRouteLine.setLatLngs(points);
    } else {
      setStatus("GPS movement was inconsistent. Filtering that reading; tracking continues.");
    }
    // Only trusted fixes become the next baseline. Totals survive rejected fixes
    // and temporary signal loss without accumulating a large recovery jump.
    previousPosition = { latitude, longitude, accuracy: currentAccuracy, timestamp };
    if (acceptedPoint) updateRouteAdherence(latitude, longitude, currentAccuracy);
    updateProgress();

    if (goalDistanceMiles > 0 && totalDistanceMiles >= goalDistanceMiles) {
      stopWalk("Distance goal reached!");
    }
  }, error => {
    if (error.code === 1) {
      setStatus("Location permission was denied. Enable it in your browser settings to continue.");
      stopWalk();
      return;
    }
    const messages = {
      2: "GPS is temporarily unavailable. Your walk is still active; waiting for a reliable location fix.",
      3: "GPS timed out. Your walk is still active; waiting for the next location update."
    };
    setStatus(messages[error.code] || "GPS signal interrupted. Tracking remains active while the device reconnects.");
    // Keep the watch alive for recoverable errors. A later valid fix resumes
    // distance accumulation; no distance is added during the interruption.
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
}

function stopWalk(message) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  previousPosition = null;
  startButton.disabled = !selectedRoute && $("route-type").value !== "free";
  generateButton.disabled = false;
  $("distance-input").disabled = false;
  $("distance-unit").disabled = false;
  $("route-type").disabled = false;
  stopButton.disabled = true;
  setStatus(message || "Walk paused. Total distance: " + formatDistance(totalDistanceMiles));
}

function resetWalk(updateStatus = true) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  previousPosition = null;
  totalDistanceMiles = 0;
  stepCount = 0;
  sessionInitialized = false;
  resetRouteMatch();
  actualRouteLine.setLatLngs([]);
  updateProgress();
  startButton.disabled = !selectedRoute && $("route-type").value !== "free";
  stopButton.disabled = true;
  generateButton.disabled = false;
  $("distance-input").disabled = false;
  $("distance-unit").disabled = false;
  $("route-type").disabled = false;
  updateRouteAdherence(userMarker ? userMarker.getLatLng().lat : 0, userMarker ? userMarker.getLatLng().lng : 0, 35);
  if (updateStatus) setStatus("Walk reset. Your totals have been cleared.");
}

generateButton.addEventListener("click", generateRoutes);
startButton.addEventListener("click", startWalk);
stopButton.addEventListener("click", () => stopWalk());
resetButton.addEventListener("click", () => resetWalk());

$("distance-unit").addEventListener("change", () => {
  const nextUnit = $("distance-unit").value;
  const input = $("distance-input");
  const value = Number(input.value);
  if (Number.isFinite(value) && value > 0 && nextUnit !== currentUnit) {
    input.value = (nextUnit === "km" ? value * 1.609344 : value / 1.609344).toFixed(2);
  }
  currentUnit = nextUnit;
  updateProgress();
  if (selectedRoute) $("route-summary").textContent = formatDistance(selectedRoute.distanceMeters / 1609.344) + " planned";
});

$("distance-input").addEventListener("change", () => {
  if (watchId !== null || !selectedRoute) return;
  selectedRoute = null;
  routeChoices = [];
  clearRouteLayers();
  if (turnaroundMarker) map.removeLayer(turnaroundMarker);
  if (destinationMarker) map.removeLayer(destinationMarker);
  turnaroundMarker = null;
  destinationMarker = null;
  plannedRouteLine.setLatLngs([]);
  routeList.innerHTML = "";
  routesPanel.hidden = true;
  startButton.disabled = true;
  $("route-summary").textContent = "Distance changed - find a new route";
  setStatus("Your distance changed. Find a new route before starting.");
});

$("route-type").addEventListener("change", () => {
  selectedRoute = null;
  routeChoices = [];
  resetWalk(false);
  routeList.innerHTML = "";
  routesPanel.hidden = true;
  plannedRouteLine.setLatLngs([]);
  clearRouteLayers();
  if (turnaroundMarker) map.removeLayer(turnaroundMarker);
  if (destinationMarker) map.removeLayer(destinationMarker);
  turnaroundMarker = null;
  destinationMarker = null;
  $("route-summary").textContent = "No route selected";
  startButton.disabled = true;
});

getCurrentPosition().then(position => {
  const point = [position.coords.latitude, position.coords.longitude];
  map.setView(point, 16);
  userMarker = L.marker(point).addTo(map).bindPopup("Your location");
  setStatus("Location found. Enter a distance and find a route.");
}).catch(() => setStatus("Enter a distance, then allow location access when you find a route."));
