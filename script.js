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
const map = L.map('map').setView([27.9506, -82.4572], 13); // Tampa default
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

// Handle phone motion for steps
function handleMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;
  const z = acc.z || 0;
  const now = Date.now();
  const delta = Math.abs(z);

  if (delta > STEP_THRESHOLD) {
    if (now - lastStepTime > STEP_COOLDOWN) {
      lastStepTime = now;
      steps++;
      updateUI();
    }
  }
}

if (window.DeviceMotionEvent) {
  window.addEventListener('devicemotion', handleMotion, true);
}

// ----------------------
// Route Generation
// ----------------------
function generateRoutes() {
  const distance = parseFloat(distanceInput.value);
  const unit = distanceUnit.value;
  const routeType = routeTypeSelect.value;

  if (isNaN(distance) || distance <= 0) {
    alert('Please enter a valid distance');
    return;
  }

  // Clear previous routes
  routeList.innerHTML = '';
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];

  // Example: Generate 3 simple "mock" routes (random offsets for demo)
  for (let i = 1; i <= 3; i++) {
    const lat = 27.9506 + Math.random() * 0.01 * i;
    const lng = -82.4572 + Math.random() * 0.01 * i;
    const lat2 = lat + 0.005;
    const lng2 = lng + 0.005;

    const polyline = L.polyline([[lat, lng], [lat2, lng2]], { color: 'blue' }).addTo(map);
    routeLayers.push(polyline);

    const routeItem = document.createElement('li');
    routeItem.textContent = `${routeType} route #${i} ~ ${distance} ${unit}`;
    routeItem.onclick = () => {
      map.fitBounds(polyline.getBounds());
    };
    routeList.appendChild(routeItem);
  }
}

// ----------------------
// Button Events
// ----------------------
startButton.addEventListener('click', generateRoutes);
