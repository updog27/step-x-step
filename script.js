// ===============================
// GLOBAL VARIABLES
// ===============================

let map;
let userMarker;
let routeLine;
let routeCoordinates = [];

let watchId = null;
let previousPosition = null;
let totalDistance = 0;
let goalDistance = 0;

let stepCount = 0;
let lastMagnitude = 0;
let lastStepTime = 0;

const STEP_THRESHOLD = 0.6;   // lower = detects walking
const STEP_DELAY = 250;       // ms between steps

const startButton = document.getElementById("start-button");
const distanceDisplay = document.getElementById("distance");
const stepDisplay = document.getElementById("steps");


// ===============================
// MAP INIT
// ===============================

map = L.map("map").setView([27.9506, -82.4572], 13);

L.tileLayer(
"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
{ maxZoom: 19 }
).addTo(map);

routeLine = L.polyline([], { color: "blue" }).addTo(map);


// ===============================
// GET USER LOCATION
// ===============================

if (navigator.geolocation) {

navigator.geolocation.getCurrentPosition(function (pos) {

const lat = pos.coords.latitude;
const lon = pos.coords.longitude;

map.setView([lat, lon], 17);

userMarker = L.marker([lat, lon]).addTo(map);

});

}


// ===============================
// START BUTTON
// ===============================

startButton.addEventListener("click", async () => {

const distanceInput =
document.getElementById("distance-input").value;

goalDistance = parseFloat(distanceInput);

if (isNaN(goalDistance) || goalDistance <= 0) {
alert("Enter valid distance");
return;
}

totalDistance = 0;
stepCount = 0;
previousPosition = null;
routeCoordinates = [];

distanceDisplay.textContent = "0.00 miles";
stepDisplay.textContent = "0";

await requestMotionPermission();

watchId = navigator.geolocation.watchPosition(
updatePosition,
handleError,
{
enableHighAccuracy: true,
maximumAge: 0,
timeout: 10000
}
);

});


// ===============================
// GPS UPDATE
// ===============================

function updatePosition(position) {

const lat = position.coords.latitude;
const lon = position.coords.longitude;

if (!userMarker) {
userMarker = L.marker([lat, lon]).addTo(map);
}

userMarker.setLatLng([lat, lon]);
map.panTo([lat, lon]);

routeCoordinates.push([lat, lon]);
routeLine.setLatLngs(routeCoordinates);

if (previousPosition) {

const dist = calculateDistance(
previousPosition.latitude,
previousPosition.longitude,
lat,
lon
);

if (dist > 0.001) {

totalDistance += dist;

distanceDisplay.textContent =
totalDistance.toFixed(2) + " miles";

if (totalDistance >= goalDistance) {

navigator.geolocation.clearWatch(watchId);
alert("Goal reached");

}

}

}

previousPosition = {
latitude: lat,
longitude: lon
};

}


// ===============================
// STEP COUNTER (IMPROVED)
// ===============================

async function requestMotionPermission() {

if (
typeof DeviceMotionEvent !== "undefined" &&
typeof DeviceMotionEvent.requestPermission === "function"
) {

try {

const p =
await DeviceMotionEvent.requestPermission();

if (p === "granted") {
startStepCounter();
}

} catch {}

} else {

startStepCounter();

}

}


function startStepCounter() {

window.addEventListener("devicemotion", function (e) {

const acc = e.accelerationIncludingGravity;
if (!acc) return;

const mag = Math.sqrt(
acc.x * acc.x +
acc.y * acc.y +
acc.z * acc.z
);

const diff = Math.abs(mag - lastMagnitude);

const now = Date.now();

if (
diff > STEP_THRESHOLD &&
now - lastStepTime > STEP_DELAY
) {

stepCount++;
stepDisplay.textContent = stepCount;

lastStepTime = now;

}

lastMagnitude = mag;

});

}


// ===============================
// DISTANCE FORMULA
// ===============================

function calculateDistance(lat1, lon1, lat2, lon2) {

const R = 3958.8;

const toRad = d => d * Math.PI / 180;

const dLat = toRad(lat2 - lat1);
const dLon = toRad(lon2 - lon1);

const a =
Math.sin(dLat / 2) ** 2 +
Math.cos(toRad(lat1)) *
Math.cos(toRad(lat2)) *
Math.sin(dLon / 2) ** 2;

const c =
2 * Math.atan2(
Math.sqrt(a),
Math.sqrt(1 - a)
);

return R * c;

}


// ===============================
// ERROR
// ===============================

function handleError(err) {

alert("GPS error: " + err.message);

}
