// ===== Step x Step App Script =====

let steps = 0;
let lastStepTime = 0;

const STEP_COOLDOWN = 400; // ms between steps
const STEP_THRESHOLD = 12; // magnitude threshold for step detection

let distance = 0;
let targetDistance = 0;
let unit = "miles";

// DOM Elements
const stepsEl = document.getElementById("steps");
const distanceEl = document.getElementById("distance");
const inputDistance = document.getElementById("distance-input");
const unitSelect = document.getElementById("unit-select");
const startBtn = document.getElementById("start-button");

// ===== Start Button Logic =====
startBtn.addEventListener("click", async () => {
  // Reset counters
  steps = 0;
  distance = 0;
  lastStepTime = 0;
  updateUI();

  targetDistance = parseFloat(inputDistance.value) || 0;
  unit = unitSelect.value;

  // iOS motion permission
  if (typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission === "granted") {
        window.addEventListener("devicemotion", handleMotion);
        console.log("Motion permission granted");
      } else {
        alert("Motion permission denied. Steps won't count.");
      }
    } catch (e) {
      alert("Error requesting motion permission");
      console.error(e);
    }
  } else {
    // Android / normal browsers
    window.addEventListener("devicemotion", handleMotion);
  }
});

// ===== Handle Motion Event =====
function handleMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  const x = acc.x || 0;
  const y = acc.y || 0;
  const z = acc.z || 0;

  // Vector magnitude
  const magnitude = Math.sqrt(x * x + y * y + z * z);

  const now = Date.now();

  if (magnitude > STEP_THRESHOLD) {
    if (now - lastStepTime > STEP_COOLDOWN) {
      lastStepTime = now;
      steps++;
      updateDistance();
      updateUI();
    }
  }
}

// ===== Update Distance Based on Steps =====
function updateDistance() {
  const strideMeters = 0.78; // average step length

  const meters = steps * strideMeters;

  if (unit === "miles") {
    distance = meters / 1609;
  } else {
    distance = meters / 1000;
  }
}

// ===== Update UI =====
function updateUI() {
  stepsEl.textContent = steps;
  if (distanceEl) {
    distanceEl.textContent = distance.toFixed(3);
  }
}


