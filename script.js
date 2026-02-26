// Get DOM elements
const distanceInput = document.getElementById('distance-input');
const unitType = document.getElementById('unit-type');
const routeType = document.getElementById('route-type');
const startButton = document.getElementById('start-button');
const stepsDisplay = document.getElementById('steps');
const achievementList = document.getElementById('achievement-list');
const avatarOptions = document.querySelectorAll('.avatar-option');

// Default values
let steps = 0;
let selectedAvatar = null;
let stepInterval = null;

// Function to calculate total steps based on distance
function calculateSteps(distance, unit) {
  if (unit === 'miles') {
    return Math.round(distance * 2000);
  } else if (unit === 'kilometers') {
    return Math.round(distance * 1312);
  } else {
    return 0;
  }
}

// Function to convert steps back to distance for display
function stepsToDistance(steps, unit) {
  if (unit === 'miles') {
    return (steps / 2000).toFixed(2);
  } else if (unit === 'kilometers') {
    return (steps / 1312).toFixed(2);
  } else {
    return 0;
  }
}

// Function to animate step counter
function startStepCounter() {
  const distance = parseFloat(distanceInput.value);
  const unit = unitType.value;

  if (isNaN(distance) || distance <= 0) {
    alert('Please enter a valid distance.');
    return;
  }

  // Clear any previous interval
  if (stepInterval) {
    clearInterval(stepInterval);
  }

  const totalSteps = calculateSteps(distance, unit);
  steps = 0;
  stepsDisplay.textContent = steps;
  achievementList.innerHTML = '';

  // Increment steps dynamically
  stepInterval = setInterval(() => {
    steps++;
    const currentDistance = stepsToDistance(steps, unit);
    stepsDisplay.textContent = `${steps} steps (${currentDistance} ${unit})`;

    // Achievements
    if (steps === 5000) {
      const li = document.createElement('li');
      li.textContent = 'Reached 5,000 steps!';
      achievementList.appendChild(li);
    }
    if (steps === 10000) {
      const li = document.createElement('li');
      li.textContent = 'Reached 10,000 steps!';
      achievementList.appendChild(li);
    }

    // Stop when reaching total steps
    if (steps >= totalSteps) {
      clearInterval(stepInterval);
    }
  }, 10); // Adjust speed: 10ms per step
}

// Avatar selection
avatarOptions.forEach(avatar => {
  avatar.addEventListener('click', () => {
    avatarOptions.forEach(a => a.classList.remove('selected'));
    avatar.classList.add('selected');
    selectedAvatar = avatar.dataset.avatar;
  });
});

// Start button event
startButton.addEventListener('click', startStepCounter);