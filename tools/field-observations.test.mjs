import test from "node:test";
import assert from "node:assert/strict";
import {validateFieldObservation,assessCrossingRequirement} from "./field-observations.mjs";
const now="2026-11-14T12:00:00Z";
const good=(overrides={})=>({schemaVersion:1,id:"obs-1",featureId:"crossing-7",featureType:"crossing",status:"verified",observedAt:"2026-11-10T12:00:00Z",evidence:{crossingPresent:true,pedestrianAccess:true,curbRamps:"present",signalsOperational:true},...overrides});
test("accepts current feature-matched crossing observation",()=>assert.equal(validateFieldObservation(good(),{featureId:"crossing-7",featureType:"crossing",controlled:true},{now}).verified,true));
test("rejects stale, future, mismatched and incomplete observations",()=>{
 assert.ok(validateFieldObservation(good({observedAt:"2026-01-01T00:00:00Z"}),{featureId:"crossing-7"},{now}).failures.includes("observation_stale"));
 assert.ok(validateFieldObservation(good({observedAt:"2027-01-01T00:00:00Z"}),{featureId:"crossing-7"},{now}).failures.includes("observation_timestamp_in_future"));
 assert.ok(validateFieldObservation(good(),{featureId:"other"},{now}).failures.includes("feature_id_mismatch"));
 assert.ok(validateFieldObservation(good({evidence:{crossingPresent:true}}),{featureId:"crossing-7"},{now}).failures.includes("pedestrian_access_not_verified"));
});
test("controlled crossings require signal operation verification",()=>assert.ok(validateFieldObservation(good({evidence:{crossingPresent:true,pedestrianAccess:true,curbRamps:"present"}}),{featureId:"crossing-7",controlled:true},{now}).failures.includes("signal_operation_not_verified")));
test("unknown crossing requirement remains review",()=>assert.equal(assessCrossingRequirement({featureId:"crossing-7",mappedEvidence:{mapped:false}}).status,"needs_review"));
test("mapped tags alone never pass field gate",()=>assert.equal(assessCrossingRequirement({featureId:"crossing-7",crossingRequired:true,mappedEvidence:{mapped:true}},{now}).status,"needs_field_review"));
test("complete field-verified controlled crossing passes",()=>assert.equal(assessCrossingRequirement({featureId:"crossing-7",crossingRequired:true,mappedEvidence:{mapped:true,controlled:true},fieldObservation:good()},{now}).status,"field_verified"));
test("not-required differs from unknown",()=>assert.equal(assessCrossingRequirement({featureId:"link-1",crossingRequired:false}).status,"not_required"));

test("rejects timestamps without an explicit timezone",()=>{
 const result=validateFieldObservation(good({observedAt:"2026-11-10T12:00:00"}),{featureId:"crossing-7",featureType:"crossing"},{now});
 assert.ok(result.failures.includes("observation_timestamp_invalid"));
 assert.equal(result.verified,false);
});
test("rejects malformed calendar timestamps",()=>{
 const result=validateFieldObservation(good({observedAt:"not-a-date"}),{featureId:"crossing-7",featureType:"crossing"},{now});
 assert.ok(result.failures.includes("observation_timestamp_invalid"));
});
