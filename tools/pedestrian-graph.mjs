// Pure OSM pedestrian graph primitives. No network or user-location access.
const EARTH_RADIUS_METERS = 6371008.8;
const radians = value => value * Math.PI / 180;

export function haversineMeters(a, b) {
  const p1 = radians(a.lat), p2 = radians(b.lat);
  const dp = radians(b.lat - a.lat), dl = radians(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function isEligiblePedestrianWay(tags = {}) {
  const highway = tags.highway;
  const excluded = ["proposed", "construction", "abandoned", "raceway", "bus_guideway",
    "motorway", "motorway_link", "trunk", "trunk_link", "service", "parking_aisle"];
  if (!highway || excluded.includes(highway)) return false;
  if (["no", "private", "customers", "delivery"].includes(tags.access) ||
      ["no", "private"].includes(tags.foot)) return false;
  if (["footway", "path", "pedestrian", "steps"].includes(highway)) return true;
  if (highway === "cycleway" && tags.foot === "yes") return true;
  return ["residential", "living_street", "tertiary", "tertiary_link", "secondary", "secondary_link"].includes(highway)
    && ["both", "left", "right", "yes"].includes(tags.sidewalk);
}

export function pedestrianDirections(tags = {}) {
  return {
    forward: tags["foot:forward"] !== "no" && tags["oneway:foot"] !== "-1",
    backward: tags["foot:backward"] !== "no" && tags["oneway:foot"] !== "yes"
  };
}

// nodes: Map(id -> {id,lat,lon}); ways: [{id,nodes:[...],tags:{...}}]
export function buildDirectedPedestrianGraph(nodes, ways, maxEdgeMeters = 250) {
  const adjacency = new Map();
  const add = (from, to, meters, wayId) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, meters, wayId });
  };
  for (const way of ways) {
    if (!isEligiblePedestrianWay(way.tags)) continue;
    const direction = pedestrianDirections(way.tags);
    for (let i = 1; i < way.nodes.length; i++) {
      const from = nodes.get(way.nodes[i - 1]), to = nodes.get(way.nodes[i]);
      if (!from || !to) continue;
      const meters = haversineMeters(from, to);
      if (!(meters > 0 && meters < maxEdgeMeters)) continue;
      if (direction.forward) add(from.id, to.id, meters, way.id);
      if (direction.backward) add(to.id, from.id, meters, way.id);
    }
  }
  return adjacency;
}

export function dijkstra(adjacency, start, maxDistanceMeters = Infinity) {
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const queue = [[0, start]];
  while (queue.length) {
    queue.sort((a, b) => b[0] - a[0]);
    const [cost, id] = queue.pop();
    if (cost !== distances.get(id) || cost > maxDistanceMeters) continue;
    for (const edge of adjacency.get(id) || []) {
      const next = cost + edge.meters;
      if (next < (distances.get(edge.to) ?? Infinity) && next <= maxDistanceMeters) {
        distances.set(edge.to, next);
        previous.set(edge.to, id);
        queue.push([next, edge.to]);
      }
    }
  }
  return { distances, previous };
}

export function reconstructNodePath(previous, start, end) {
  if (start === end) return [start];
  if (!previous.has(end)) return null;
  const path = [end];
  let current = end;
  while (current !== start) {
    current = previous.get(current);
    if (current === undefined) return null;
    path.push(current);
  }
  return path.reverse();
}
