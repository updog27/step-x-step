let steps = 0;
let lastStepTime = 0;

const STEP_COOLDOWN = 400; // ms between steps (prevents rapid counting)
const STEP_THRESHOLD = 12; // sensitivity (higher = less sensitive)

let distance = 0;
let targetDistance = 0;
let unit = "miles";

const stepsEl = document.getElementById("steps");
const distanceEl = document.getElementById("distance");
const inputDistance = document.getElementById("distanceInput");
const unitSelect = document.getElementById("unitSelect");
const startBtn = document.getElementById("startBtn");

startBtn.addEventListener("click", startTracking);

function startTracking() {
  steps = 0;
  distance = 0;
  lastStepTime = 0;

  targetDistance = parseFloat(inputDistance.value) || 0;
  unit = unitSelect.value;

  updateUI();

  // iPhone permission request
  if (typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function") {
    DeviceMotionEvent.requestPermission().then(permission => {
      if (permission === "granted") {
        window.addEventListener("devicemotion", handleMotion);
      } else {
        alert("Motion permission denied");
      }
    });
  } else {
    window.addEventListener("devicemotion", handleMotion);
  }
}

function handleMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  const totalAcceleration =
    Math.abs(acc.x || 0) +
    Math.abs(acc.y || 0) +
    Math.abs(acc.z || 0);

  const now = Date.now();

  // FILTER #1: Minimum movement strength
  if (totalAcceleration > STEP_THRESHOLD) {

    // FILTER #2: Cooldown between steps
    if (now - lastStepTime > STEP_COOLDOWN) {
      lastStepTime = now;
      steps++;
      updateDistance();
      updateUI();
    }
  }
}

function updateDistance() {
  const strideMeters = 0.78; // avg step length
  const meters = steps * strideMeters;

  if (unit === "miles") {
    distance = meters / 1609;
  } else {
    distance = meters / 1000;
  }
}

function updateUI() {
  stepsEl.textContent = steps;
  distanceEl.textContent = distance.toFixed(3);
}
