let map;
let userMarker;
let halfwayMarker;
let routeLine;
let routeCoordinates = [];

let watchId = null;
let previousPosition = null;
let startPoint = null;

let totalDistance = 0;
let goalDistance = 0;
let halfDistance = 0;

let stepCount = 0;

const STEPS_PER_MILE = 2300;
const TURN_BUFFER = 0.003;

let turnaroundTriggered = false;


// ---------- UI ----------

const startButton =
document.getElementById("start-button");

const distanceDisplay =
document.getElementById("distance");

const stepDisplay =
document.getElementById("steps");

const statusBox =
document.getElementById("statusBox");

const progressBar =
document.getElementById("progressBar");

const unitSelect =
document.getElementById("distance-unit");


// ---------- RED ICON ----------

const redIcon = new L.Icon({
iconUrl:
"https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
shadowUrl:
"https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
iconSize: [25, 41],
iconAnchor: [12, 41]
});


// ---------- MAP ----------

map = L.map("map").setView([27.95, -82.45], 13);

L.tileLayer(
"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
{ maxZoom: 19 }
).addTo(map);

routeLine =
L.polyline([], { color: "blue" })
.addTo(map);

// Keep generated navigation candidates separate from the live GPS activity trace.
let generatedRouteLine = L.polyline([], { color: "green", weight: 5, opacity: 0.85 }).addTo(map);


// ---------- LOCATION ----------

navigator.geolocation.getCurrentPosition(pos => {

const lat = pos.coords.latitude;
const lon = pos.coords.longitude;

map.setView([lat, lon], 17);

userMarker =
L.marker([lat, lon]).addTo(map);

});


// ---------- START ----------

startButton.addEventListener("click", () => {

let input =
document.getElementById("distance-input").value;

goalDistance = parseFloat(input);

if (unitSelect.value === "km") {
goalDistance *= 0.621371;
}

halfDistance = goalDistance / 2;

totalDistance = 0;
previousPosition = null;
startPoint = null;
halfwayMarker = null;
routeCoordinates = [];

turnaroundTriggered = false;

watchId =
navigator.geolocation.watchPosition(
updatePosition,
handleError,
{ enableHighAccuracy: true }
);

});


// ---------- UPDATE ----------

function updatePosition(position) {

const lat = position.coords.latitude;
const lon = position.coords.longitude;


// USER MARKER

if (!userMarker) {

userMarker =
L.marker([lat, lon]).addTo(map);

} else {

userMarker.setLatLng([lat, lon]);

}


// DRAW LINE

routeCoordinates.push([lat, lon]);
routeLine.setLatLngs(routeCoordinates);


// SAVE START POINT

if (!startPoint && previousPosition) {

startPoint = {
lat: previousPosition.latitude,
lon: previousPosition.longitude
};

}


// DISTANCE

if (previousPosition) {

const dist =
calculateDistance(
previousPosition.latitude,
previousPosition.longitude,
lat,
lon
);

if (dist > 0.0005) {
totalDistance += dist;
}

}


// ---------- FORWARD MARKER (WORKING VERSION) ----------

if (
startPoint &&
!halfwayMarker &&
totalDistance > 0.02
) {

const dx = lat - startPoint.lat;
const dy = lon - startPoint.lon;

const straight =
Math.sqrt(dx * dx + dy * dy);

if (straight > 0) {

const scale =
halfDistance / straight;

const targetLat =
startPoint.lat + dx * scale;

const targetLon =
startPoint.lon + dy * scale;

halfwayMarker =
L.marker(
[targetLat, targetLon],
{ icon: redIcon }
).addTo(map);

}

}

// DISPLAY

distanceDisplay.textContent =
totalDistance.toFixed(2);

stepCount =
Math.round(totalDistance * STEPS_PER_MILE);

stepDisplay.textContent =
stepCount;


// PROGRESS

let progress =
(totalDistance / goalDistance) * 100;

if (progress > 100) progress = 100;

progressBar.style.width =
progress + "%";


// TURN

if (
!turnaroundTriggered &&
totalDistance >=
halfDistance - TURN_BUFFER
) {

turnaroundTriggered = true;

statusBox.textContent =
"Turn around";

}


// GOAL

if (totalDistance >= goalDistance) {

navigator.geolocation.clearWatch(
watchId
);

statusBox.textContent =
"Goal reached";

progressBar.style.width = "100%";

}


previousPosition = {
latitude: lat,
longitude: lon
};

}


// ---------- DISTANCE ----------

function calculateDistance(
lat1,
lon1,
lat2,
lon2
) {

const R = 3958.8;

const toRad =
d => d * Math.PI / 180;

const dLat =
toRad(lat2 - lat1);

const dLon =
toRad(lon2 - lon1);

const a =
Math.sin(dLat/2)**2 +
Math.cos(toRad(lat1)) *
Math.cos(toRad(lat2)) *
Math.sin(dLon/2)**2;

const c =
2*Math.atan2(
Math.sqrt(a),
Math.sqrt(1-a)
);

return R*c;

}


function handleError() {

statusBox.textContent =
"GPS error";

}


// ---------- PEDESTRIAN ROUTE GENERATION ----------
// This is separate from the GPS activity tracker above. The server returns
// geometry only after all acceptance evidence gates pass; review-only
// candidates are intentionally displayed as a status, never as navigation.
const findRouteButton = document.getElementById("find-route-button");
if (findRouteButton) {
  findRouteButton.addEventListener("click", async () => {
    const distanceInput = document.getElementById("distance-input");
    const requested = Number(distanceInput.value);
    if (!Number.isFinite(requested) || requested <= 0) {
      statusBox.textContent = "Enter a valid distance first.";
      return;
    }

    const miles = unitSelect.value === "km" ? requested * 0.621371 : requested;
    if (miles > 3) {
      statusBox.textContent = "The route preview currently supports distances up to 3 miles.";
      return;
    }
    if (document.getElementById("route-type").value !== "outback") {
      statusBox.textContent = "Loop and free-run routing are not available yet. Choose Out-and-back.";
      return;
    }
    if (!navigator.geolocation) {
      statusBox.textContent = "This device does not provide location services.";
      return;
    }

    findRouteButton.disabled = true;
    generatedRouteLine.setLatLngs([]);
    statusBox.textContent = "Getting your location and checking pedestrian paths…";
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch("/.netlify/functions/routes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            miles,
            routeType: "out_and_back"
          })
        });
        const result = await response.json();
        if (!response.ok) {
          statusBox.textContent = result.error?.message || "The route service is temporarily unavailable.";
          return;
        }

        if (result.status === "routes_available") {
          const accepted = result.routes.find(route => route.geometry?.coordinates?.length);
          if (accepted) {
            const points = accepted.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
            generatedRouteLine.setLatLngs(points);
            map.fitBounds(generatedRouteLine.getBounds(), { padding: [24, 24] });
            statusBox.textContent = "A verified route is ready. Review the map before starting.";
          } else {
            statusBox.textContent = "The service reported a route but did not return approved route geometry.";
          }
        } else if (result.status === "field_review_required") {
          statusBox.textContent = "Pedestrian paths were found, but access and crossing details still need field verification. No route has been approved for navigation.";
        } else if (result.status === "no_complete_round_trip_found" || result.status === "no_route") {
          statusBox.textContent = result.message || "No complete pedestrian out-and-back route was found for this distance.";
        } else {
          statusBox.textContent = result.error?.message || "Route service unavailable. Please try again later.";
        }
      } catch (error) {
        statusBox.textContent = "Could not contact the route service. Check your connection and try again.";
      } finally {
        findRouteButton.disabled = false;
      }
    }, () => {
      statusBox.textContent = "Location permission is needed to generate a route.";
      findRouteButton.disabled = false;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
