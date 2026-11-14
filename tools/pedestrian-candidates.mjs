#!/usr/bin/env node
// Step x Step: private-origin OSM pedestrian graph candidate generator.
// Run locally: STEPX_TEST_LAT=... STEPX_TEST_LON=... node tools/pedestrian-candidates.mjs --miles 0.5,1,2
// Coordinates are never printed or written. This generates candidate network nodes,
// not finished routes; engine routing and safety validation remain separate steps.
import process from "node:process";
import {
  buildDirectedPedestrianGraph, dijkstra, haversineMeters, isEligiblePedestrianWay,
  kShortestPaths, reconstructNodePath, selectCorridorDiversePaths, corridorPathOverlap
} from "./pedestrian-graph.mjs";

const lat = Number(process.env.STEPX_TEST_LAT), lon = Number(process.env.STEPX_TEST_LON);
if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
  console.error("Set valid STEPX_TEST_LAT and STEPX_TEST_LON locally. Coordinates are never printed.");
  process.exit(2);
}
const argv = process.argv.slice(2);
const miArg = argv.includes("--miles") ? argv[argv.indexOf("--miles") + 1] :
  (argv.find(x => x.startsWith("--miles=")) || "--miles=0.5,1,2").split("=")[1];
const miles = String(miArg || "0.5,1,2").split(",").map(Number);
if (!miles.length || miles.some(x => !Number.isFinite(x) || x <= 0 || x > 10)) {
  console.error("Miles must be positive numbers no greater than 10."); process.exit(2);
}
const radius = Number(process.env.OSM_RADIUS_METERS || 1800);
const snapLimit = Number(process.env.OSM_START_SNAP_METERS || 60);
if (!Number.isFinite(radius) || radius < 250 || radius > 5000 ||
    !Number.isFinite(snapLimit) || snapLimit < 5 || snapLimit > 250) {
  console.error("Set OSM_RADIUS_METERS (250–5000) and OSM_START_SNAP_METERS (5–250) within supported bounds.");
  process.exit(2);
}
const endpoint = process.env.OSM_OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const MILE = 1609.344, rad = n => n * Math.PI / 180;
const dy = radius / 111320, dx = radius / (111320 * Math.cos(rad(lat)));
const box = [lat-dy, lon-dx, lat+dy, lon+dx].join(",");
const query = '[out:json][timeout:35];(way["highway"](' + box + '););out body;>;out skel qt;';
const response = await fetch(endpoint, {
  method: "POST",
  headers: {"content-type":"application/x-www-form-urlencoded;charset=UTF-8"},
  body: new URLSearchParams({data:query}),
  signal: AbortSignal.timeout(45000)
});
if (!response.ok) throw new Error("Overpass HTTP " + response.status);
const data = await response.json();
const nodes = new Map(), ways = [];
for (const element of data.elements || []) {
  if (element.type === "node") nodes.set(element.id, {id:element.id,lat:element.lat,lon:element.lon});
  if (element.type === "way") ways.push(element);
}
const adjacency = buildDirectedPedestrianGraph(nodes, ways);
if (!adjacency.size) throw new Error("No eligible directed pedestrian edges found.");

let start = null, snap = Infinity;
for (const id of adjacency.keys()) {
  const node = nodes.get(id);
  const offset = haversineMeters({lat,lon}, node);
  if (offset < snap) { snap = offset; start = id; }
}
if (snap > snapLimit) throw new Error("Nearest eligible graph node exceeds snap limit; no candidates generated.");

const maxOutbound = Math.max(...miles) * MILE / 2 + 100;
const {distances, previous} = dijkstra(adjacency, start, maxOutbound);
const results = miles.map(requestedMiles => {
  const target = requestedMiles * MILE / 2;
  const candidatePool = [...distances.entries()]
    .filter(([id, meters]) => id !== start && Math.abs(meters-target) <= Math.max(20,target*0.035))
    .sort((a,b) => Math.abs(a[1]-target)-Math.abs(b[1]-target));
  const selectedTurnarounds = [];
  for (const candidate of candidatePool) {
    const candidatePath = reconstructNodePath(previous,start,candidate[0]);
    if (selectedTurnarounds.every(existing =>
      corridorPathOverlap(adjacency,existing.path,candidatePath) <= 0.75)) {
      selectedTurnarounds.push({candidate,path:candidatePath});
    }
    if (selectedTurnarounds.length >= 12) break;
  }
  const candidates = selectedTurnarounds.map(({candidate:[id,meters],path:shortestPath}) => {
      const pathPool = kShortestPaths(adjacency,start,id,8,{maxDistanceMeters:target+Math.max(20,target*0.035)});
      const alternatives = selectCorridorDiversePaths(adjacency,pathPool,3,0.55);
      return {nodeId:id,networkDistanceMeters:+meters.toFixed(1),
        networkDistanceMiles:+(meters/MILE).toFixed(4),pathNodeCount:shortestPath?.length ?? 0,
        pathVariants:alternatives.map((variant,index)=>({
          rank:index+1,distanceMeters:+variant.distanceMeters.toFixed(1),
          distanceMiles:+(variant.distanceMeters/MILE).toFixed(4),nodeCount:variant.nodes.length,
          maxCorridorOverlapWithSelected:+variant.maxCorridorOverlapWithSelected.toFixed(3)
        }))};
    });
  return {requestedOutAndBackMiles:requestedMiles,
    targetOutboundMiles:+(requestedMiles/2).toFixed(4),candidates};
});
console.log(JSON.stringify({
  source:"OpenStreetMap pedestrian-tagged ways via Overpass",
  radiusMeters:radius,eligibleWayCount:ways.filter(w => isEligiblePedestrianWay(w.tags)).length,
  graphNodeCount:adjacency.size,snappedStartOffsetMeters:+snap.toFixed(1),results,
  limitations:[
    "Candidate distances are graph lengths over selected OSM-tagged ways, not provider-routed distances.",
    "Candidate turnaround nodes are drawn from one shortest-path tree; path variants to each node are independently searched with Yen k-shortest paths and filtered by corridor overlap.",
    "Path diversity is screened by weighted shared OSM-way length (maximum 0.55); turnaround candidates are also screened against each other (maximum 0.75). OSM way IDs are only a corridor proxy, not a guarantee of visually distinct or safer routes.",
    "The GPS origin is snapped to a nearby graph node by proximity; a verified on-network connector is not yet built.",
    "Crossing legality, polygon/parcel exclusions, field overlays, and side-specific sidewalk geometry are not enforced.",
    "Road centerlines are included only when OSM explicitly tags a sidewalk; side-specific geometry still needs validation.",
    "Unknown access and incomplete tags are not proof of legal public access or safe pedestrian conditions.",
    "Coordinates and route geometry are intentionally omitted from output."
  ]
},null,2));

