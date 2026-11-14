import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectedPedestrianGraph, dijkstra, haversineMeters,
  isEligiblePedestrianWay, pedestrianDirections, reconstructNodePath,
  directedPathOverlap, selectDiversePaths, kShortestPaths,
  corridorPathOverlap, selectCorridorDiversePaths
} from "./pedestrian-graph.mjs";

const nodes = new Map([
  [1, {id:1,lat:27,lon:-82}],
  [2, {id:2,lat:27,lon:-81.999}],
  [3, {id:3,lat:27,lon:-81.998}],
  [4, {id:4,lat:27.01,lon:-81.998}]
]);

test("footway is eligible and private/service ways are rejected", () => {
  assert.equal(isEligiblePedestrianWay({highway:"footway"}), true);
  assert.equal(isEligiblePedestrianWay({highway:"service"}), false);
  assert.equal(isEligiblePedestrianWay({highway:"footway",access:"private"}), false);
  assert.equal(isEligiblePedestrianWay({highway:"path",foot:"no"}), false);
});

test("road centerline requires an explicitly mapped sidewalk", () => {
  assert.equal(isEligiblePedestrianWay({highway:"residential"}), false);
  assert.equal(isEligiblePedestrianWay({highway:"residential",sidewalk:"left"}), true);
});

test("vehicle oneway does not restrict pedestrians", () => {
  assert.deepEqual(pedestrianDirections({oneway:"yes"}), {forward:true,backward:true});
});

test("explicit foot direction tags are honored", () => {
  assert.deepEqual(pedestrianDirections({"oneway:foot":"yes"}), {forward:true,backward:false});
  assert.deepEqual(pedestrianDirections({"oneway:foot":"-1"}), {forward:false,backward:true});
  assert.deepEqual(pedestrianDirections({"foot:forward":"no"}), {forward:false,backward:true});
  assert.deepEqual(pedestrianDirections({"foot:backward":"no"}), {forward:true,backward:false});
});

test("graph creates directed arcs and excludes ineligible ways", () => {
  const ways = [
    {id:10,nodes:[1,2,3],tags:{highway:"footway","oneway:foot":"yes"}},
    {id:11,nodes:[3,4],tags:{highway:"service"}}
  ];
  const graph = buildDirectedPedestrianGraph(nodes, ways);
  assert.equal(graph.get(1)?.[0]?.to, 2);
  assert.equal(graph.get(2)?.[0]?.to, 3);
  assert.equal(graph.has(3), false);
  assert.equal(graph.has(4), false);
});

test("Dijkstra respects direction, distance cap, and disconnected components", () => {
  const ways = [{id:20,nodes:[1,2,3],tags:{highway:"footway","oneway:foot":"yes"}}];
  const graph = buildDirectedPedestrianGraph(nodes, ways);
  const {distances, previous} = dijkstra(graph, 1);
  assert.ok(distances.has(3));
  assert.equal(distances.has(4), false);
  assert.equal(reconstructNodePath(previous,1,3).length,3);
  assert.equal(reconstructNodePath(previous,1,4),null);
  assert.equal(dijkstra(graph,1,50).distances.has(3),false);
});

test("haversine distance is positive and symmetric", () => {
  const a=nodes.get(1), b=nodes.get(2);
  assert.ok(haversineMeters(a,b)>0);
  assert.ok(Math.abs(haversineMeters(a,b)-haversineMeters(b,a))<1e-8);
});


test("Yen k-shortest paths returns distinct loopless alternatives in distance order", async () => {
  const {kShortestPaths} = await import("./pedestrian-graph.mjs");
  const graph = new Map([
    ["S", [{to:"A",meters:1},{to:"B",meters:1}]],
    ["A", [{to:"T",meters:1},{to:"B",meters:0.5}]],
    ["B", [{to:"T",meters:1},{to:"A",meters:0.5}]],
    ["T", []]
  ]);
  const paths = kShortestPaths(graph,"S","T",3);
  assert.equal(paths.length,3);
  assert.deepEqual(paths.map(path => path.nodes), [
    ["S","A","T"], ["S","B","T"], ["S","A","B","T"]
  ]);
  assert.deepEqual(paths.map(path => path.distanceMeters), [2,2,2.5]);
  for (const path of paths) assert.equal(new Set(path.nodes).size,path.nodes.length);
});

test("Yen k-shortest paths respect directed edges and return no fake alternatives", async () => {
  const {kShortestPaths} = await import("./pedestrian-graph.mjs");
  const graph = new Map([
    [1,[{to:2,meters:1}]],
    [2,[{to:3,meters:1}]],
    [3,[]]
  ]);
  const paths = kShortestPaths(graph,1,3,4);
  assert.equal(paths.length,1);
  assert.deepEqual(paths[0].nodes,[1,2,3]);
  assert.deepEqual(kShortestPaths(graph,3,1,2),[]);
});


test("directed path overlap measures shared directed edges", () => {
  assert.equal(directedPathOverlap(["S","A","T"],["S","B","T"]),0);
  assert.equal(directedPathOverlap(["S","A","T"],["S","A","T"]),1);
  assert.equal(directedPathOverlap(["S","A","T"],["T","A","S"]),0);
});

test("diversity selector rejects near-duplicate paths but retains distinct corridors", () => {
  const paths = [
    {nodes:["S","A","B","T"],distanceMeters:3},
    {nodes:["S","A","B","C","T"],distanceMeters:3.1},
    {nodes:["S","D","E","T"],distanceMeters:4}
  ];
  const selected = selectDiversePaths(paths,3,0.3);
  assert.equal(selected.length,2);
  assert.deepEqual(selected.map(path=>path.nodes),[
    ["S","A","B","T"],["S","D","E","T"]
  ]);
  assert.ok(selected.every(path=>path.maxOverlapWithSelected===0));
});

test("diversity selector validates its controls", () => {
  assert.throws(()=>selectDiversePaths([],0),RangeError);
  assert.throws(()=>selectDiversePaths([],3,1.1),RangeError);
});


test("corridor overlap detects shared OSM way despite different node segmentation", () => {
  const graph = new Map([
    ["S",[{to:"A",meters:10,wayId:100}]],
    ["A",[{to:"B",meters:10,wayId:100},{to:"C",meters:10,wayId:200}]],
    ["B",[{to:"T",meters:10,wayId:100}]],
    ["C",[{to:"T",meters:10,wayId:300}]],
    ["T",[]]
  ]);
  assert.ok(corridorPathOverlap(graph,["S","A","B","T"],["S","A","C","T"]) > 0.3);
  assert.equal(corridorPathOverlap(graph,["S","A","B","T"],["S","A","B","T"]),1);
});

test("corridor diversity selector rejects same-way variants and retains separate ways", () => {
  const graph = new Map([
    ["S",[{to:"A",meters:10,wayId:1},{to:"D",meters:10,wayId:2}]],
    ["A",[{to:"B",meters:10,wayId:1}]],
    ["B",[{to:"T",meters:10,wayId:1}]],
    ["D",[{to:"E",meters:10,wayId:2}]],
    ["E",[{to:"T",meters:10,wayId:2}]],
    ["T",[]]
  ]);
  const pool = [
    {nodes:["S","A","B","T"],distanceMeters:30},
    {nodes:["S","A","B","T"],distanceMeters:31},
    {nodes:["S","D","E","T"],distanceMeters:32}
  ];
  const selected = selectCorridorDiversePaths(graph,pool,3,0.55);
  assert.equal(selected.length,2);
  assert.deepEqual(selected.map(path=>path.nodes),[
    ["S","A","B","T"],["S","D","E","T"]
  ]);
});
