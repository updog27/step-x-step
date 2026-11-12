let map;
let userMarker;
let plannedRouteLine;
let routeLayers = [];
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
  return $("distance-unit").value === "km" ? value * 0.621371 : value;
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

function clearRouteLayers() {
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];
}

function drawAllRouteOptions() {
  clearRouteLayers();
  routeChoices.forEach((route, index) => {
    const layer = L.polyline(coordinatesToLatLngs(route.coordinates), {
      color: ROUTE_COLORS[index % ROUTE_COLORS.length],
      weight: selectedRoute?.id === route.id ? 7 : 5,
      opacity: selectedRoute?.id === route.id ? 0.98 : 0.48
    }).addTo(map);
    layer.on("click", () => drawSelectedRoute(route));
    routeLayers.push(layer);
  });
  const bounds = L.featureGroup(routeLayers).getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] });
}

function drawSelectedRoute(route) {
  if (selectedRoute && selectedRoute.id !== route.id) resetWalk(false);
  selectedRoute = route;
  drawAllRouteOptions();
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
    const difference = Math.abs(miles - goalDistanceMiles);
    const differenceLabel = currentUnit === "km" ? (difference / 0.621371).toFixed(2) + " km" : difference.toFixed(2) + " mi";
    detail.textContent = formatDistance(miles) + " total · " + differenceLabel + " from target";
    info.append(title, detail);
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
    if (!response.ok) throw new Error(result.error || "Route generation failed. Please try again.");
    if (!Array.isArray(result.routes) || !result.routes.length) throw new Error("No routes were returned. Try another distance.");

    routeChoices = result.routes;
    routesPanel.hidden = false;
    renderRouteChoices();
    drawSelectedRoute(routeChoices[0]);
    const withinTolerance = routeChoices.filter(route => Math.abs(route.distanceMeters - milesToMeters(goalMiles)) <= (result.toleranceMeters || 80.5)).length;
    if (type === "outback" && withinTolerance < routeChoices.length) setStatus("Routes found. Some options are slightly outside the 0.05-mile target tolerance; their exact distances are shown.");
    if (routeChoices.length < 3) setStatus("Found " + routeChoices.length + " distinct walkable option(s) here. More routes were not available on the nearby street network.");
  } catch (error) {
    setStatus(error.message || "Unable to find routes.");
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
  stopButton.disabled = false;
  setStatus(totalDistanceMiles > 0 ? "Walk resumed. GPS tracking is active." : "Walk started. GPS tracking is active.");

  watchId = navigator.geolocation.watchPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    if (accuracy && accuracy > 60) {
      setStatus("GPS signal is weak. Move to an open area for better accuracy.");
    }
    const point = [latitude, longitude];
    if (userMarker) userMarker.setLatLng(point);
    else userMarker = L.marker(point).addTo(map);
    if (previousPosition) {
      const segment = calculateDistance(previousPosition[0], previousPosition[1], latitude, longitude);
      // Ignore tiny GPS jitter and implausible jumps.
      if (segment >= 0.003 && segment <= 0.15 && (!accuracy || accuracy <= 60)) {
        totalDistanceMiles += segment;
      }
    }
    const points = actualRouteLine.getLatLngs();
    points.push(point);
    actualRouteLine.setLatLngs(points);
    previousPosition = point;
    updateProgress();

    if (goalDistanceMiles > 0 && totalDistanceMiles >= goalDistanceMiles) {
      stopWalk("Distance goal reached!");
    }
  }, error => {
    const messages = {
      1: "Location permission was denied. Enable it in your browser settings.",
      2: "Your current location is unavailable.",
      3: "GPS timed out. Move to an area with a clearer signal."
    };
    setStatus(messages[error.code] || "GPS tracking error.");
    stopWalk();
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
}

function stopWalk(message) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  previousPosition = null;
  startButton.disabled = !selectedRoute && $("route-type").value !== "free";
  generateButton.disabled = false;
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
  actualRouteLine.setLatLngs([]);
  updateProgress();
  startButton.disabled = !selectedRoute && $("route-type").value !== "free";
  stopButton.disabled = true;
  generateButton.disabled = false;
  if (updateStatus) setStatus("Walk reset. Your totals have been cleared.");
}

generateButton.addEventListener("click", generateRoutes);
startButton.addEventListener("click", startWalk);
stopButton.addEventListener("click", () => stopWalk());
resetButton.addEventListener("click", () => resetWalk());

$("distance-unit").addEventListener("change", () => {
  currentUnit = $("distance-unit").value;
  updateProgress();
  if (selectedRoute) $("route-summary").textContent = formatDistance(selectedRoute.distanceMeters / 1609.344) + " planned";
});

$("route-type").addEventListener("change", () => {
  selectedRoute = null;
  routeChoices = [];
  resetWalk(false);
  routeList.innerHTML = "";
  routesPanel.hidden = true;
  plannedRouteLine.setLatLngs([]);
  clearRouteLayers();
  $("route-summary").textContent = "No route selected";
  startButton.disabled = true;
});

getCurrentPosition().then(position => {
  const point = [position.coords.latitude, position.coords.longitude];
  map.setView(point, 16);
  userMarker = L.marker(point).addTo(map).bindPopup("Your location");
  setStatus("Location found. Enter a distance and find a route.");
}).catch(() => setStatus("Enter a distance, then allow location access when you find a route."));
