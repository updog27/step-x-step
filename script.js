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
let lastAcceleration = 0;

const startButton = document.getElementById("start-button");
const distanceDisplay = document.getElementById("distance");
const stepDisplay = document.getElementById("steps");


// ===============================
// MAP INITIALIZATION
// ===============================

map = L.map('map').setView([27.9506, -82.4572], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
maxZoom:19
}).addTo(map);

routeLine = L.polyline([], {color:'blue'}).addTo(map);


// ===============================
// GET USER LOCATION
// ===============================

if(navigator.geolocation){

navigator.geolocation.getCurrentPosition(function(position){

const lat = position.coords.latitude;
const lon = position.coords.longitude;

map.setView([lat,lon],17);

userMarker = L.marker([lat,lon]).addTo(map);

});

}


// ===============================
// START WALK BUTTON
// ===============================

startButton.addEventListener("click", async () => {

const distanceInput = document.getElementById("distance-input").value;
goalDistance = parseFloat(distanceInput);

if(isNaN(goalDistance) || goalDistance <= 0){
alert("Enter a valid distance");
return;
}

totalDistance = 0;
stepCount = 0;
previousPosition = null;
routeCoordinates = [];

distanceDisplay.textContent = "0.00 miles";
stepDisplay.textContent = "0";

startStepCounter();

watchId = navigator.geolocation.watchPosition(
updatePosition,
handleError,
{
enableHighAccuracy:true,
maximumAge:0,
timeout:10000
});

});


// ===============================
// GPS POSITION UPDATE
// ===============================

function updatePosition(position){

const lat = position.coords.latitude;
const lon = position.coords.longitude;

if(!userMarker){
userMarker = L.marker([lat,lon]).addTo(map);
}

userMarker.setLatLng([lat,lon]);

map.panTo([lat,lon]);

routeCoordinates.push([lat,lon]);
routeLine.setLatLngs(routeCoordinates);

if(previousPosition){

const distance = calculateDistance(
previousPosition.latitude,
previousPosition.longitude,
lat,
lon
);

if(distance > 0.001){

totalDistance += distance;

distanceDisplay.textContent =
totalDistance.toFixed(2) + " miles";

if(totalDistance >= goalDistance){

navigator.geolocation.clearWatch(watchId);

alert("Goal reached!");

}

}

}

previousPosition = {latitude:lat, longitude:lon};

}


// ===============================
// STEP COUNTER
// ===============================

async function startStepCounter(){

// request motion permission (iPhone)
if(typeof DeviceMotionEvent !== "undefined" &&
typeof DeviceMotionEvent.requestPermission === "function"){

try{

const permission = await DeviceMotionEvent.requestPermission();

if(permission === "granted"){
activateStepDetection();
}

}catch(err){
console.log("Motion permission denied");
}

}else{

// Android automatically allowed
activateStepDetection();

}

}


// ===============================
// IMPROVED STEP COUNTER
// ===============================

let lastStepTime = 0;
const STEP_THRESHOLD = 12.3;      // higher = less sensitive
const STEP_DELAY = 400;          // milliseconds between steps

if(window.DeviceMotionEvent){

window.addEventListener("devicemotion", function(event){

const acc = event.accelerationIncludingGravity;
if(!acc) return;

const magnitude = Math.sqrt(
acc.x * acc.x +
acc.y * acc.y +
acc.z * acc.z
);

const delta = Math.abs(magnitude - lastAcceleration);

const now = Date.now();

// detect step
if(delta > STEP_THRESHOLD && (now - lastStepTime) > STEP_DELAY){

stepCount++;
stepDisplay.textContent = stepCount;

lastStepTime = now;

}

lastAcceleration = magnitude;

});

}


// ===============================
// DISTANCE FORMULA
// ===============================

function calculateDistance(lat1, lon1, lat2, lon2){

const R = 3958.8;

const toRad = deg => deg * Math.PI / 180;

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


// ===============================
// ERROR HANDLING
// ===============================

function handleError(error){

alert("GPS Error: " + error.message);

}

