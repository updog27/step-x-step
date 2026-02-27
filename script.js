// DOM Elements
const distanceInput = document.getElementById('distance-input');
const unitType = document.getElementById('unit-type');
const startButton = document.getElementById('start-button');
const stepsDisplay = document.getElementById('steps');
const achievementList = document.getElementById('achievement-list');
const avatarOptions = document.querySelectorAll('.avatar-option');

let steps = 0;
let totalSteps = 0;
let stepInterval = null;

// Convert distance to total steps
function calculateTotalSteps(distance, unit) {
  if (unit === 'miles') return Math.round(distance * 2000);
  if (unit === 'kilometers') return Math.round(distance * 1312);
  return 0;
}

// Convert steps back to distance for display
function stepsToDistance(steps, unit) {
  if (unit === 'miles') return (steps / 2000).toFixed(2);
  if (unit === 'kilometers') return (steps / 1312).toFixed(2);
  return 0;
}

// Start step counter
function startStepCounter() {
  const distance = parseFloat(distanceInput.value);
  const unit = unitType.value;

  if (isNaN(distance) || distance <= 0) {
    alert('Please enter a valid distance.');
    return;
  }

  // Reset previous counter
  clearInterval(stepInterval);
  steps = 0;
  totalSteps = calculateTotalSteps(distance, unit);
  stepsDisplay.textContent = `0 steps (0 ${unit})`;
  achievementList.innerHTML = '';

  // Increment steps visually
  stepInterval = setInterval(() => {
    steps++;
    const displayDistance = stepsToDistance(steps, unit);
    stepsDisplay.textContent = `${steps} steps (${displayDistance} ${unit})`;

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

    if (steps >= totalSteps) {
      clearInterval(stepInterval);
    }
  }, 50); // Adjust speed: smaller = faster
}

// Avatar selection
avatarOptions.forEach(avatar => {
  avatar.addEventListener('click', () => {
    avatarOptions.forEach(a => a.classList.remove('selected'));
    avatar.classList.add('selected');
  });
});

// Event listener
startButton.addEventListener('click', startStepCounter);