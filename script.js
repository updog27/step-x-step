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
const map = L.map('map').setView([27.9506, -82.4572], 13);

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
async function generateRoutes() {

  const distance = parseFloat(distanceInput.value);
  const unit = distanceUnit.value;

  if (isNaN(distance) || distance <= 0) {
    alert("Please enter a valid distance");
    return;
  }

  // clear previous routes
  routeList.innerHTML = '';
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];

  // convert to meters
  let meters = distance;

  if (unit === "miles") meters = distance * 1609.34;
  if (unit === "km") meters = distance * 1000;

  navigator.geolocation.getCurrentPosition(async function(pos) {

    const startLat = pos.coords.latitude;
    const startLng = pos.coords.longitude;

    map.setView([startLat, startLng], 15);

    const directions = [0, 120, 240];

    for (let i = 0; i < directions.length; i++) {

      const angle = directions[i] * Math.PI / 180;

      const offsetLat = startLat + (meters / 111111) * Math.cos(angle);
      const offsetLng = startLng + (meters / (111111 * Math.cos(startLat))) * Math.sin(angle);

      try {

        const response = await fetch(
          "https://api.openrouteservice.org/v2/directions/foot-walking",
          {
            method: "POST",
            headers: {
              "Authorization": "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjQ1MWI1ZTUyYjlhZjQ3YmFhNzkyZWRkMDMwNDJhMDk5IiwiaCI6Im11cm11cjY0In0=",
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

        const data = await response.json();

        console.log("ORS Response:", data);

        if (!data.features) {
          console.error("No route returned from ORS");
          continue;
        }

        const coords = data.features[0].geometry.coordinates;

        const latlngs = coords.map(c => [c[1], c[0]]);

        const polyline = L.polyline(latlngs, {
          color: "blue",
          weight: 4
        }).addTo(map);

        routeLayers.push(polyline);

        const item = document.createElement("li");

        item.textContent = `Route ${i + 1} ~ ${distance} ${unit}`;

        item.onclick = () => {
          map.fitBounds(polyline.getBounds());
        };

        routeList.appendChild(item);

      } catch (error) {

        console.error("Routing error:", error);

      }
    }

  },
  function(error) {

    alert("Location permission required.");

  });

}

// ----------------------
// Button Event
// ----------------------
startButton.addEventListener("click", generateRoutes);

