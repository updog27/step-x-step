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
  const queue = [];
  const push = item => {
    queue.push(item);
    let index = queue.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (queue[parent][0] <= item[0]) break;
      queue[index] = queue[parent];
      index = parent;
    }
    queue[index] = item;
  };
  const pop = () => {
    if (!queue.length) return null;
    const root = queue[0], last = queue.pop();
    if (queue.length) {
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= queue.length) break;
        if (child + 1 < queue.length && queue[child + 1][0] < queue[child][0]) child++;
        if (queue[child][0] >= last[0]) break;
        queue[index] = queue[child];
        index = child;
      }
      queue[index] = last;
    }
    return root;
  };
  push([0, start]);
  while (queue.length) {
    const [cost, id] = pop();
    if (cost !== distances.get(id) || cost > maxDistanceMeters) continue;
    for (const edge of adjacency.get(id) || []) {
      const next = cost + edge.meters;
      if (next < (distances.get(edge.to) ?? Infinity) && next <= maxDistanceMeters) {
        distances.set(edge.to, next);
        previous.set(edge.to, id);
        push([next, edge.to]);
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


const directedEdgeKey = (from, to) => JSON.stringify([from, to]);

function shortestPath(adjacency, start, end, options = {}) {
  const bannedNodes = options.bannedNodes || new Set();
  const bannedEdges = options.bannedEdges || new Set();
  const maxDistanceMeters = options.maxDistanceMeters ?? Infinity;
  if (bannedNodes.has(start) || bannedNodes.has(end)) return null;

  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const queue = [];
  const push = item => {
    queue.push(item);
    let index = queue.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (queue[parent][0] <= item[0]) break;
      queue[index] = queue[parent];
      index = parent;
    }
    queue[index] = item;
  };
  const pop = () => {
    if (!queue.length) return null;
    const root = queue[0], last = queue.pop();
    if (queue.length) {
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= queue.length) break;
        if (child + 1 < queue.length && queue[child + 1][0] < queue[child][0]) child++;
        if (queue[child][0] >= last[0]) break;
        queue[index] = queue[child];
        index = child;
      }
      queue[index] = last;
    }
    return root;
  };

  push([0, start]);
  while (queue.length) {
    const [cost, node] = pop();
    if (cost !== distances.get(node) || cost > maxDistanceMeters) continue;
    if (node === end) break;
    for (const edge of adjacency.get(node) || []) {
      if (bannedNodes.has(edge.to) || bannedEdges.has(directedEdgeKey(node, edge.to))) continue;
      const next = cost + edge.meters;
      if (next < (distances.get(edge.to) ?? Infinity) && next <= maxDistanceMeters) {
        distances.set(edge.to, next);
        previous.set(edge.to, node);
        push([next, edge.to]);
      }
    }
  }
  if (!distances.has(end)) return null;
  const nodes = reconstructNodePath(previous, start, end);
  return {nodes, distanceMeters:distances.get(end)};
}

function pathDistance(adjacency, nodes) {
  let total = 0;
  for (let i = 1; i < nodes.length; i++) {
    const edge = (adjacency.get(nodes[i - 1]) || []).find(item => item.to === nodes[i]);
    if (!edge) return Infinity;
    total += edge.meters;
  }
  return total;
}

// Yen's loopless k-shortest paths. Results are ordered by network distance.
// This finds alternatives to one endpoint; it does not by itself prove that
// alternatives are sufficiently different for a useful user-facing choice.
export function kShortestPaths(adjacency, start, end, k = 3, options = {}) {
  if (!Number.isInteger(k) || k < 1 || k > 10) throw new RangeError("k must be an integer from 1 to 10");
  const first = shortestPath(adjacency, start, end, options);
  if (!first) return [];
  const accepted = [first];
  const candidates = new Map();
  const maxDistanceMeters = options.maxDistanceMeters ?? Infinity;

  for (let index = 1; index < k; index++) {
    const previousPath = accepted[index - 1];
    for (let spurIndex = 0; spurIndex < previousPath.nodes.length - 1; spurIndex++) {
      const root = previousPath.nodes.slice(0, spurIndex + 1);
      const spurNode = root[root.length - 1];
      const bannedEdges = new Set();
      for (const path of accepted) {
        if (path.nodes.length > spurIndex + 1 &&
            root.every((node, i) => path.nodes[i] === node)) {
          bannedEdges.add(directedEdgeKey(path.nodes[spurIndex], path.nodes[spurIndex + 1]));
        }
      }
      const bannedNodes = new Set(root.slice(0, -1));
      const spur = shortestPath(adjacency, spurNode, end, {
        bannedNodes, bannedEdges, maxDistanceMeters
      });
      if (!spur) continue;
      const combinedNodes = root.slice(0, -1).concat(spur.nodes);
      const key = JSON.stringify(combinedNodes);
      if (accepted.some(path => JSON.stringify(path.nodes) === key) || candidates.has(key)) continue;
      const distanceMeters = pathDistance(adjacency, combinedNodes);
      if (distanceMeters <= maxDistanceMeters) candidates.set(key, {nodes:combinedNodes,distanceMeters});
    }
    if (!candidates.size) break;
    const best = [...candidates.entries()].sort((a,b) =>
      a[1].distanceMeters - b[1].distanceMeters || a[0].localeCompare(b[0]))[0];
    accepted.push(best[1]);
    candidates.delete(best[0]);
  }
  return accepted;
}


// Directed-edge Jaccard overlap: 0 means no shared directed edges, 1 means identical.
export function directedPathOverlap(pathA, pathB) {
  const edges = path => new Set(path.slice(1).map((node,index) =>
    directedEdgeKey(path[index],node)));
  const a = edges(pathA), b = edges(pathB);
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const edge of a) if (b.has(edge)) shared++;
  return shared / (a.size + b.size - shared);
}

// Greedily retain short paths that add meaningful new directed-edge coverage.
// The first (shortest) path is always retained; later paths must meet the
// configured overlap ceiling against every already-selected path.
export function selectDiversePaths(paths, maxPaths = 3, maxOverlap = 0.65) {
  if (!Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > 10) {
    throw new RangeError("maxPaths must be an integer from 1 to 10");
  }
  if (!Number.isFinite(maxOverlap) || maxOverlap < 0 || maxOverlap > 1) {
    throw new RangeError("maxOverlap must be between 0 and 1");
  }
  const ordered = [...paths].sort((a,b) =>
    a.distanceMeters - b.distanceMeters ||
    JSON.stringify(a.nodes).localeCompare(JSON.stringify(b.nodes)));
  const selected = [];
  for (const candidate of ordered) {
    if (selected.every(existing =>
      directedPathOverlap(existing.nodes,candidate.nodes) <= maxOverlap)) {
      selected.push(candidate);
      if (selected.length >= maxPaths) break;
    }
  }
  return selected.map(path => ({
    ...path,
    maxOverlapWithSelected: selected.length === 1 ? 0 :
      Math.max(...selected.filter(other => other !== path)
        .map(other => directedPathOverlap(path.nodes,other.nodes)))
  }));
}


// Weighted Jaccard overlap by OSM way ID. This treats differently segmented
// edges on the same mapped way as one corridor. It is a corridor proxy:
// separate OSM ways can still describe the same physical street.
export function corridorPathOverlap(adjacency, pathA, pathB) {
  const weightsFor = path => {
    const weights = new Map();
    for (let i = 1; i < path.length; i++) {
      const edge = (adjacency.get(path[i - 1]) || [])
        .filter(item => item.to === path[i])
        .sort((a,b) => a.meters - b.meters)[0];
      if (!edge) continue;
      const key = String(edge.wayId ?? directedEdgeKey(path[i - 1],path[i]));
      weights.set(key,(weights.get(key) || 0) + edge.meters);
    }
    return weights;
  };
  const a = weightsFor(pathA), b = weightsFor(pathB);
  const keys = new Set([...a.keys(),...b.keys()]);
  if (!keys.size) return 1;
  let intersection = 0, union = 0;
  for (const key of keys) {
    intersection += Math.min(a.get(key) || 0,b.get(key) || 0);
    union += Math.max(a.get(key) || 0,b.get(key) || 0);
  }
  return union ? intersection / union : 1;
}

export function selectCorridorDiversePaths(adjacency, paths, maxPaths = 3, maxOverlap = 0.55) {
  if (!Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > 10) {
    throw new RangeError("maxPaths must be an integer from 1 to 10");
  }
  if (!Number.isFinite(maxOverlap) || maxOverlap < 0 || maxOverlap > 1) {
    throw new RangeError("maxOverlap must be between 0 and 1");
  }
  const ordered = [...paths].sort((a,b) =>
    a.distanceMeters - b.distanceMeters ||
    JSON.stringify(a.nodes).localeCompare(JSON.stringify(b.nodes)));
  const selected = [];
  for (const candidate of ordered) {
    if (selected.every(existing =>
      corridorPathOverlap(adjacency,existing.nodes,candidate.nodes) <= maxOverlap)) {
      selected.push(candidate);
      if (selected.length >= maxPaths) break;
    }
  }
  return selected.map(path => ({
    ...path,
    maxCorridorOverlapWithSelected: selected.length === 1 ? 0 :
      Math.max(...selected.filter(other => other !== path)
        .map(other => corridorPathOverlap(adjacency,path.nodes,other.nodes)))
  }));
}


// Project a GPS point onto mapped pedestrian edge geometry using a local
// equirectangular plane. The result is a geometric snap candidate only;
// it does not prove that the straight GPS-to-edge connector is walkable.
export function projectPointToSegment(point, a, b) {
  const cosLat = Math.cos(radians(point.lat));
  const x = coord => radians(coord.lon - point.lon) * EARTH_RADIUS_METERS * cosLat;
  const y = coord => radians(coord.lat - point.lat) * EARTH_RADIUS_METERS;
  const ax=x(a), ay=y(a), bx=x(b), by=y(b);
  const dx=bx-ax, dy=by-ay, lengthSquared=dx*dx+dy*dy;
  const fraction=lengthSquared ? Math.max(0,Math.min(1,-(ax*dx+ay*dy)/lengthSquared)) : 0;
  const px=ax+fraction*dx, py=ay+fraction*dy;
  const projected={lat:point.lat+py/EARTH_RADIUS_METERS*180/Math.PI,
    lon:point.lon+px/(EARTH_RADIUS_METERS*cosLat)*180/Math.PI};
  return {fraction,point:projected,offsetMeters:Math.hypot(px,py)};
}

// Finds the closest directed graph edge. Direction is preserved in the
// returned edge descriptor; callers must still validate an actual connector.
export function findNearestPedestrianEdge(nodes, adjacency, origin, maxSnapMeters=60) {
  if (!Number.isFinite(maxSnapMeters) || maxSnapMeters < 0) {
    throw new RangeError("maxSnapMeters must be a non-negative finite number");
  }
  let best=null;
  for (const [from,edges] of adjacency) {
    const a=nodes.get(from);
    if (!a) continue;
    for (const edge of edges) {
      const b=nodes.get(edge.to);
      if (!b) continue;
      const projection=projectPointToSegment(origin,a,b);
      if (!best || projection.offsetMeters < best.offsetMeters) {
        best={from,to:edge.to,wayId:edge.wayId,meters:edge.meters,
          fraction:projection.fraction,point:projection.point,
          offsetMeters:projection.offsetMeters};
      }
    }
  }
  if (!best || best.offsetMeters > maxSnapMeters) return null;
  return best;
}

// Split only the selected mapped segment at a virtual point. Existing
// directed arcs are replaced with direction-preserving sub-arcs; no new
// reverse direction is invented. Edge metadata (including wayId) is retained.
export function splitPedestrianEdgeAtProjection(adjacency, projection, virtualNodeId) {
  if (!projection || projection.from === undefined || projection.to === undefined ||
      !Number.isFinite(projection.fraction) || projection.fraction <= 0 ||
      projection.fraction >= 1 || virtualNodeId === undefined) {
    throw new TypeError("A valid interior edge projection and virtual node ID are required");
  }
  const next=new Map();
  for (const [from,edges] of adjacency) {
    next.set(from,edges.map(edge=>({...edge})));
  }
  next.set(virtualNodeId,[]);
  const forward=(next.get(projection.from)||[]);
  const index=forward.findIndex(edge=>edge.to===projection.to && edge.wayId===projection.wayId);
  if (index < 0) throw new Error("Projected directed edge no longer exists in graph");
  const edge=forward[index];
  forward.splice(index,1);
  const firstMeters=edge.meters*projection.fraction;
  const secondMeters=edge.meters-firstMeters;
  forward.push({to:virtualNodeId,meters:firstMeters,wayId:edge.wayId});
  next.get(virtualNodeId).push({to:projection.to,meters:secondMeters,wayId:edge.wayId});

  // If the exact reverse arc exists, split it too, but preserve its own
  // direction. One-way pedestrian edges remain one-way.
  const reverse=(next.get(projection.to)||[]);
  const reverseIndex=reverse.findIndex(item=>item.to===projection.from && item.wayId===projection.wayId);
  if (reverseIndex >= 0) {
    const reverseEdge=reverse[reverseIndex];
    reverse.splice(reverseIndex,1);
    reverse.push({to:virtualNodeId,meters:reverseEdge.meters*(1-projection.fraction),wayId:reverseEdge.wayId});
    next.get(virtualNodeId).push({to:projection.from,meters:reverseEdge.meters*projection.fraction,wayId:reverseEdge.wayId});
  }
  return next;
}
