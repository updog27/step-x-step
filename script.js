// ----------------------
// DOM Elements
// ----------------------
const distanceInput = document.getElementById("distance-input");
const distanceUnit = document.getElementById("distance-unit");
const routeTypeSelect = document.getElementById("route-type");
const startButton = document.getElementById("start-button");
const routeList = document.getElementById("route-list");

// ----------------------
// Map Setup
// ----------------------
const map = L.map("map").setView([27.9506, -82.4572], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let routeLayers = [];

// ----------------------
// Route Generator
// ----------------------
async function generateRoutes() {

  const distance = parseFloat(distanceInput.value);
  const unit = distanceUnit.value;

  if (isNaN(distance) || distance <= 0) {
    alert("Enter a valid distance");
    return;
  }

  routeList.innerHTML = "";
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];

  let meters = distance;
  if (unit === "miles") meters = distance * 1609.34;
  if (unit === "km") meters = distance * 1000;

  navigator.geolocation.getCurrentPosition(async function(pos) {

    const startLat = pos.coords.latitude;
    const startLng = pos.coords.longitude;

    map.setView([startLat, startLng], 15);

    const directions = [0,120,240];

    for (let i = 0; i < directions.length; i++) {

      const angle = directions[i] * Math.PI / 180;

      const offsetLat = startLat + (meters / 111111) * Math.cos(angle);
      const offsetLng = startLng + (meters / (111111 * Math.cos(startLat))) * Math.sin(angle);

      try {

        const response = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking", {
          method: "POST",
          headers: {
            "Authorization": "YOUR_ORS_API_KEY",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            coordinates: [
              [startLng, startLat],
              [offsetLng, offsetLat]
            ]
          })
        });

        const data = await response.json();

        console.log("ORS response:", data);

        if (!data.features) {
          console.error("No route returned");
          continue;
        }

        const coords = data.features[0].geometry.coordinates;

        const latlngs = coords.map(c => [c[1], c[0]]);

        const polyline = L.polyline(latlngs, { color: "blue" }).addTo(map);

        routeLayers.push(polyline);

        const item = document.createElement("li");

        item.textContent = `Route ${i+1} ~ ${distance} ${unit}`;

        item.onclick = () => map.fitBounds(polyline.getBounds());

        routeList.appendChild(item);

      } catch (error) {
        console.error("Routing error:", error);
      }

    }

  });

}

        const data = await response.json();

        if (!data.features) {
          console.log("Route error:", data);
          continue;
        }

        const coords = data.features[0].geometry.coordinates;

        const latlngs = coords.map(c => [c[1],c[0]]);

        const polyline = L.polyline(latlngs,{
          color:"blue",
          weight:5
        }).addTo(map);

        routeLayers.push(polyline);

        const li = document.createElement("li");

        li.textContent = `Route ${i+1} ~ ${distance} ${unit}`;

        li.onclick = () => {
          map.fitBounds(polyline.getBounds());
        };

        routeList.appendChild(li);

      } catch(err) {

        console.log("Routing failed:", err);

      }

    }

  });

}

// ----------------------
// Button Event
// ----------------------
startButton.addEventListener("click", generateRoutes);

