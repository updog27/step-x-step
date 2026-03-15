let map;
let userMarker;
let routeLine;
let routeCoordinates = [];

let halfwayMarker = null;
let startPoint = null;
let directionSet = false;

let watchId = null;
let previousPosition = null;

let totalDistance = 0;
let goalDistance = 0;
let halfDistance = 0;

let stepCount = 0;

const STEPS_PER_MILE = 2300;

let turnaroundTriggered = false;

const TURN_BUFFER = 0.003;

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

const routeTypeSelect =
document.getElementById("route-type");

const unitSelect =
document.getElementById("distance-unit");


// ================= MAP =================

map = L.map("map").setView([27.95, -82.45], 13);

L.tileLayer(
"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
{ maxZoom: 19 }
).addTo(map);

routeLine =
L.polyline([], { color: "blue" })
.addTo(map);


// ================= LOCATION =================

if (navigator.geolocation) {

navigator.geolocation.getCurrentPosition(pos => {

const lat = pos.coords.latitude;
const lon = pos.coords.longitude;

map.setView([lat, lon], 17);

userMarker =
L.marker([lat, lon]).addTo(map);

});

}


// ================= START =================

startButton.addEventListener("click", () => {

let input =
document.getElementById("distance-input").value;

goalDistance = parseFloat(input);

if (isNaN(goalDistance) || goalDistance <= 0) {

statusBox.textContent =
"Enter valid distance";

return;
}

const unit = unitSelect.value;
const routeType = routeTypeSelect.value;

if (unit === "km") {
goalDistance *= 0.621371;
}

totalDistance = 0;
stepCount = 0;
previousPosition = null;
routeCoordinates = [];

startPoint = null;
directionSet = false;
halfwayMarker = null;

turnaroundTriggered = false;

distanceDisplay.textContent = "0.00 miles";
stepDisplay.textContent = "0";

statusBox.textContent = "Walking...";

if (routeType === "outback") {
halfDistance = goalDistance / 2;
} else {
halfDistance = 0;
}

watchId =
navigator.geolocation.watchPosition(
updatePosition,
handleError,
{
enableHighAccuracy: true,
maximumAge: 0,
timeout: 10000
}
);

});


// ================= UPDATE =================

function updatePosition(position) {

const lat = position.coords.latitude;
const lon = position.coords.longitude;

userMarker.setLatLng([lat, lon]);

map.panTo([lat, lon]);

routeCoordinates.push([lat, lon]);

routeLine.setLatLngs(routeCoordinates);

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


// lock start point AFTER movement

if (!startPoint && totalDistance > 0.01) {

startPoint = {
lat: previousPosition.latitude,
lon: previousPosition.longitude
};

}


// place halfway marker AFTER direction known

if (
halfDistance > 0 &&
!directionSet &&
totalDistance > 0.02
) {

directionSet = true;

const target =
projectPoint(
startPoint.lat,
startPoint.lon,
lat,
lon,
halfDistance
);

halfwayMarker =
L.marker([target.lat, target.lon])
.addTo(map);

}


// distance display

distanceDisplay.textContent =
totalDistance.toFixed(2) + " miles";


// progress bar

let progress =
(totalDistance / goalDistance) * 100;

if (progress > 100) progress = 100;

progressBar.style.width =
progress + "%";


// steps

stepCount =
Math.round(totalDistance * STEPS_PER_MILE);

stepDisplay.textContent =
stepCount;


// remaining

let remaining =
goalDistance - totalDistance;

if (remaining < 0) remaining = 0;

statusBox.textContent =
"Walking… " +
remaining.toFixed(2) +
" miles remaining";


// TURNAROUND

if (
halfDistance > 0 &&
!turnaroundTriggered &&
totalDistance >=
halfDistance - TURN_BUFFER
) {

turnaroundTriggered = true;

statusBox.textContent =
"Turn around now";

buzz([200,100,200,100,200]);

}


// GOAL

const GOAL_BUFFER = 0.003;

if (
totalDistance >=
goalDistance - GOAL_BUFFER
) {

navigator.geolocation.clearWatch(
watchId
);

statusBox.textContent =
"Goal reached";

progressBar.style.width = "100%";

buzz([400,200,400]);

}

}

}

previousPosition = {
latitude: lat,
longitude: lon
};

}


// ================= DISTANCE =================

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
Math.sin(dLat/2) * Math.sin(dLat/2) +
Math.cos(toRad(lat1)) *
Math.cos(toRad(lat2)) *
Math.sin(dLon/2) *
Math.sin(dLon/2);

const c =
2 * Math.atan2(
Math.sqrt(a),
Math.sqrt(1 - a)
);

return R * c;

}


// ================= ERROR =================

function handleError(err) {

statusBox.textContent =
"GPS error";

}


// ================= PROJECTION =================

function projectPoint(
lat1,
lon1,
lat2,
lon2,
distanceMiles
) {

const dx = lat2 - lat1;
const dy = lon2 - lon1;

const length =
Math.sqrt(dx*dx + dy*dy);

if (length === 0) {
return { lat: lat1, lon: lon1 };
}

const scale =
distanceMiles / length;

return {

lat: lat1 + dx * scale,
lon: lon1 + dy * scale

};

}


// ================= BUZZ =================

function buzz(ms) {

if (navigator.vibrate) {

navigator.vibrate(ms);

}

}











