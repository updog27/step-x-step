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
// Route Generation (Working Tampa Test Route)
// ----------------------
async function generateRoutes() {
  // Clear previous routes
  routeList.innerHTML = '';
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];

  // Coordinates along real Tampa streets
  const startLat = 27.950618;
  const startLng = -82.457176;
  const offsetLat = 27.952354;
  const offsetLng = -82.454902;

  console.log("Test route coordinates:", startLat, startLng, offsetLat, offsetLng);

  try {
    const response = await fetch(
      "https://api.openrouteservice.org/v2/directions/foot-walking",
      {
        method: "POST",
        headers: {
          "Authorization": "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjQ1MWI1ZTUyYjlhZjQ3YmFhNzkyZWRkMDMwNDJhMDk5IiwiaCI6Im11cm11cjY0In0=", // <-- REPLACE with your actual key
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          coordinates: [
            [startLng, startLat],
            [offsetLng, offsetLat]
          ]
        })
      }
    );

    if (!response.ok) {
      console.error(`ORS request failed: ${response.status} ${response.statusText}`);
      alert(`Routing error: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();
    console.log("ORS test response:", data);

    if (!data.features || data.features.length === 0) {
      console.error("No route returned from ORS");
      alert("ORS returned no route for test coordinates");
      return;
    }

    const coords = data.features[0].geometry.coordinates;
    const latlngs = coords.map(c => [c[1], c[0]]);

    const polyline = L.polyline(latlngs, { color: "red", weight: 4 }).addTo(map);
    routeLayers.push(polyline);

    map.fitBounds(polyline.getBounds());

    const item = document.createElement("li");
    item.textContent = "Test Route";
    item.onclick = () => map.fitBounds(polyline.getBounds());
    routeList.appendChild(item);

  } catch (error) {
    console.error("Routing error:", error);
    alert("Routing error: " + error);
  }
}

// ----------------------
// Button Event
// ----------------------
startButton.addEventListener("click", generateRoutes);
