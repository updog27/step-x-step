import test from "node:test";
import assert from "node:assert/strict";
import {generateOutAndBackCandidates,generateOutAndBackMiles} from "./route-engine.mjs";

function fixture(){
 const nodes=new Map([
  ["o",{id:"o",lat:27,lon:-82,tags:{}}],
  ["a",{id:"a",lat:27.001,lon:-82,tags:{}}],
  ["b",{id:"b",lat:27.001,lon:-81.999,tags:{}}],
  ["c",{id:"c",lat:27,lon:-81.999,tags:{}}]
 ]);
 const edge=(to,wayId)=>({to,meters:111,wayId,edgeId:`${wayId}:${to}`,geometry:null,tags:{highway:"footway"}});
 const adjacency=new Map([
  ["o",[edge("a",1),edge("c",4)]],
  ["a",[edge("o",2),edge("b",3)]],
  ["b",[edge("a",5),edge("c",6)]],
  ["c",[edge("b",7),edge("o",8)]]
 ]);
 return {nodes,adjacency};
}
test("callable engine returns structured review result and never publishes unverified geometry",()=>{
 const {nodes,adjacency}=fixture();
 const result=generateOutAndBackCandidates({nodes,adjacency,startNode:"o",requestedDistanceMeters:444,minimumSearchBandMeters:100});
 assert.ok(["field_review_required","routes_available","no_complete_round_trip_found"].includes(result.status));
 assert.equal(result.requestedDistanceMeters,444);
 for(const candidate of result.routes){
  if(candidate.acceptance.accepted) assert.ok(candidate.route?.geometry?.coordinates?.length);
  else assert.equal(candidate.route,null);
 }
});
test("callable engine validates inputs",()=>{
 const {nodes,adjacency}=fixture();
 assert.throws(()=>generateOutAndBackCandidates({nodes,adjacency,startNode:"missing",requestedDistanceMeters:100}),/startNode/);
 assert.throws(()=>generateOutAndBackCandidates({nodes,adjacency,startNode:"o",requestedDistanceMeters:0}),/positive/);
 assert.throws(()=>generateOutAndBackMiles({miles:0,nodes,adjacency,startNode:"o"}),/miles/);
});
test("engine caps output at three alternatives",()=>{
 const {nodes,adjacency}=fixture();
 const result=generateOutAndBackCandidates({nodes,adjacency,startNode:"o",requestedDistanceMeters:444,maxAlternatives:3,minimumSearchBandMeters:100});
 assert.ok(result.routes.length<=3);
});
