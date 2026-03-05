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
// Pre-verified walking coordinates for 3 routes
// ----------------------
const preVerifiedRoutes = [
  // Route 1
  [
    [27.950618, -82.457176],
    [27.951200, -82.456000]
  ],
  // Route 2
  [
    [27.950618, -82.457176],
    [27.949900, -82.455800]
  ],
  // Route 3
  [
    [27.950618, -82.457176],
    [27.952000, -82.455500]
  ]
];

// ----------------------
// Route Generation using ORS
// ----------------------
async function generateRoutes() {
  const distance = parseFloat(distanceInput.value);
  const unit = distanceUnit.value;

  if (isNaN(distance) || distance <= 0) {
    alert("Please enter a valid distance");
    return;
  }

  // Clear previous routes
  routeList.innerHTML = '';
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];

  for (let i = 0; i < preVerifiedRoutes.length; i++) {
    const coords = preVerifiedRoutes[i];
    const start = coords[0];
    const end = coords[1];

    try {
      const response = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking", {
        method: "POST",
        headers: {
          "Authorization": "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjYzZjhiZWRhMmFhMzQyM2E5ODk1ZGZiM2I4ZWExNmIyIiwiaCI6Im11cm11cjY0In0=", // <-- Replace with your new walking-enabled key
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          coordinates: [
            [start[1], start[0]], // [lng, lat]
            [end[1], end[0]]
          ]
        })
      });

      if (!response.ok) {
        console.error(`ORS request failed: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();

      if (!data.features || data.features.length === 0) {
        console.error("No route returned from ORS for Route", i + 1);
        continue;
      }

      const routeCoords = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
      const polyline = L.polyline(routeCoords, { color: "blue", weight: 4 }).addTo(map);
      routeLayers.push(polyline);

      const item = document.createElement("li");
      item.textContent = `Route ${i + 1} ~ ${distance} ${unit}`;
      item.onclick = () => map.fitBounds(polyline.getBounds());
      routeList.appendChild(item);

    } catch (error) {
      console.error("Routing error:", error);
    }
  }

  if (routeLayers.length > 0) {
    map.fitBounds(routeLayers[0].getBounds());
  }
}

// ----------------------
// Button Event
// ----------------------
startButton.addEventListener("click", generateRoutes);
