// Conservative route acceptance policy. It evaluates supplied evidence;
// it does not infer sidewalk geometry, crossing necessity, or real-world safety.
import {validateFieldObservation} from "./field-observations.mjs";
const VALID=new Set(["verified","unverified","rejected"]);
export function evaluateRouteAcceptance(input,options={}) {
 if(!input||typeof input!=="object")throw new TypeError("Route acceptance input is required");
 const requested=input.requestedDistanceMeters,actual=input.pathDistanceMeters;
 if(!Number.isFinite(requested)||requested<=0||!Number.isFinite(actual)||actual<=0)throw new TypeError("Requested and path distances must be positive finite meters");
 const ratio=options.distanceToleranceRatio??0.02,min=options.minimumDistanceToleranceMeters??15;
 if(!Number.isFinite(ratio)||ratio<0||ratio>0.1||!Number.isFinite(min)||min<0)throw new RangeError("Distance tolerance must be 0–0.1 and minimum non-negative");
 const reasons=[],reviewItems=[],rejectedItems=[],tol=Math.max(min,requested*ratio),err=Math.abs(actual-requested);
 if(err>tol)reasons.push("requested_distance_out_of_tolerance");
 const observationOptions={now:options.now,maxAgeDays:options.maxObservationAgeDays};
 const c=input.originConnector;
 if(!c||!VALID.has(c.status))reviewItems.push({code:"origin_connector_unverified",id:"origin"});
 else if(c.status==="rejected")rejectedItems.push({code:"origin_connector_rejected",id:"origin"});
 else {
  const v=validateFieldObservation(c.fieldObservation,{featureId:"origin",featureType:"connector"},observationOptions);
  if(c.status!=="verified"||!v.verified)reviewItems.push({code:"origin_same_side_access_unverified",id:"origin",observationFailures:v.failures});
 }
 if(!Array.isArray(input.connections)||!input.connections.length)reviewItems.push({code:"route_connections_not_supplied",id:"route"});
 else input.connections.forEach((x,i)=>{
  const id=x?.id??"connection-"+(i+1);
  if(!x||!VALID.has(x.status)){reviewItems.push({code:"connection_status_unverified",id});return;}
  if(x.status==="rejected"){rejectedItems.push({code:"connection_rejected",id});return;}
  if(x.status!=="verified")reviewItems.push({code:"connection_topology_unverified",id});
  if(x.crossingRequired===true){
   const v=validateFieldObservation(x.fieldObservation,{featureId:id,featureType:"crossing",controlled:x.crossingEvidence?.controlled===true},observationOptions);
   if(!v.verified)reviewItems.push({code:x.crossingEvidence?.mapped===true?"mapped_crossing_requires_current_field_verification":"roadway_crossing_requires_current_field_verification",id,observationFailures:v.failures});
  } else if(x.crossingRequired===false){
   const v=validateFieldObservation(x.fieldObservation,{featureId:id,featureType:"connection"},observationOptions);
   if(x.status!=="verified"||!v.verified)reviewItems.push({code:"connection_field_verification_missing",id,observationFailures:v.failures});
  } else reviewItems.push({code:"crossing_requirement_unknown",id});
 });
 const rejected=rejectedItems.length>0,needs=reviewItems.length>0||reasons.length>0,status=rejected?"rejected":needs?"needs_field_review":"accepted";
 return {accepted:status==="accepted",status,reasons,reviewItems,rejectedItems,
  distance:{requestedMeters:requested,actualMeters:actual,errorMeters:+err.toFixed(2),toleranceMeters:+tol.toFixed(2),withinTolerance:err<=tol},
  limitations:[
   "Passing supplied evidence gates is not a guarantee of real-world safety.",
   "Mapped crossing tags never replace a current, feature-matched field observation.",
   "Field observations expire after 90 days by default; missing, stale, mismatched, or incomplete evidence fails closed.",
   "Crossing-required status must come from a separate geometry/context review; an untagged junction is not automatically a roadway crossing."
  ]};
}
