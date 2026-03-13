let map;
let userMarker;
let routeLine;
let routeCoordinates = [];

let watchId = null;
let previousPosition = null;
let totalDistance = 0;
let goalDistance = 0;

const startButton = document.getElementById("start-button");
const stepsDisplay = document.getElementById("steps");

startButton.addEventListener("click", () => {

const distanceInput = document.getElementById("distance-input").value;
goalDistance = parseFloat(distanceInput);

if (isNaN(goalDistance) || goalDistance <= 0) {
alert("Please enter a valid distance.");
return;
}

totalDistance = 0;
previousPosition = null;
routeCoordinates = [];

stepsDisplay.textContent = "0.00 miles";

if (!navigator.geolocation) {
alert("Geolocation is not supported by your browser.");
return;
}

watchId = navigator.geolocation.watchPosition(updatePosition, handleError, {
enableHighAccuracy: true,
maximumAge: 0,
timeout: 10000
});

});

function updatePosition(position){

const lat = position.coords.latitude;
const lon = position.coords.longitude;

if(!map){

map = L.map('map').setView([lat, lon], 17);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
maxZoom: 19
}).addTo(map);

userMarker = L.marker([lat, lon]).addTo(map);

routeLine = L.polyline([], {color:'blue'}).addTo(map);

}

userMarker.setLatLng([lat, lon]);

routeCoordinates.push([lat, lon]);
routeLine.setLatLngs(routeCoordinates);

if(previousPosition){

const distance = calculateDistance(
previousPosition.latitude,
previousPosition.longitude,
lat,
lon
);

if(distance > 0.003){
totalDistance += distance;
stepsDisplay.textContent = totalDistance.toFixed(2) + " miles";

if(totalDistance >= goalDistance){
navigator.geolocation.clearWatch(watchId);
alert("Goal reached!");
}

}

}

previousPosition = {latitude:lat, longitude:lon};

}

function handleError(error){
alert("Location error: " + error.message);
}

function calculateDistance(lat1, lon1, lat2, lon2){

const R = 3958.8;

const toRad = angle => angle * Math.PI / 180;

const dLat = toRad(lat2-lat1);
const dLon = toRad(lon2-lon1);

const a =
Math.sin(dLat/2)*Math.sin(dLat/2) +
Math.cos(toRad(lat1)) *
Math.cos(toRad(lat2)) *
Math.sin(dLon/2)*Math.sin(dLon/2);

const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

return R * c;

}
