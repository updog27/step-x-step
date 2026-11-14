import test from "node:test";
import assert from "node:assert/strict";
import {evaluateRouteAcceptance} from "./route-acceptance.mjs";
const now="2026-11-14T12:00:00Z";
const connectorObs={schemaVersion:1,id:"obs-origin",featureId:"origin",featureType:"connector",status:"verified",observedAt:"2026-11-10T12:00:00Z",evidence:{continuous:true,sameSideAccess:true,publicAccess:true}};
const connectionObs=id=>({schemaVersion:1,id:"obs-"+id,featureId:id,featureType:"connection",status:"verified",observedAt:"2026-11-10T12:00:00Z",evidence:{continuous:true,publicAccess:true}});
const crossingObs=id=>({schemaVersion:1,id:"obs-"+id,featureId:id,featureType:"crossing",status:"verified",observedAt:"2026-11-10T12:00:00Z",evidence:{crossingPresent:true,pedestrianAccess:true,curbRamps:"present",signalsOperational:true}});
const base={requestedDistanceMeters:1609.344,pathDistanceMeters:1609.344,originConnector:{status:"verified",fieldObservation:connectorObs},connections:[{id:"segment-1",status:"verified",crossingRequired:false,fieldObservation:connectionObs("segment-1")}]};
test("accepts continuous same-side currently verified route",()=>assert.equal(evaluateRouteAcceptance(base,{now}).status,"accepted"));
test("withholds unverified origin connector",()=>assert.equal(evaluateRouteAcceptance({...base,originConnector:{status:"unverified"}},{now}).status,"needs_field_review"));
test("rejects explicitly disconnected origin connector",()=>assert.equal(evaluateRouteAcceptance({...base,originConnector:{status:"rejected"}},{now}).status,"rejected"));
test("mapped crossing tags do not replace field verification",()=>assert.ok(evaluateRouteAcceptance({...base,connections:[{id:"crossing-1",status:"verified",crossingRequired:true,crossingEvidence:{mapped:true}}]},{now}).reviewItems.some(x=>x.code==="mapped_crossing_requires_current_field_verification")));
test("unmapped required roadway crossing needs field verification",()=>assert.equal(evaluateRouteAcceptance({...base,connections:[{id:"crossing-2",status:"verified",crossingRequired:true}]},{now}).status,"needs_field_review"));
test("required crossing passes only with feature-matched field observation",()=>assert.equal(evaluateRouteAcceptance({...base,connections:[{id:"crossing-3",status:"verified",crossingRequired:true,crossingEvidence:{mapped:false},fieldObservation:crossingObs("crossing-3")}]},{now}).status,"accepted"));
test("unverified gap remains review",()=>assert.equal(evaluateRouteAcceptance({...base,connections:[{id:"gap-1",status:"unverified",crossingRequired:false}]},{now}).status,"needs_field_review"));
test("rejected route connection rejects candidate",()=>assert.equal(evaluateRouteAcceptance({...base,connections:[{id:"private-link",status:"rejected"}]},{now}).status,"rejected"));
test("distance outside tolerance prevents acceptance",()=>assert.equal(evaluateRouteAcceptance({...base,pathDistanceMeters:1700},{now}).status,"needs_field_review"));
test("missing connection evidence fails closed",()=>assert.equal(evaluateRouteAcceptance({...base,connections:[]},{now}).status,"needs_field_review"));
test("stale origin observation cannot pass",()=>assert.equal(evaluateRouteAcceptance({...base,originConnector:{status:"verified",fieldObservation:{...connectorObs,observedAt:"2026-01-01T00:00:00Z"}}},{now}).status,"needs_field_review"));
test("invalid distances and tolerance controls throw",()=>{assert.throws(()=>evaluateRouteAcceptance({...base,pathDistanceMeters:0}),TypeError);assert.throws(()=>evaluateRouteAcceptance(base,{distanceToleranceRatio:0.2}),RangeError)});

test("short routes do not inherit an overly generous 15 metre default tolerance",()=>{
 const short={...base,requestedDistanceMeters:100,pathDistanceMeters:110};
 const result=evaluateRouteAcceptance(short,{now});
 assert.equal(result.distance.toleranceMeters,5);
 assert.equal(result.distance.withinTolerance,false);
 assert.equal(result.status,"needs_field_review");
});
test("distance tolerance remains configurable for GPS and routing calibration",()=>{
 const result=evaluateRouteAcceptance({...base,requestedDistanceMeters:100,pathDistanceMeters:108},{now,minimumDistanceToleranceMeters:10,distanceToleranceRatio:0.02});
 assert.equal(result.distance.toleranceMeters,10);
 assert.equal(result.distance.withinTolerance,true);
});
