// Step counter logic
let steps = 0;
const stepsDisplay = document.getElementById('steps');
const startButton = document.getElementById('start-button');

startButton.addEventListener('click', () => {
  const distanceInput = document.getElementById('distance-input').value;
  const distance = parseFloat(distanceInput);
  if (isNaN(distance) || distance <= 0) {
    alert('Please enter a valid distance.');
    return;
  }

  // Approximate: 2000 steps per mile
  steps = Math.round(distance * 2000);
  stepsDisplay.textContent = steps;

  // Add a simple achievement
  const achievementList = document.getElementById('achievement-list');
  const li = document.createElement('li');
  li.textContent = `Completed ${distance} miles!`;
  achievementList.appendChild(li);
});

// Avatar selection
const avatars = document.querySelectorAll('.avatar-option');
avatars.forEach(av => {
  av.addEventListener('click', () => {
    avatars.forEach(a => a.classList.remove('selected'));
    av.classList.add('selected');
  });
});