// Netlify serverless adapter for Step x Step's pedestrian route engine.
// This endpoint intentionally returns review status rather than route geometry
// until the origin connector and every route feature have current field evidence.
import {buildDirectedPedestrianGraph,snapOriginToPedestrianGraph} from "../../tools/pedestrian-graph.mjs";
import {generateOutAndBackMiles} from "../../tools/route-engine.mjs";

const MILE_METERS=1609.344;
const CACHE_TTL_MS=5*60*1000;
const MAX_CACHE_ENTRIES=32;
const cache=new Map();
const requestWindows=new Map();
const RATE_WINDOW_MS=60_000;
const RATE_LIMIT=20;

function json(statusCode,body,extraHeaders={}) {
 return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extraHeaders},body:JSON.stringify(body)};
}
function finite(value){return typeof value==="number"&&Number.isFinite(value);}
function readClientKey(event){
 const forwarded=event.headers?.["x-forwarded-for"]||event.headers?.["X-Forwarded-For"]||"unknown";
 return String(forwarded).split(",")[0].trim().slice(0,80)||"unknown";
}
function rateLimited(key,now=Date.now()){
 const current=requestWindows.get(key);
 if(!current||now-current.startedAt>=RATE_WINDOW_MS){requestWindows.set(key,{startedAt:now,count:1});return false;}
 current.count++;return current.count>RATE_LIMIT;
}
function bboxFor(lat,lon,radius){
 const dy=radius/111320,dx=radius/(111320*Math.cos(lat*Math.PI/180));
 return [lat-dy,lon-dx,lat+dy,lon+dx];
}
export async function loadOsmGraph(lat,lon,radius,fetchImpl=fetch,now=Date.now()){
 const [south,west,north,east]=bboxFor(lat,lon,radius);
 const key=[south.toFixed(4),west.toFixed(4),north.toFixed(4),east.toFixed(4)].join(",");
 const cached=cache.get(key);
 if(cached&&now-cached.createdAt<CACHE_TTL_MS){cached.lastUsed=now;return {...cached,cacheHit:true};}
 const configured=process.env.OSM_OVERPASS_URL;
 const endpoints=configured?[configured]:[
  // Regional North America extract, refreshed daily and intended for lower-latency queries.
  "https://ovp.dresel.systems/api-na/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter"
 ];
 const query=`[out:json][timeout:20];(way["highway"](${south},${west},${north},${east}););out body;>;out skel qt;`;
 let data=null,lastError=null,providerUsed=null;
 for(const endpoint of endpoints){
  let response;
  try{
   response=await fetchImpl(endpoint,{method:"POST",headers:{
    "content-type":"application/x-www-form-urlencoded;charset=UTF-8",
    "accept":"application/json",
    "user-agent":"StepXStep/0.1 (+https://github.com/Updog27/step-x-step)"
   },body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(25000)});
  }catch(error){
   lastError=Object.assign(new Error("Pedestrian map provider could not be reached"),{code:"PROVIDER_TIMEOUT",cause:error});
   continue;
  }
  if(response.status===429){
   lastError=Object.assign(new Error("Pedestrian map provider rate limit reached"),{code:"PROVIDER_RATE_LIMITED"});
   continue;
  }
  if(!response.ok){
   lastError=Object.assign(new Error("Pedestrian map provider returned HTTP "+response.status),{code:"MAP_DATA_UNAVAILABLE"});
   continue;
  }
  let parsed;
  try{parsed=await response.json();}catch{
   lastError=Object.assign(new Error("Pedestrian map provider returned invalid data"),{code:"MAP_DATA_INCOMPLETE"});
   continue;
  }
  // Do not accept partial map extracts with an Overpass timeout/runtime remark.
  if(parsed?.remark){
   lastError=Object.assign(new Error("Pedestrian map provider returned incomplete data: "+String(parsed.remark).slice(0,240)),{code:"MAP_DATA_INCOMPLETE"});
   continue;
  }
  if(!Array.isArray(parsed.elements)||!parsed.elements.length){
   lastError=Object.assign(new Error("No pedestrian map data was returned"),{code:"MAP_DATA_INCOMPLETE"});
   continue;
  }
  data=parsed;providerUsed=new URL(endpoint).hostname;break;
 }
 if(!data)throw lastError||Object.assign(new Error("No pedestrian map provider responded"),{code:"MAP_DATA_UNAVAILABLE"});
 const nodes=new Map(),ways=[];
 for(const element of data.elements){
  if(element.type==="node"&&finite(element.lat)&&finite(element.lon))nodes.set(element.id,{id:element.id,lat:element.lat,lon:element.lon,tags:element.tags||{}});
  else if(element.type==="way"&&Array.isArray(element.nodes))ways.push(element);
 }
 if(!nodes.size||!ways.length)throw Object.assign(new Error("Pedestrian map response was incomplete"),{code:"MAP_DATA_INCOMPLETE"});
 const graph=buildDirectedPedestrianGraph(nodes,ways);
 if(!graph.size)throw Object.assign(new Error("No eligible pedestrian paths were found"),{code:"NO_CONNECTED_PEDESTRIAN_NETWORK"});
 const result={nodes,ways,graph,provider:providerUsed,createdAt:now,lastUsed:now,cacheHit:false};
 cache.set(key,result);
 if(cache.size>MAX_CACHE_ENTRIES){
  const oldest=[...cache.entries()].sort((a,b)=>a[1].lastUsed-b[1].lastUsed)[0];
  if(oldest)cache.delete(oldest[0]);
 }
 return result;
}
function publicRouteResult(result){
 return {
  status:result.status,
  requestedDistanceMeters:result.requestedDistanceMeters,
  toleranceMeters:result.toleranceMeters,
  candidateCount:result.candidateCount,
  diagnostics:result.diagnostics,
  routes:result.routes.map(route=>({
   rank:route.rank,status:route.status,
   distance:route.distance?{
    outboundMeters:route.distance.outboundMeters,
    returnMeters:route.distance.returnMeters,
    totalMeters:route.distance.totalMeters,
    errorMeters:route.distance.errorMeters,
    withinTolerance:route.distance.withinTolerance
   }:null,
   acceptance:{status:route.acceptance.status,accepted:route.acceptance.accepted,
    reasons:route.acceptance.reasons,reviewItems:route.acceptance.reviewItems.map(item=>({code:item.code}))},
   // Only a fully accepted route may ever expose geometry.
   geometry:route.acceptance.accepted?route.route?.geometry??null:null
  }))
 };
}
export async function handleRouteRequest(event,dependencies={}){
 if(event.httpMethod!=="POST")return json(405,{error:{code:"METHOD_NOT_ALLOWED",message:"Use POST."}},{allow:"POST"});
 const key=readClientKey(event),now=(dependencies.now??Date.now)();
 if(rateLimited(key,now))return json(429,{error:{code:"RATE_LIMITED",message:"Too many route requests. Try again shortly."}});
 let body;
 try{body=JSON.parse(event.body||"{}");}catch{return json(400,{error:{code:"INVALID_JSON",message:"Request body must be valid JSON."}});}
 const {lat,lon,miles,routeType="out_and_back"}=body;
 if(!finite(lat)||Math.abs(lat)>90||!finite(lon)||Math.abs(lon)>180)
  return json(400,{error:{code:"INVALID_ORIGIN",message:"A valid latitude and longitude are required."}});
 if(!finite(miles)||miles<=0||miles>3)
  return json(400,{error:{code:"INVALID_DISTANCE",message:"Distance must be greater than 0 and no more than 3 miles."}});
 if(routeType!=="out_and_back")
  return json(400,{error:{code:"UNSUPPORTED_ROUTE_TYPE",message:"This endpoint currently supports out-and-back routes only."}});
 const radius=Math.min(5000,Math.max(500,miles*MILE_METERS*0.9+300));
 try{
  const map=await (dependencies.loadOsmGraph??loadOsmGraph)(lat,lon,radius,dependencies.fetch??fetch,now);
  const snapped=snapOriginToPedestrianGraph(map.nodes,map.graph,{lat,lon},60);
  if(!snapped.ok)return json(200,{status:"no_route",failureCode:"ORIGIN_NOT_SNAPPABLE",message:"No eligible pedestrian path was found close enough to the starting point.",routes:[]});
  const nodes=new Map(map.nodes);
  if(snapped.virtualNode)nodes.set(snapped.startNode,snapped.virtualNode);
  const result=generateOutAndBackMiles({nodes,ways:map.ways,adjacency:snapped.graph,startNode:snapped.startNode,miles,originConnector:{status:"unverified"}});
  return json(200,{...publicRouteResult(result),mapData:{source:"OpenStreetMap",cacheHit:map.cacheHit===true},notice:"Routes remain withheld until origin access, connections, and crossings have current field verification."});
 }catch(error){
  const code=error.code||"MAP_DATA_UNAVAILABLE";
  const status=code==="PROVIDER_RATE_LIMITED"?503:code==="PROVIDER_TIMEOUT"?504:503;
  return json(status,{status:"unavailable",error:{code,message:error.message||"Route service is temporarily unavailable."}});
 }
}
export const handler=async(event)=>handleRouteRequest(event);
