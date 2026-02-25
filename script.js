const distanceInput = document.getElementById("distance-input");
const distanceUnit = document.getElementById("distance-unit");
const startButton = document.getElementById("start-button");
const achievementList = document.getElementById("achievement-list");
const stepsDisplay = document.getElementById("steps");
const totalStepsDisplay = document.getElementById("total-steps");
const resetButton = document.getElementById("reset-steps-button");

// Track cumulative steps
let totalSteps = 0;

// Update placeholder when unit changes
distanceUnit.addEventListener("change", function() {
  const unit = distanceUnit.value;
  distanceInput.placeholder = `Distance (${unit === "miles" ? "miles" : "km"})`;
});

// Start button logic
startButton.addEventListener("click", function() {
  let distance = parseFloat(distanceInput.value);
  let unit = distanceUnit.value;

  if (isNaN(distance) || distance <= 0) {
    alert("Please enter a valid distance.");
    return;
  }

  let displayDistance = distance;

  // Convert km to miles for step calculation
  if (unit === "kilometers") {
    distance = distance * 0.621371;
  }

  let steps = Math.round(distance * 2000);
  stepsDisplay.textContent = steps;

  totalSteps += steps;
  totalStepsDisplay.textContent = totalSteps;

  const li = document.createElement("li");
  li.textContent = `Started a ${displayDistance.toFixed(2)} ${unit} route!`;
  achievementList.appendChild(li);

  distanceInput.value = "";
});

// Reset total steps
resetButton.addEventListener("click", function() {
  totalSteps = 0;
  totalStepsDisplay.textContent = totalSteps;
  alert("Total steps have been reset!");
});

// Avatar selection
let avatars = document.querySelectorAll(".avatar-option");
avatars.forEach(avatar => {
  avatar.addEventListener("click", function() {
    avatars.forEach(a => a.classList.remove("selected"));
    avatar.classList.add("selected");
  });
});
