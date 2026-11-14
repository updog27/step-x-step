// Structured field observations for Step x Step pedestrian-route review.
// Evidence records are not guarantees of safety or legal access. Keep precise
// observation coordinates/photos in a private store, never this public repository.
const TYPES=new Set(["crossing","connector","connection"]);
export function validateFieldObservation(o,expected={},options={}) {
 const now=options.now?new Date(options.now):new Date(), maxAge=options.maxAgeDays??90, failures=[];
 if(!Number.isFinite(now.getTime())) throw new TypeError("Valid current date required");
 if(!Number.isFinite(maxAge)||maxAge<0||maxAge>365) throw new RangeError("maxAgeDays must be 0–365");
 if(!o||typeof o!=="object") return {verified:false,failures:["field_observation_missing"]};
 if(o.schemaVersion!==1) failures.push("unsupported_observation_schema");
 if(typeof o.id!=="string"||!o.id.trim()) failures.push("observation_id_missing");
 if(typeof expected.featureId!=="string"||!expected.featureId||o.featureId!==expected.featureId) failures.push("feature_id_mismatch");
 if(!TYPES.has(o.featureType)||(expected.featureType&&o.featureType!==expected.featureType)) failures.push("feature_type_mismatch");
 if(o.status!=="verified") failures.push("observation_not_verified");
 const timestampPattern=/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$/;\n const stamp=typeof o.observedAt==="string"&&timestampPattern.test(o.observedAt)?Date.parse(o.observedAt):NaN;
 if(!Number.isFinite(stamp)) failures.push("observation_timestamp_invalid");
 else {const age=now.getTime()-stamp;if(age<0)failures.push("observation_timestamp_in_future");else if(age>maxAge*86400000)failures.push("observation_stale");}
 const e=o.evidence||{};
 if(o.featureType==="crossing"){
  if(e.crossingPresent!==true)failures.push("crossing_presence_not_verified");
  if(e.pedestrianAccess!==true)failures.push("pedestrian_access_not_verified");
  if(!["present","not_applicable"].includes(e.curbRamps))failures.push("curb_ramp_status_not_verified");
  if(expected.controlled===true&&e.signalsOperational!==true)failures.push("signal_operation_not_verified");
 } else if(o.featureType==="connector"){
  if(e.continuous!==true)failures.push("connector_continuity_not_verified");
  if(e.sameSideAccess!==true)failures.push("same_side_access_not_verified");
  if(e.publicAccess!==true)failures.push("public_access_not_verified");
 } else if(o.featureType==="connection"){
  if(e.continuous!==true)failures.push("connection_continuity_not_verified");
  if(e.publicAccess!==true)failures.push("public_access_not_verified");
 }
 return {verified:failures.length===0,failures,observationId:o.id||null,featureId:o.featureId||null,featureType:o.featureType||null,observedAt:o.observedAt||null};
}
// crossingRequired must come from a separate geometry/context review; this
// helper never infers a required road crossing from an untagged junction.
export function assessCrossingRequirement(input,options={}) {
 if(!input||typeof input!=="object")throw new TypeError("Crossing assessment input required");
 const {featureId,crossingRequired,mappedEvidence,fieldObservation}=input;
 if(crossingRequired!==true&&crossingRequired!==false)return {status:"needs_review",reason:"crossing_requirement_unknown"};
 if(crossingRequired===false)return {status:"not_required",reason:"no_roadway_crossing_required_by_geometry_review"};
 const evidence=mappedEvidence||{mapped:false,controlled:false,type:"unknown"};
 const observation=validateFieldObservation(fieldObservation,{featureId,featureType:"crossing",controlled:evidence.controlled===true},options);
 if(!observation.verified)return {status:"needs_field_review",reason:evidence.mapped?"mapped_crossing_needs_current_field_verification":"unmapped_crossing_needs_current_field_verification",evidence,observationFailures:observation.failures};
 return {status:"field_verified",evidence,observationId:observation.observationId};
}
