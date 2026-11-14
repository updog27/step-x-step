import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRouteAcceptance } from "./route-acceptance.mjs";

const verifiedBase = {
  requestedDistanceMeters: 1609.344,
  pathDistanceMeters: 1609.344,
  originConnector: {status:"verified",sameSideAccess:true},
  connections: [{id:"segment-1",status:"verified"}]
};

test("accepts a continuous, same-side, verified route within distance tolerance", () => {
  const result=evaluateRouteAcceptance(verifiedBase);
  assert.equal(result.status,"accepted");
  assert.equal(result.accepted,true);
});

test("withholds an unverified origin connector", () => {
  const result=evaluateRouteAcceptance({
    ...verifiedBase,
    originConnector:{status:"unverified",sameSideAccess:false}
  });
  assert.equal(result.status,"needs_field_review");
  assert.ok(result.reviewItems.some(item=>item.code==="origin_same_side_access_unverified"));
});

test("rejects an explicitly disconnected or inaccessible origin connector", () => {
  const result=evaluateRouteAcceptance({
    ...verifiedBase,
    originConnector:{status:"rejected",sameSideAccess:false}
  });
  assert.equal(result.status,"rejected");
});

test("a mapped crossing does not replace field verification", () => {
  const result=evaluateRouteAcceptance({
    ...verifiedBase,
    connections:[{
      id:"road-crossing-1",status:"verified",crossingRequired:true,
      crossingEvidence:{mapped:true,type:"zebra"},fieldVerified:false
    }]
  });
  assert.equal(result.status,"needs_field_review");
  assert.ok(result.reviewItems.some(item=>item.code==="mapped_crossing_requires_field_verification"));
});

test("an unmarked required roadway crossing also needs field verification", () => {
  const result=evaluateRouteAcceptance({
    ...verifiedBase,
    connections:[{id:"road-crossing-2",status:"verified",crossingRequired:true}]
  });
  assert.equal(result.status,"needs_field_review");
  assert.ok(result.reviewItems.some(item=>item.code==="roadway_crossing_requires_field_verification"));
});

test("a required roadway crossing passes only with field verification", () => {
  const result=evaluateRouteAcceptance({
    ...verifiedBase,
    connections:[{
      id:"road-crossing-3",status:"verified",crossingRequired:true,
      crossingEvidence:{mapped:false,type:"unknown"},fieldVerified:true
    }]
  });
  assert.equal(result.status,"accepted");
});

test("unverified network gaps remain review items even without a roadway crossing", () => {
  const result=evaluateRouteAcceptance({
    ...verifiedBase,
    connections:[{id:"map-gap-1",status:"unverified",crossingRequired:false}]
  });
  assert.equal(result.status,"needs_field_review");
  assert.ok(result.reviewItems.some(item=>item.code==="connection_topology_unverified"));
});

test("explicitly rejected route connections reject the candidate", () => {
  const result=evaluateRouteAcceptance({
    ...verifiedBase,
    connections:[{id:"private-link",status:"rejected"}]
  });
  assert.equal(result.status,"rejected");
});

test("distance outside tolerance prevents acceptance", () => {
  const result=evaluateRouteAcceptance({...verifiedBase,pathDistanceMeters:1700});
  assert.equal(result.status,"needs_field_review");
  assert.equal(result.distance.withinTolerance,false);
  assert.ok(result.reasons.includes("requested_distance_out_of_tolerance"));
});

test("missing connection evidence fails closed", () => {
  const result=evaluateRouteAcceptance({...verifiedBase,connections:[]});
  assert.equal(result.status,"needs_field_review");
  assert.ok(result.reviewItems.some(item=>item.code==="route_connections_not_supplied"));
});

test("invalid distances and tolerance controls are rejected", () => {
  assert.throws(()=>evaluateRouteAcceptance({...verifiedBase,pathDistanceMeters:0}),TypeError);
  assert.throws(()=>evaluateRouteAcceptance(verifiedBase,{distanceToleranceRatio:0.2}),RangeError);
});
