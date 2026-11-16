import test from "node:test";
import assert from "node:assert/strict";
import {generateOutAndBackCandidates,generateOutAndBackMiles} from "./route-engine.mjs";
import {haversineMeters,buildDirectedPedestrianGraph,snapOriginToPedestrianGraph} from "./pedestrian-graph.mjs";

function squareFixture({oneWayReturn=false}={}) {
  // A roughly 111 m square at the equator: the expected out-and-back
  // distance is close to 4 * 111 m, measured from actual coordinates.
  const nodes=new Map([
    ["o",{id:"o",lat:0,lon:0,tags:{}}],
    ["a",{id:"a",lat:0.001,lon:0,tags:{}}],
    ["b",{id:"b",lat:0.001,lon:0.001,tags:{}}],
    ["c",{id:"c",lat:0,lon:0.001,tags:{}}]
  ]);
  const way=(id,from,to,extra={})=>({id,nodes:[from,to],tags:{highway:"footway",...extra}});
  const ways=[
    way(1,"o","a"),
    way(2,"a","b"),
    way(3,"b","c"),
    way(4,"c","o",oneWayReturn?{oneway:"yes","oneway:foot":"yes"}:{})
  ];
  return {nodes,ways,adjacency:buildDirectedPedestrianGraph(nodes,ways)};
}

test("generates a complete round trip from independently directed graph legs and withholds unverified geometry",()=>{
  const {nodes,ways,adjacency}=squareFixture();
  const expected=2*(haversineMeters(nodes.get("o"),nodes.get("a"))+haversineMeters(nodes.get("a"),nodes.get("b")));
  const result=generateOutAndBackCandidates({
    nodes,ways,adjacency,startNode:"o",requestedDistanceMeters:expected*2,
    minimumSearchBandMeters:20,searchBandRatio:0.05
  });
  assert.equal(result.status,"field_review_required");
  assert.ok(result.routes.length>=1);
  const route=result.routes[0];
  assert.ok(route.outboundPath.nodes.length>=2);
  assert.ok(route.returnPath.nodes.length>=2);
  assert.equal(route.outboundPath.nodes[0],"o");
  assert.equal(route.returnPath.nodes.at(-1),"o");
  assert.equal(route.returnPath.nodes[0],route.outboundPath.nodes.at(-1));
  assert.ok(Math.abs(route.distance.totalMeters-expected*2)<=5);
  assert.equal(route.acceptance.accepted,false);
  assert.equal(route.route,null,"unverified field evidence must withhold navigation geometry");
});

test("does not fabricate a return leg when directed pedestrian edges prohibit it",()=>{
  const {nodes,ways,adjacency}=squareFixture({oneWayReturn:true});
  // A simple directed chain has an outbound route but no legal graph path back.
  const chainWays=[ways[0],ways[1]];
  const chainGraph=buildDirectedPedestrianGraph(nodes,chainWays);
  const result=generateOutAndBackCandidates({
    nodes,ways:chainWays,adjacency:chainGraph,startNode:"o",
    requestedDistanceMeters:haversineMeters(nodes.get("o"),nodes.get("a"))*2,
    minimumSearchBandMeters:20,searchBandRatio:0.05
  });
  assert.equal(result.status,"no_complete_round_trip_found");
  assert.equal(result.routes.length,0);
});

test("snaps an origin to an eligible edge without claiming connector verification",()=>{
  const {nodes,adjacency}=squareFixture();
  const snapped=snapOriginToPedestrianGraph(nodes,adjacency,{lat:0.0005,lon:0.00001},20);
  assert.equal(snapped.ok,true);
  assert.equal(snapped.connectorStatus,"unverified");
  assert.equal(snapped.connectorReview.status,"unverified");
  assert.equal(snapped.startNode,"__stepx_private_origin_snap__");
  assert.ok(snapped.graph.get(snapped.startNode).length>0);
});

test("callable engine validates inputs",()=>{
  const {nodes,adjacency}=squareFixture();
  assert.throws(()=>generateOutAndBackCandidates({nodes,adjacency,startNode:"missing",requestedDistanceMeters:100}),/startNode/);
  assert.throws(()=>generateOutAndBackCandidates({nodes,adjacency,startNode:"o",requestedDistanceMeters:0}),/positive/);
  assert.throws(()=>generateOutAndBackMiles({miles:0,nodes,adjacency,startNode:"o"}),/miles/);
});

test("engine caps output at three alternatives",()=>{
  const {nodes,ways,adjacency}=squareFixture();
  const result=generateOutAndBackCandidates({
    nodes,ways,adjacency,startNode:"o",requestedDistanceMeters:444,
    maxAlternatives:3,minimumSearchBandMeters:100
  });
  assert.ok(result.routes.length<=3);
});
