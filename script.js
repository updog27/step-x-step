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

const startButton =
document.getElementById("start-button");

const statusBox =
document.getElementById("statusBox");


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

halfDistance = goalDistance / 2;

totalDistance = 0;
previousPosition = null;
startPoint = null;
halfwayMarker = null;
routeCoordinates = [];

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


// BLUE MARKER

if (!userMarker) {

userMarker =
L.marker([lat, lon]).addTo(map);

} else {

userMarker.setLatLng([lat, lon]);

}


// save start point

if (!startPoint && previousPosition) {

startPoint = {
lat: previousPosition.latitude,
lon: previousPosition.longitude
};

}


// distance

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


// ---------- RED MARKER TEST ----------

if (startPoint) {

const dx = lat - startPoint.lat;
const dy = lon - startPoint.lon;

const targetLat = lat + dx;
const targetLon = lon + dy;

if (!halfwayMarker) {

halfwayMarker =
L.marker(
[targetLat, targetLon],
{ icon: redIcon }
).addTo(map);

} else {

halfwayMarker.setLatLng(
[targetLat, targetLon]
);

}

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
