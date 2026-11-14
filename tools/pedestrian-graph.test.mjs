import test from "node:test";
import { inspectPathCrossingEvidence } from "./pedestrian-graph.mjs";
import { buildOutAndBackRoute } from "./pedestrian-graph.mjs";
import { detectRoadwayCrossingsForPath, selectCrossingAwarePaths, detectOriginConnectorRoadwayIntersections } from "./pedestrian-graph.mjs";
import assert from "node:assert/strict";
import {
  buildDirectedPedestrianGraph, dijkstra, haversineMeters,
  isEligiblePedestrianWay, pedestrianDirections, reconstructNodePath,
  directedPathOverlap, selectDiversePaths, kShortestPaths,
  corridorPathOverlap, selectCorridorDiversePaths, roundTripCorridorOverlap, selectRoundTripCorridorDiversePaths, snapOriginToPedestrianGraph, pedestrianCrossingEvidence, crossingEvidenceForNode, auditPedestrianConnectivity, buildRouteFeatureInventory
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

test("road centerlines are excluded even when sidewalk presence is tagged", () => {
  assert.equal(isEligiblePedestrianWay({highway:"residential"}), false);
  assert.equal(isEligiblePedestrianWay({highway:"residential",sidewalk:"left"}), false);
  assert.equal(isEligiblePedestrianWay({highway:"tertiary",sidewalk:"both"}), false);
  assert.equal(isEligiblePedestrianWay({highway:"footway",footway:"sidewalk"}), true);
});

test("destination-only and restricted access ways are excluded from through routes", () => {
  for (const access of ["destination","agricultural","forestry","restricted","private","customers"]) {
    assert.equal(isEligiblePedestrianWay({highway:"footway",access}),false,access);
  }
  assert.equal(isEligiblePedestrianWay({highway:"footway",access:"yes"}),true);
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


test("crossing evidence distinguishes mapped, controlled, and unknown crossings", () => {
  assert.deepEqual(pedestrianCrossingEvidence({}),{
    mapped:false,type:"unknown",controlled:false,signals:false
  });
  assert.deepEqual(pedestrianCrossingEvidence({highway:"crossing",crossing:"marked"}),{
    mapped:true,type:"marked",controlled:true,signals:false
  });
  assert.deepEqual(pedestrianCrossingEvidence({highway:"crossing",crossing:"traffic_signals"}),{
    mapped:true,type:"traffic_signals",controlled:true,signals:true
  });
  assert.equal(pedestrianCrossingEvidence({crossing:"unmarked"}).controlled,false);
  assert.deepEqual(pedestrianCrossingEvidence({highway:"traffic_signals"}),{
    mapped:false,type:"unknown",controlled:false,signals:true
  });
  assert.deepEqual(pedestrianCrossingEvidence({highway:"crossing","crossing:markings":"no"}),{
    mapped:true,type:"no",controlled:false,signals:false
  });
  assert.deepEqual(pedestrianCrossingEvidence({crossing:"traffic_signals"}),{
    mapped:true,type:"traffic_signals",controlled:true,signals:true
  });
});

test("crossing evidence reads tags retained on OSM node records", () => {
  const taggedNodes=new Map([[50,{id:50,lat:27,lon:-82,tags:{highway:"crossing",crossing:"zebra"}}]]);
  assert.deepEqual(crossingEvidenceForNode(taggedNodes,50),{
    mapped:true,type:"zebra",controlled:true,signals:false
  });
  assert.equal(crossingEvidenceForNode(new Map(),99).mapped,false);
});


test("connectivity audit identifies isolated nodes, terminals, and ambiguous junctions", () => {
  const auditNodes=new Map([
    [1,{id:1,lat:27,lon:-82,tags:{}}],
    [2,{id:2,lat:27,lon:-81.999,tags:{}}],
    [3,{id:3,lat:27.001,lon:-82,tags:{}}],
    [4,{id:4,lat:27.001,lon:-81.999,tags:{}}],
    [5,{id:5,lat:27.002,lon:-82,tags:{highway:"crossing",crossing:"zebra"}}],
    [6,{id:6,lat:27.003,lon:-82,tags:{}}]
  ]);
  const auditGraph=new Map([
    [1,[{to:2,meters:10,wayId:11}]],
    [2,[{to:3,meters:10,wayId:12},{to:4,meters:10,wayId:13}]],
    [3,[]],
    [4,[{to:2,meters:10,wayId:13}]],
    [5,[{to:2,meters:10,wayId:14,tags:{highway:"footway",footway:"crossing"}}]]
  ]);
  const result=auditPedestrianConnectivity(auditNodes,auditGraph);
  assert.equal(result.nodeCount,6);
  assert.equal(result.connectedNodeCount,5);
  assert.equal(result.crossingTaggedEdges,1);
  assert.deepEqual(result.isolated.map(x=>x.nodeId),[6]);
  assert.ok(result.terminals.some(x=>x.nodeId===1));
  assert.ok(result.junctions.some(x=>x.nodeId===2));
  assert.ok(result.junctionsWithoutMappedCrossing.some(x=>x.nodeId===2));
  assert.equal(result.junctions.find(x=>x.nodeId===2).degree,4);
});

test("path crossing inspection reports mapped crossings and separates signal-only nodes", () => {
  const nodes = new Map([
    ["a",{id:"a",lat:0,lon:0,tags:{}}],
    ["b",{id:"b",lat:0,lon:0,tags:{crossing:"zebra"}}],
    ["c",{id:"c",lat:0,lon:0,tags:{highway:"traffic_signals"}}]
  ]);
  const result = inspectPathCrossingEvidence(nodes, {
    nodes:["a","b","c"],
    edges:[{wayId:99,tags:{highway:"crossing"}}]
  });
  assert.equal(result.mappedCrossingNodeCount,1);
  assert.equal(result.unknownNodeCount,2);
  assert.equal(result.signalOnlyNodeCount,1);
  assert.equal(result.crossingWayEdgeCount,1);
  assert.equal(result.observations[0].type,"zebra");
});

test("path crossing inspection does not infer crossing requirement from unknown nodes", () => {
  const nodes = new Map([["x",{id:"x",lat:0,lon:0,tags:{}}]]);
  const result = inspectPathCrossingEvidence(nodes,["x"]);
  assert.equal(result.mappedCrossingNodeCount,0);
  assert.equal(result.unknownNodeCount,1);
  assert.equal(result.crossingWayEdgeCount,0);
});


test("detects a pedestrian path segment that geometrically crosses a mapped residential road", () => {
 const fixtureNodes=new Map([
  ["p1",{id:"p1",lat:27,lon:-82}],
  ["p2",{id:"p2",lat:27.001,lon:-82}],
  ["r1",{id:"r1",lat:27.0005,lon:-82.001}],
  ["r2",{id:"r2",lat:27.0005,lon:-81.999}]
 ]);
 const ways=[{id:700,nodes:["r1","r2"],tags:{highway:"residential"}}];
 const result=detectRoadwayCrossingsForPath(fixtureNodes,ways,["p1","p2"]);
 assert.equal(result.status,"crossing_geometry_detected");
 assert.equal(result.crossingCount,1);
 assert.equal(result.crossings[0].wayId,700);
 assert.equal(result.crossings[0].roadClass,"residential");
});

test("does not classify parallel sidewalk and roadway geometry as a crossing", () => {
 const fixtureNodes=new Map([
  ["p1",{id:"p1",lat:27,lon:-82}],
  ["p2",{id:"p2",lat:27.001,lon:-82}],
  ["r1",{id:"r1",lat:27,lon:-82.0001}],
  ["r2",{id:"r2",lat:27.001,lon:-82.0001}]
 ]);
 const result=detectRoadwayCrossingsForPath(fixtureNodes,
  [{id:701,nodes:["r1","r2"],tags:{highway:"residential"}}],["p1","p2"]);
 assert.equal(result.crossingCount,0);
});

test("does not treat footways as roadways and rejects malformed geometry", () => {
 const fixtureNodes=new Map([
  ["a",{id:"a",lat:27,lon:-82}],["b",{id:"b",lat:27.001,lon:-82}],
  ["c",{id:"c",lat:27.0005,lon:-82.001}],["d",{id:"d",lat:27.0005,lon:-81.999}]
 ]);
 const result=detectRoadwayCrossingsForPath(fixtureNodes,
  [{id:702,nodes:["c","d"],tags:{highway:"footway"}}],["a","b"]);
 assert.equal(result.crossingCount,0);
 assert.throws(()=>detectRoadwayCrossingsForPath(fixtureNodes,[],["a"]),TypeError);
});

test("detects crossings on multiple road segments and reports unknown crossing status conservatively", () => {
 const fixtureNodes=new Map([
  ["a",{id:"a",lat:27,lon:-82}],["b",{id:"b",lat:27.002,lon:-82}],
  ["c",{id:"c",lat:27.0005,lon:-82.001}],["d",{id:"d",lat:27.0005,lon:-81.999}],
  ["e",{id:"e",lat:27.0015,lon:-82.001}],["f",{id:"f",lat:27.0015,lon:-81.999}]
 ]);
 const ways=[
  {id:703,nodes:["c","d"],tags:{highway:"tertiary"}},
  {id:704,nodes:["e","f"],tags:{highway:"primary"}}
 ];
 const result=detectRoadwayCrossingsForPath(fixtureNodes,ways,["a","b"]);
 assert.equal(result.crossingCount,2);
 assert.ok(result.crossings.every(item=>item.mappedCrossingEvidence===false));
});


test("crossing-aware selector prefers a mapped-crossing-free path before a shorter crossing path", () => {
 const fixtureNodes=new Map([
  ["s",{id:"s",lat:27,lon:-82}],
  ["t",{id:"t",lat:27.002,lon:-82}],
  ["x",{id:"x",lat:27.0005,lon:-82.002}],
  ["r1",{id:"r1",lat:27.001,lon:-82.0003}],
  ["r2",{id:"r2",lat:27.001,lon:-81.9997}]
 ]);
 const roads=[{id:800,nodes:["r1","r2"],tags:{highway:"residential"}}];
 const crossingPath={nodes:["s","t"],edges:[{wayId:1,meters:220}],distanceMeters:220};
 const detourPath={nodes:["s","x","t"],edges:[
  {wayId:2,meters:120},{wayId:3,meters:120}
 ],distanceMeters:240};
 const selected=selectCrossingAwarePaths(fixtureNodes,roads,[crossingPath,detourPath],2,1);
 assert.equal(selected[0].detectedRoadwayCrossingCount,0);
 assert.equal(selected[1].detectedRoadwayCrossingCount,1);
});


test("builds a connected GeoJSON out-and-back route and measures both legs", () => {
 const fixture=new Map([
  ["a",{id:"a",lat:27,lon:-82}],
  ["b",{id:"b",lat:27.001,lon:-82}],
  ["c",{id:"c",lat:27.001,lon:-81.999}]
 ]);
 const route=buildOutAndBackRoute(fixture,{nodes:["a","b"]},{nodes:["b","c","a"]});
 assert.equal(route.type,"Feature");
 assert.equal(route.geometry.type,"LineString");
 assert.deepEqual(route.geometry.coordinates[0],[-82,27]);
 assert.deepEqual(route.geometry.coordinates.at(-1),[-82,27]);
 assert.equal(route.properties.routeType,"out_and_back");
 assert.ok(route.properties.totalDistanceMeters>0);
 assert.equal(route.properties.totalNodeCount,4);
});

test("rejects out-and-back paths that do not return to the origin", () => {
 const fixture=new Map([
  ["a",{id:"a",lat:27,lon:-82}],["b",{id:"b",lat:27.001,lon:-82}],
  ["c",{id:"c",lat:27.002,lon:-82}]
 ]);
 assert.throws(()=>buildOutAndBackRoute(fixture,{nodes:["a","b"]},{nodes:["b","c"]}),/original start/);
});

test("rejects missing route coordinates rather than emitting invalid GeoJSON", () => {
 const fixture=new Map([["a",{id:"a",lat:27,lon:-82}]]);
 assert.throws(()=>buildOutAndBackRoute(fixture,{nodes:["a","missing"]},{nodes:["missing","a"]}),/missing or invalid coordinate/);
});


test("directed out-and-back builder independently finds a legal directed return leg", async () => {
 const {buildDirectedOutAndBackCandidate}=await import("./pedestrian-graph.mjs");
 const fixtureNodes=new Map([
  ["o",{id:"o",lat:27,lon:-82}],["t",{id:"t",lat:27.001,lon:-82}],
  ["x",{id:"x",lat:27.001,lon:-81.999}]
 ]);
 const graph=new Map([
  ["o",[{to:"t",meters:111,edgeId:"out"}]],
  ["t",[{to:"x",meters:111,edgeId:"return-a"}]],
  ["x",[{to:"o",meters:157,edgeId:"return-b"}]]
 ]);
 const outbound={nodes:["o","t"],edges:[graph.get("o")[0]],distanceMeters:111};
 const result=buildDirectedOutAndBackCandidate(graph,fixtureNodes,outbound,{requestedDistanceMeters:358,toleranceMeters:20});
 assert.equal(result.ok,true);
 assert.deepEqual(result.returnPath.nodes,["t","x","o"]);
 assert.deepEqual(result.returnPath.edges.map(edge=>edge.edgeId),["return-a","return-b"]);
 assert.equal(result.route.geometry.coordinates[0][0],-82);
 assert.equal(result.route.geometry.coordinates.at(-1)[0],-82);
 assert.equal(result.distance.outboundMeters,result.route.properties.outboundDistanceMeters);
 assert.equal(result.distance.returnMeters,result.route.properties.returnDistanceMeters);
 assert.equal(result.distance.graphOutboundMeters,111);
 assert.equal(result.distance.graphReturnMeters,268);
 assert.equal(result.distance.totalMeters,result.route.properties.totalDistanceMeters);
 assert.notEqual(result.distance.outboundMeters,result.distance.graphOutboundMeters);
 assert.equal(result.distance.withinTolerance,true);
});

test("directed out-and-back builder refuses to invent a reverse for a one-way path", async () => {
 const {buildDirectedOutAndBackCandidate}=await import("./pedestrian-graph.mjs");
 const fixtureNodes=new Map([
  ["o",{id:"o",lat:27,lon:-82}],["t",{id:"t",lat:27.001,lon:-82}]
 ]);
 const graph=new Map([["o",[{to:"t",meters:111}]],["t",[]]]);
 const outbound={nodes:["o","t"],edges:graph.get("o"),distanceMeters:111};
 const result=buildDirectedOutAndBackCandidate(graph,fixtureNodes,outbound);
 assert.deepEqual(result,{ok:false,reason:"no_directed_return_path",originNode:"o",turnaroundNode:"t"});
});

test("directed out-and-back builder reports distance outside tolerance without trimming", async () => {
 const {buildDirectedOutAndBackCandidate}=await import("./pedestrian-graph.mjs");
 const fixtureNodes=new Map([
  ["o",{id:"o",lat:27,lon:-82}],["t",{id:"t",lat:27.001,lon:-82}]
 ]);
 const graph=new Map([
  ["o",[{to:"t",meters:111}]],
  ["t",[{to:"o",meters:111}]]
 ]);
 const outbound={nodes:["o","t"],edges:graph.get("o"),distanceMeters:111};
 const result=buildDirectedOutAndBackCandidate(graph,fixtureNodes,outbound,{requestedDistanceMeters:500,toleranceMeters:15});
 assert.equal(result.ok,true);
 assert.equal(result.distance.withinTolerance,false);
 assert.ok(result.distance.errorMeters>15);
 assert.equal(result.route.geometry.coordinates.at(-1)[0],-82);
});


test("inventories connections and roadway crossings across both out-and-back legs", () => {
 const fixture=new Map([
  ["o",{id:"o",lat:27,lon:-82,tags:{}}],
  ["t",{id:"t",lat:27.002,lon:-82,tags:{}}],
  ["x",{id:"x",lat:27.002,lon:-81.999,tags:{}}],
  ["r",{id:"r",lat:27.001,lon:-82.001,tags:{}}],
  ["s",{id:"s",lat:27.001,lon:-81.999,tags:{}}],
  ["p",{id:"p",lat:27.0015,lon:-82.001,tags:{}}],
  ["q",{id:"q",lat:27.0015,lon:-81.999,tags:{}}]
 ]);
 const ways=[
  {id:900,nodes:["r","s"],tags:{highway:"residential"}},
  {id:901,nodes:["p","q"],tags:{highway:"tertiary"}}
 ];
 const outbound={nodes:["o","t"],edges:[{wayId:11,meters:222}]};
 const returning={nodes:["t","x","o"],edges:[{wayId:12,meters:111},{wayId:11,meters:248}]};
 const inventory=buildRouteFeatureInventory(fixture,ways,outbound,returning);
 assert.equal(inventory.connections.length,2);
 assert.deepEqual(inventory.connections.map(x=>x.id),["connection:osm-way:11","connection:osm-way:12"]);
 assert.ok(inventory.crossings.length>=2);
 assert.ok(inventory.crossings.some(x=>x.routeSegmentIndex===0),"outbound leg crossing is inventoried");
 assert.ok(inventory.crossings.some(x=>x.routeSegmentIndex>=1),"return leg crossing is inventoried");
 assert.ok(inventory.crossings.every(x=>x.crossingRequired===true&&x.status==="unverified"));
 assert.equal(inventory.routeNodeCount,4);
});

test("route feature inventory does not classify ordinary pedestrian nodes as crossings", () => {
 const fixture=new Map([
  ["o",{id:"o",lat:27,lon:-82,tags:{}}],
  ["t",{id:"t",lat:27.001,lon:-82,tags:{}}]
 ]);
 const outbound={nodes:["o","t"],edges:[{wayId:21,meters:111}]};
 const returning={nodes:["t","o"],edges:[{wayId:21,meters:111}]};
 const inventory=buildRouteFeatureInventory(fixture,[],outbound,returning);
 assert.equal(inventory.crossings.length,0);
 assert.equal(inventory.connections.length,1);
 assert.equal(inventory.mappedNodeCrossings.length,0);
});


test("route crossing inventory carries mapped pedestrian signal-control evidence", () => {
 const fixture=new Map([
  ["a",{id:"a",lat:27,lon:-82,tags:{highway:"crossing",crossing:"traffic_signals"}}],
  ["b",{id:"b",lat:27.002,lon:-82,tags:{}}],
  ["c",{id:"c",lat:27.001,lon:-82.001,tags:{}}],
  ["d",{id:"d",lat:27.001,lon:-81.999,tags:{}}]
 ]);
 const ways=[{id:990,nodes:["c","d"],tags:{highway:"primary"}}];
 const outbound={nodes:["a","b"],edges:[{wayId:31,meters:222}]};
 const returning={nodes:["b","a"],edges:[{wayId:31,meters:222}]};
 const inventory=buildRouteFeatureInventory(fixture,ways,outbound,returning);
 assert.ok(inventory.crossings.some(x=>x.crossingEvidence.mapped&&x.crossingEvidence.controlled));
});


test("pedestrian way classifier distinguishes dedicated geometry from road centerlines", async () => {
 const {classifyPedestrianWay,isEligiblePedestrianWay}=await import("./pedestrian-graph.mjs");
 assert.deepEqual(classifyPedestrianWay({highway:"footway",footway:"sidewalk"}),
  {status:"eligible",reason:"dedicated_pedestrian_geometry"});
 assert.equal(isEligiblePedestrianWay({highway:"path"}),true);
 assert.deepEqual(classifyPedestrianWay({highway:"residential",sidewalk:"both"}),
  {status:"needs_review",reason:"sidewalk_tag_without_sidewalk_geometry"});
 assert.deepEqual(classifyPedestrianWay({highway:"service",foot:"yes"}),
  {status:"needs_review",reason:"foot_access_on_carriageway_centerline"});
 assert.deepEqual(classifyPedestrianWay({highway:"service"}),
  {status:"excluded",reason:"roadway_centerline_not_sidewalk_geometry"});
});

test("pedestrian way classifier fails closed on access restrictions and ambiguous roads", async () => {
 const {classifyPedestrianWay,isEligiblePedestrianWay}=await import("./pedestrian-graph.mjs");
 for (const tags of [
  {highway:"footway",access:"private"},
  {highway:"path",foot:"no"},
  {highway:"residential",access:"destination",sidewalk:"both"}
 ]) assert.equal(classifyPedestrianWay(tags).status,"excluded");
 assert.equal(classifyPedestrianWay({highway:"cycleway",foot:"designated"}).status,"eligible");
 assert.equal(classifyPedestrianWay({highway:"steps"}).status,"eligible");
 assert.equal(classifyPedestrianWay({highway:"track",foot:"yes"}).status,"needs_review");
 assert.equal(isEligiblePedestrianWay({highway:"residential",sidewalk:"both"}),false);
});


test("connectivity audit reports weak components and directed reachability from origin", () => {
 const graphNodes=new Map([
  ["origin",{id:"origin",tags:{}}],
  ["a",{id:"a",tags:{}}],
  ["b",{id:"b",tags:{}}],
  ["reverse-only",{id:"reverse-only",tags:{}}],
  ["island",{id:"island",tags:{}}]
 ]);
 const graph=new Map([
  ["origin",[{to:"a",meters:10,wayId:1}]],
  ["a",[{to:"b",meters:10,wayId:1}]],
  ["b",[]],
  ["reverse-only",[{to:"a",meters:10,wayId:2}]],
  ["island",[]]
 ]);
 const result=auditPedestrianConnectivity(graphNodes,graph,"origin");
 assert.equal(result.componentCount,2);
 assert.deepEqual(result.components.map(x=>x.nodeCount),[4,1]);
 assert.equal(result.reachableFromStart,3);
 assert.deepEqual(result.unreachableFromStart,["reverse-only","island"]);
});

test("connectivity audit handles a graph with only isolated nodes", () => {
 const graphNodes=new Map([["a",{id:"a"}],["b",{id:"b"}]]);
 const result=auditPedestrianConnectivity(graphNodes,new Map(),"a");
 assert.equal(result.componentCount,2);
 assert.equal(result.reachableFromStart,1);
 assert.deepEqual(result.unreachableFromStart,["b"]);
});


// Nearby disconnected terminal nodes are reported as review gaps, never linked.
test("finds nearby endpoints across disconnected components without connecting them", async () => {
 const {findPedestrianNetworkGapCandidates}=await import("./pedestrian-graph.mjs");
 const fixture=new Map([
  ["a",{id:"a",lat:27,lon:-82}],["b",{id:"b",lat:27.001,lon:-82}],
  ["c",{id:"c",lat:27.00105,lon:-82}],["d",{id:"d",lat:27.002,lon:-82}],
  ["island",{id:"island",lat:27.01,lon:-82}]
 ]);
 const graph=new Map([
  ["a",[{to:"b",meters:111,wayId:1,tags:{highway:"footway",footway:"sidewalk"}}]],["b",[]],
  ["c",[{to:"d",meters:111,wayId:2,tags:{highway:"footway",footway:"sidewalk"}}]],["d",[]],["island",[]]
 ]);
 const result=findPedestrianNetworkGapCandidates(fixture,graph,{maxGapMeters:12});
 assert.equal(result.terminalNodeCount,4);
 assert.equal(result.candidateCount,1);
 assert.equal(result.candidates[0].status,"unverified_gap_candidate");
 assert.deepEqual([result.candidates[0].fromNodeId,result.candidates[0].toNodeId],["b","c"]);
 assert.equal(result.candidates[0].distanceMeters<12,true);
 assert.equal(result.candidates[0].reviewClass,"cross_way_continuity_review");
 assert.deepEqual(result.candidates[0].endpointEvidence.from.wayIds,["1"]);
 assert.deepEqual(result.candidates[0].endpointEvidence.to.wayIds,["2"]);
 assert.equal(result.candidates[0].endpointEvidence.highwayClassesMatch,true);
 assert.match(result.candidates[0].warning,/same-side access/);
 assert.equal(graph.get("b").length,0,"gap analysis must not mutate or connect graph");
});

test("gap analysis ignores endpoints in the same weak component and enforces bounds", async () => {
 const {findPedestrianNetworkGapCandidates}=await import("./pedestrian-graph.mjs");
 const fixture=new Map([
  ["a",{id:"a",lat:27,lon:-82}],["b",{id:"b",lat:27.001,lon:-82}],
  ["c",{id:"c",lat:27.002,lon:-82}]
 ]);
 const graph=new Map([["a",[{to:"b",meters:111}]],["b",[{to:"c",meters:111}]],["c",[]]]);
 assert.equal(findPedestrianNetworkGapCandidates(fixture,graph).candidateCount,0);
 assert.throws(()=>findPedestrianNetworkGapCandidates(fixture,graph,{maxGapMeters:101}),/maxGapMeters/);
});


test("origin snap reports connector distance and geometry class without claiming access", async () => {
 const {snapOriginToPedestrianGraph}=await import("./pedestrian-graph.mjs");
 const nodes=new Map([
  ["a",{id:"a",lat:27,lon:-82}],["b",{id:"b",lat:27.001,lon:-82}]
 ]);
 const graph=new Map([["a",[{to:"b",meters:111,wayId:77}]]]);
 const near=snapOriginToPedestrianGraph(nodes,graph,{lat:27.000001,lon:-82.000001},60);
 assert.equal(near.ok,true);
 assert.equal(near.connectorStatus,"unverified");
 assert.equal(near.connectorReview.status,"unverified");
 assert.equal(near.connectorReview.distanceClass,"near_geometry_candidate");
 assert.equal(near.connectorReview.directedEdge.wayId,77);
 assert.match(near.connectorReview.warning,/not evidence of a walkable/);
 const farther=snapOriginToPedestrianGraph(nodes,graph,{lat:27.0005,lon:-82.0002},60);
 assert.equal(farther.ok,true);
 assert.equal(farther.connectorReview.distanceClass,"requires_field_review");
});


test("crossing detector ignores intersections only when explicit numeric layers differ", () => {
 const map = new Map([[1,{id:1,lat:0,lon:-0.001}],[2,{id:2,lat:0,lon:0.001}],[3,{id:3,lat:-0.001,lon:0}],[4,{id:4,lat:0.001,lon:0}]]);
 const road=[{id:77,nodes:[3,4],tags:{highway:"residential",layer:"1"}}];
 const separated=detectRoadwayCrossingsForPath(map,road,{nodes:[1,2],edges:[{tags:{highway:"footway",layer:"0"}}]});
 assert.equal(separated.crossingCount,0);
 const sameLayer=detectRoadwayCrossingsForPath(map,[{id:77,nodes:[3,4],tags:{highway:"residential",layer:"0"}}],{nodes:[1,2],edges:[{tags:{highway:"footway",layer:"0"}}]});
 assert.equal(sameLayer.crossingCount,1);
 const unknownLayer=detectRoadwayCrossingsForPath(map,road,{nodes:[1,2],edges:[{tags:{highway:"footway"}}]});
 assert.equal(unknownLayer.crossingCount,1);
});

test("origin connector roadway review flags mapped centerline intersection and stays unverified", () => {
 const map = new Map([
  [1,{id:1,lat:-0.001,lon:0.0005}],
  [2,{id:2,lat:0.001,lon:0.0005}]
 ]);
 const roads = [{id:90,nodes:[1,2],tags:{highway:"residential"}}];
 const result = detectOriginConnectorRoadwayIntersections(map,roads,
  {lat:0,lon:0},{lat:0,lon:0.001});
 assert.equal(result.status,"connector_crosses_mapped_roadway");
 assert.equal(result.crossingCount,1);
 assert.equal(result.connectorStatus,"unverified");
 assert.match(result.warning,/does not prove/);
});
test("origin connector review reports no mapped intersection without validating access", () => {
 const map = new Map([
  [1,{id:1,lat:0.001,lon:0.0005}],
  [2,{id:2,lat:0.002,lon:0.0005}]
 ]);
 const result = detectOriginConnectorRoadwayIntersections(map,
  [{id:90,nodes:[1,2],tags:{highway:"residential"}}],
  {lat:0,lon:0},{lat:0,lon:0.001});
 assert.equal(result.status,"no_mapped_roadway_intersection_detected");
 assert.equal(result.crossingCount,0);
 assert.equal(result.connectorStatus,"unverified");
});


test("gap review never treats missing way IDs as shared-way continuity evidence", async () => {
 const {findPedestrianNetworkGapCandidates}=await import("./pedestrian-graph.mjs");
 const nodes=new Map([
  ["a",{id:"a",lat:27,lon:-82}],
  ["b",{id:"b",lat:27.00009,lon:-82}],
  ["c",{id:"c",lat:27.000108,lon:-82}],
  ["d",{id:"d",lat:27.000198,lon:-82}]
 ]);
 const graph=new Map([
  ["a",[{to:"b",meters:10,tags:{highway:"footway"}}]],["b",[]],
  ["c",[{to:"d",meters:10,tags:{highway:"footway"}}]],["d",[]]
 ]);
 const result=findPedestrianNetworkGapCandidates(nodes,graph,{maxGapMeters:3});
 assert.equal(result.candidateCount,1);
 assert.deepEqual(result.candidates[0].endpointEvidence.sharedWayIds,[]);
 assert.equal(result.candidates[0].reviewClass,"cross_way_continuity_review");
 assert.deepEqual(result.candidates[0].endpointEvidence.from.wayIds,["unknown"]);
 assert.deepEqual(result.candidates[0].endpointEvidence.to.wayIds,["unknown"]);
 assert.equal(result.candidates[0].status,"unverified_gap_candidate");
});
test("gap review reports truncation without changing deterministic nearest-first ordering", async () => {
 const {findPedestrianNetworkGapCandidates}=await import("./pedestrian-graph.mjs");
 const nodes=new Map([
  ["a",{id:"a",lat:27,lon:-82}],["b",{id:"b",lat:27.001,lon:-82}],
  ["c",{id:"c",lat:27.00101,lon:-82}],["d",{id:"d",lat:27.002,lon:-82}],
  ["e",{id:"e",lat:27.00201,lon:-82}],["f",{id:"f",lat:27.003,lon:-82}]
 ]);
 const graph=new Map([
  ["a",[{to:"b",meters:111,wayId:1,tags:{highway:"footway"}}]],["b",[]],
  ["c",[{to:"d",meters:111,wayId:2,tags:{highway:"footway"}}]],["d",[]],
  ["e",[{to:"f",meters:111,wayId:3,tags:{highway:"footway"}}]],["f",[]]
 ]);
 const result=findPedestrianNetworkGapCandidates(nodes,graph,{maxGapMeters:12,maxCandidates:1});
 assert.equal(result.candidateCount,2);
 assert.equal(result.truncated,true);
 assert.equal(result.candidates.length,1);
 assert.deepEqual([result.candidates[0].fromNodeId,result.candidates[0].toNodeId],["b","c"]);
});

test("directed out-and-back rejects an outbound segment absent from the pedestrian graph",async()=>{
 const {buildDirectedOutAndBackCandidate}=await import("./pedestrian-graph.mjs");
 const fixture=new Map([["o",{id:"o",lat:27,lon:-82}],["t",{id:"t",lat:27.001,lon:-82}]]);
 const graph=new Map([["o",[{to:"t",meters:111,edgeId:"actual"}]],["t",[{to:"o",meters:111,edgeId:"back"}]]]);
 const forged={nodes:["o","t"],edges:[{to:"t",meters:111,edgeId:"not-in-graph"}],distanceMeters:111};
 const result=buildDirectedOutAndBackCandidate(graph,fixture,forged);
 assert.equal(result.ok,false);
 assert.equal(result.reason,"invalid_outbound_path");
});
test("out-and-back geometry validator checks both directions and preserves parallel-edge identity",()=>{
 const fixture=new Map([["o",{id:"o",lat:27,lon:-82}],["t",{id:"t",lat:27.001,lon:-82}]]);
 const graph=new Map([
  ["o",[{to:"t",meters:111,edgeId:"out-a"},{to:"t",meters:111,edgeId:"out-b"}]],
  ["t",[{to:"o",meters:111,edgeId:"back"}]]
 ]);
 const outbound={nodes:["o","t"],edges:[graph.get("o")[0]]};
 const validReturn={nodes:["t","o"],edges:[graph.get("t")[0]]};
 assert.doesNotThrow(()=>buildOutAndBackRoute(fixture,outbound,validReturn,graph));
 const wrongParallel={nodes:["o","t"],edges:[{to:"t",meters:111,edgeId:"not-a-real-parallel-edge"}]};
 assert.throws(()=>buildOutAndBackRoute(fixture,outbound,wrongParallel,graph),/directed pedestrian graph edges/);
 const wrongDirection={nodes:["t","o"],edges:[{to:"o",meters:111,edgeId:"out-a"}]};
 assert.throws(()=>buildOutAndBackRoute(fixture,outbound,wrongDirection,graph),/directed pedestrian graph edges/);
});

test("round-trip distance reports geometry and graph edge totals separately",async()=>{
 const {buildDirectedOutAndBackCandidate}=await import("./pedestrian-graph.mjs");
 const fixture=new Map([["o",{id:"o",lat:27,lon:-82}],["t",{id:"t",lat:27.001,lon:-82}]]);
 const graph=new Map([
  ["o",[{to:"t",meters:100,edgeId:"out"}]],
  ["t",[{to:"o",meters:100,edgeId:"back"}]]
 ]);
 const result=buildDirectedOutAndBackCandidate(graph,fixture,{nodes:["o","t"],edges:[graph.get("o")[0]],distanceMeters:100});
 assert.equal(result.distance.graphTotalMeters,200);
 assert.equal(result.distance.totalMeters,result.route.properties.totalDistanceMeters);
 assert.ok(result.distance.totalMeters>200);
 assert.equal(result.distance.outboundMeters,result.route.properties.outboundDistanceMeters);
});


test("round-trip corridor diversity detects shared return streets", () => {
  const graph=new Map([
    ["S",[{to:"A",meters:10,wayId:1},{to:"D",meters:10,wayId:2}]],
    ["A",[{to:"T",meters:10,wayId:3}]],
    ["D",[{to:"T",meters:10,wayId:4}]],
    ["T",[{to:"R",meters:10,wayId:5}]],
    ["R",[{to:"S",meters:10,wayId:6}]],
    ["S2",[]]
  ]);
  const routes=[
    {outboundPath:{nodes:["S","A","T"],edges:[{to:"A",meters:10,wayId:1},{to:"T",meters:10,wayId:3}]},
     returnPath:{nodes:["T","R","S"],edges:[{to:"R",meters:10,wayId:5},{to:"S",meters:10,wayId:6}]},distanceErrorMeters:1},
    {outboundPath:{nodes:["S","D","T"],edges:[{to:"D",meters:10,wayId:2},{to:"T",meters:10,wayId:4}]},
     returnPath:{nodes:["T","R","S"],edges:[{to:"R",meters:10,wayId:5},{to:"S",meters:10,wayId:6}]},distanceErrorMeters:2},
    {outboundPath:{nodes:["S","A","T"],edges:[{to:"A",meters:10,wayId:1},{to:"T",meters:10,wayId:3}]},
     returnPath:{nodes:["T","R","S"],edges:[{to:"R",meters:10,wayId:5},{to:"S",meters:10,wayId:6}]},distanceErrorMeters:3}
  ];
  assert.ok(roundTripCorridorOverlap(graph,routes[0],routes[1])>0.3);
  const selected=selectRoundTripCorridorDiversePaths(graph,routes,3,0.3);
  assert.equal(selected.length,1);
  assert.equal(selected[0].distanceErrorMeters,1);
});

test("round-trip corridor selection prioritizes complete-route crossing exposure before distance error", () => {
  const graph=new Map([
    ["S",[{to:"A",meters:10,wayId:1},{to:"D",meters:10,wayId:2}]],
    ["A",[{to:"T",meters:10,wayId:3}]],["D",[{to:"T",meters:10,wayId:4}]],
    ["T",[{to:"R",meters:10,wayId:5},{to:"U",meters:10,wayId:7}]],
    ["R",[{to:"S",meters:10,wayId:6}]],["U",[{to:"S",meters:10,wayId:8}]]
  ]);
  const make=(out,back,ways,error,crossings)=>({
    outboundPath:{nodes:out,edges:ways.slice(0,2).map((wayId,i)=>({to:out[i+1],meters:10,wayId}))},
    returnPath:{nodes:back,edges:ways.slice(2).map((wayId,i)=>({to:back[i+1],meters:10,wayId}))},
    distanceErrorMeters:error,roundTripRoadwayCrossingCount:crossings
  });
  const higherCrossing=make(["S","A","T"],["T","R","S"],[1,3,5,6],1,4);
  const lowerCrossing=make(["S","D","T"],["T","U","S"],[2,4,7,8],8,1);
  const selected=selectRoundTripCorridorDiversePaths(graph,[higherCrossing,lowerCrossing],2,0.55);
  assert.equal(selected[0].roundTripRoadwayCrossingCount,1);
  assert.equal(selected[0].distanceErrorMeters,8);
});

test("round-trip corridor diversity preserves genuinely distinct outbound and return corridors", () => {
  const graph=new Map([
    ["S",[{to:"A",meters:10,wayId:1},{to:"D",meters:10,wayId:2}]],
    ["A",[{to:"T",meters:10,wayId:3}]],["D",[{to:"T",meters:10,wayId:4}]],
    ["T",[{to:"R",meters:10,wayId:5},{to:"U",meters:10,wayId:7}]],
    ["R",[{to:"S",meters:10,wayId:6}]],["U",[{to:"S",meters:10,wayId:8}]]
  ]);
  const routes=[
    {outboundPath:{nodes:["S","A","T"],edges:[{to:"A",meters:10,wayId:1},{to:"T",meters:10,wayId:3}]},
     returnPath:{nodes:["T","R","S"],edges:[{to:"R",meters:10,wayId:5},{to:"S",meters:10,wayId:6}]},distanceErrorMeters:1},
    {outboundPath:{nodes:["S","D","T"],edges:[{to:"D",meters:10,wayId:2},{to:"T",meters:10,wayId:4}]},
     returnPath:{nodes:["T","U","S"],edges:[{to:"U",meters:10,wayId:7},{to:"S",meters:10,wayId:8}]},distanceErrorMeters:2}
  ];
  assert.equal(selectRoundTripCorridorDiversePaths(graph,routes,3,0.55).length,2);
});
