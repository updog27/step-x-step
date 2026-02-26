let watchId = null;
let totalDistance = 0;
let previousPosition = null;
let goalDistance = 0;

const startButton = document.getElementById('start-button');
const stepsDisplay = document.getElementById('steps');

startButton.addEventListener('click', () => {
  const distanceInput = document.getElementById('distance-input').value;
  goalDistance = parseFloat(distanceInput);

  if (isNaN(goalDistance) || goalDistance <= 0) {
    alert('Please enter a valid distance.');
    return;
  }

  totalDistance = 0;
  previousPosition = null;
  stepsDisplay.textContent = "0.00 miles";

  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    updatePosition,
    handleError,
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
});

function updatePosition(position) {
  const { latitude, longitude, accuracy } = position.coords;

  // Ignore low accuracy readings
  if (accuracy > 20) return;

  if (previousPosition) {
    const distance = calculateDistance(
      previousPosition.latitude,
      previousPosition.longitude,
      latitude,
      longitude
    );

    // Ignore tiny GPS jitter movements
    if (distance > 0.003) { // ~5 meters
      totalDistance += distance;
      stepsDisplay.textContent = totalDistance.toFixed(2) + " miles";

      if (totalDistance >= goalDistance) {
        navigator.geolocation.clearWatch(watchId);
        alert("Goal reached!");
      }
    }
  }

  previousPosition = { latitude, longitude };
}

function handleError(error) {
  alert("Error getting location: " + error.message);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = angle => (angle * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}