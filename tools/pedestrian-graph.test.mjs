import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectedPedestrianGraph, dijkstra, haversineMeters,
  isEligiblePedestrianWay, pedestrianDirections, reconstructNodePath,
  directedPathOverlap, selectDiversePaths, kShortestPaths,
  corridorPathOverlap, selectCorridorDiversePaths, snapOriginToPedestrianGraph
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
  assert.ok(corridorPathOverlap(graph,["S","A","B","T"],["S","A","C","T"]) > 0.15);
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


test("edge projection finds the closest point along an eligible mapped edge", async () => {
  const {findNearestPedestrianEdge,projectPointToSegment}=await import("./pedestrian-graph.mjs");
  const point={lat:27,lon:-81.9995};
  const projected=projectPointToSegment(point,nodes.get(1),nodes.get(2));
  assert.ok(projected.offsetMeters < 0.01);
  const graph=new Map([[1,[{to:2,meters:100,wayId:10}]]]);
  const match=findNearestPedestrianEdge(nodes,graph,{lat:27.0001,lon:-81.9995},30);
  assert.equal(match.from,1);
  assert.equal(match.to,2);
  assert.ok(Math.abs(match.fraction-0.5)<0.01);
  assert.ok(match.offsetMeters<12);
});

test("edge projection fails closed beyond snap limit and validates controls", async () => {
  const {findNearestPedestrianEdge}=await import("./pedestrian-graph.mjs");
  const graph=new Map([[1,[{to:2,meters:100,wayId:10}]]]);
  assert.equal(findNearestPedestrianEdge(nodes,graph,{lat:27.01,lon:-82},20),null);
  assert.throws(()=>findNearestPedestrianEdge(nodes,graph,{lat:27,lon:-82},-1),RangeError);
});

test("splitting a bidirectional edge preserves direction and way metadata", async () => {
  const {splitPedestrianEdgeAtProjection}=await import("./pedestrian-graph.mjs");
  const graph=new Map([
    [1,[{to:2,meters:100,wayId:77}]],
    [2,[{to:1,meters:100,wayId:77}]]
  ]);
  const split=splitPedestrianEdgeAtProjection(graph,{from:1,to:2,wayId:77,fraction:0.25},"snap");
  assert.deepEqual(split.get(1),[{to:"snap",meters:25,wayId:77}]);
  assert.deepEqual(split.get("snap"),[
    {to:2,meters:75,wayId:77},{to:1,meters:25,wayId:77}
  ]);
  assert.deepEqual(split.get(2),[{to:"snap",meters:75,wayId:77}]);
});

test("splitting a one-way edge does not invent reverse travel", async () => {
  const {splitPedestrianEdgeAtProjection}=await import("./pedestrian-graph.mjs");
  const graph=new Map([[1,[{to:2,meters:100,wayId:88}]]]);
  const split=splitPedestrianEdgeAtProjection(graph,{from:1,to:2,wayId:88,fraction:0.4},"snap");
  assert.deepEqual(split.get("snap"),[{to:2,meters:60,wayId:88}]);
  assert.equal(split.has(2),false);
});


test("projection and split target the selected parallel edge rather than the first matching way", async () => {
  const {findNearestPedestrianEdge,splitPedestrianEdgeAtProjection}=await import("./pedestrian-graph.mjs");
  const graph=new Map([[1,[
    {to:2,meters:90,wayId:99},
    {to:2,meters:100,wayId:99}
  ]]]);
  const match=findNearestPedestrianEdge(nodes,graph,{lat:27.0001,lon:-81.9995},30);
  assert.equal(match.edgeIndex,0);
  const split=splitPedestrianEdgeAtProjection(graph,match,"virtual");
  assert.equal(split.get(1).some(edge=>edge.meters===90*match.fraction),true);
  assert.equal(split.get(1).some(edge=>edge.to===2 && edge.meters===100),true);
});


test("Yen search preserves distinct parallel-edge alternatives with identical node sequences", () => {
  const graph=new Map([
    ["S",[{to:"T",meters:10,wayId:1,edgeId:"walkway-a"},{to:"T",meters:12,wayId:2,edgeId:"walkway-b"}]],
    ["T",[]]
  ]);
  const paths=kShortestPaths(graph,"S","T",3);
  assert.equal(paths.length,2);
  assert.deepEqual(paths.map(path=>path.nodes),[["S","T"],["S","T"]]);
  assert.deepEqual(paths.map(path=>path.distanceMeters),[10,12]);
  assert.deepEqual(paths.map(path=>path.edges[0].edgeId),["walkway-a","walkway-b"]);
  assert.notEqual(paths[0].edgeKeys[0],paths[1].edgeKeys[0]);
});


test("edge-aware corridor overlap distinguishes parallel ways with identical nodes", () => {
  const graph=new Map([["S",[
    {to:"T",meters:10,wayId:501,edgeId:"sidewalk-east"},
    {to:"T",meters:10,wayId:502,edgeId:"sidewalk-west"}
  ]],["T",[]]]);
  const paths=kShortestPaths(graph,"S","T",2);
  assert.equal(paths.length,2);
  assert.equal(corridorPathOverlap(graph,paths[0],paths[1]),0);
  const selected=selectCorridorDiversePaths(graph,paths,3,0.55);
  assert.equal(selected.length,2);
});

test("splitting an identified edge gives each sub-edge a stable distinct identity", async () => {
  const {splitPedestrianEdgeAtProjection}=await import("./pedestrian-graph.mjs");
  const graph=new Map([[1,[{to:2,meters:100,wayId:700,edgeId:"700:1:f"}]],[2,[]]]);
  const split=splitPedestrianEdgeAtProjection(graph,
    {from:1,to:2,wayId:700,meters:100,edgeIndex:0,fraction:0.4},"virtual");
  const first=split.get(1)[0], second=split.get("virtual")[0];
  assert.equal(first.edgeId,"700:1:f:a");
  assert.equal(second.edgeId,"700:1:f:b");
  assert.notEqual(first.edgeId,second.edgeId);
});


test("origin snap inserts a virtual node on an interior directed edge", () => {
  const graph=new Map([[1,[{to:2,meters:100,wayId:10,edgeId:"10:1:f"}]]]);
  const result=snapOriginToPedestrianGraph(nodes,graph,{lat:27.0001,lon:-81.9995},30);
  assert.equal(result.ok,true);
  assert.equal(result.connectorStatus,"unverified");
  assert.equal(result.projection.isVirtual,true);
  assert.equal(result.graph.get(result.startNode)[0].to,2);
  assert.ok(result.virtualNode);
  assert.equal(graph.get(1)[0].to,2,"input graph remains unchanged");
});

test("origin snap accepts a directed endpoint only when it can walk onward", () => {
  const forwardOnly=new Map([[1,[{to:2,meters:100,wayId:10}]]]);
  const atStart=snapOriginToPedestrianGraph(nodes,forwardOnly,{lat:27,lon:-82},5);
  assert.equal(atStart.ok,true);
  assert.equal(atStart.startNode,1);
  const atDeadEnd=snapOriginToPedestrianGraph(nodes,forwardOnly,{lat:27,lon:-81.999},5);
  assert.equal(atDeadEnd.ok,false);
  assert.equal(atDeadEnd.reason,"snapped_node_has_no_outgoing_pedestrian_edge");
});

test("origin snap preserves outgoing direction on a bidirectional edge", () => {
  const bidirectional=new Map([
    [1,[{to:2,meters:100,wayId:10,edgeId:"f"}]],
    [2,[{to:1,meters:100,wayId:10,edgeId:"b"}]]
  ]);
  const result=snapOriginToPedestrianGraph(nodes,bidirectional,{lat:27.0001,lon:-81.9995},30);
  assert.equal(result.ok,true);
  assert.deepEqual(result.graph.get(result.startNode).map(edge=>edge.to),[2,1]);
});

test("origin snap rejects an existing virtual node ID and distant origins", () => {
  const graph=new Map([[1,[{to:2,meters:100,wayId:10}]]]);
  assert.throws(()=>snapOriginToPedestrianGraph(new Map([[ "__stepx_private_origin_snap__",{} ]]),graph,
    {lat:27,lon:-82},30),/already exists/);
  assert.equal(snapOriginToPedestrianGraph(nodes,graph,{lat:27.01,lon:-82},10).ok,false);
});
