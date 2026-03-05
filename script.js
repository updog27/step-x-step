// ----------------------
// Step Counter Variables
// ----------------------
let steps = 0;
let lastStepTime = 0;
const STEP_THRESHOLD = 12.3;
const STEP_COOLDOWN = 400;

// ----------------------
// DOM Elements
// ----------------------
const stepsSpan = document.getElementById('steps');
const distanceInput = document.getElementById('distance-input');
const distanceUnit = document.getElementById('distance-unit');
const routeTypeSelect = document.getElementById('route-type');
const startButton = document.getElementById('start-button');
const routeList = document.getElementById('route-list');

// ----------------------
// Map Setup
// ----------------------
const map = L.map('map').setView([27.9506, -82.4572], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let routeLayers = [];

// ----------------------
// Step Counter
// ----------------------
function updateUI() {
  stepsSpan.textContent = steps;
}

function handleMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  const z = acc.z || 0;
  const delta = Math.abs(z);
  const now = Date.now();

  if (delta > STEP_THRESHOLD && now - lastStepTime > STEP_COOLDOWN) {
    lastStepTime = now;
    steps++;
    updateUI();
  }
}

if (window.DeviceMotionEvent) {
  window.addEventListener('devicemotion', handleMotion, true);
}

// ----------------------
// Route Generation (Static Test Route)
// ----------------------
function generateRoutes() {
  // Clear previous routes
  routeList.innerHTML = '';
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];

  // Static test route along Tampa streets
  const coords = [
    [27.950618, -82.457176], // start
    [27.951200, -82.456000], // mid-point
    [27.952354, -82.454902]  // end
  ];

  const polyline = L.polyline(coords, { color: "red", weight: 4 }).addTo(map);
  routeLayers.push(polyline);

  // Fit map to route
  map.fitBounds(polyline.getBounds());

  // Add list item
  const item = document.createElement("li");
  item.textContent = "Static Test Route";
  item.onclick = () => map.fitBounds(polyline.getBounds());
  routeList.appendChild(item);
}

// ----------------------
// Button Event
// ----------------------
startButton.addEventListener("click", generateRoutes);
