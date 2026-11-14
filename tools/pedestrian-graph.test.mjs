import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectedPedestrianGraph, dijkstra, haversineMeters,
  isEligiblePedestrianWay, pedestrianDirections, reconstructNodePath
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
