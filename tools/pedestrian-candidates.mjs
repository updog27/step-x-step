#!/usr/bin/env node
// Step x Step: private-origin OSM pedestrian graph candidate generator.
// Run locally: STEPX_TEST_LAT=... STEPX_TEST_LON=... node tools/pedestrian-candidates.mjs --miles 0.5,1,2
// Coordinates are never printed or written. This generates candidate network nodes,
// not finished routes; engine routing and safety validation remain separate steps.
import process from "node:process";

const lat = Number(process.env.STEPX_TEST_LAT), lon = Number(process.env.STEPX_TEST_LON);
if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
  console.error("Set valid STEPX_TEST_LAT and STEPX_TEST_LON locally. Coordinates are never printed.");
  process.exit(2);
}
const argv = process.argv.slice(2);
const miArg = argv.includes("--miles") ? argv[argv.indexOf("--miles") + 1] :
  (argv.find(x => x.startsWith("--miles=")) || "--miles=0.5,1,2").split("=")[1];
const miles = String(miArg || "0.5,1,2").split(",").map(Number);
if (!miles.length || miles.some(x => !Number.isFinite(x) || x <= 0 || x > 10)) {
  console.error("Miles must be positive numbers no greater than 10."); process.exit(2);
}
const radius = Number(process.env.OSM_RADIUS_METERS || 1800);
const snapLimit = Number(process.env.OSM_START_SNAP_METERS || 60);
if (!Number.isFinite(radius) || radius < 250 || radius > 5000 ||
    !Number.isFinite(snapLimit) || snapLimit < 5 || snapLimit > 250) {
  console.error("Set OSM_RADIUS_METERS (250–5000) and OSM_START_SNAP_METERS (5–250) within supported bounds.");
  process.exit(2);
}
const endpoint = process.env.OSM_OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const MILE = 1609.344, rad = n => n * Math.PI / 180;
function distance(a,b) {
  const p1=rad(a.lat), p2=rad(b.lat), dp=rad(b.lat-a.lat), dl=rad(b.lon-a.lon);
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function eligible(t={}) {
  const h=t.highway;
  if (!h || ["proposed","construction","abandoned","raceway","bus_guideway","motorway","motorway_link","trunk","trunk_link","service","parking_aisle"].includes(h)) return false;
  if (["no","private","customers","delivery"].includes(t.access) || ["no","private"].includes(t.foot)) return false;
  if (["footway","path","pedestrian","steps"].includes(h)) return true;
  if (h==="cycleway" && t.foot==="yes") return true;
  return ["residential","living_street","tertiary","tertiary_link","secondary","secondary_link"].includes(h)
    && ["both","left","right","yes"].includes(t.sidewalk);
}
// Pedestrian directionality is applied only when explicitly mapped for foot traffic.
// Vehicle oneway tags alone do not make a street one-way for pedestrians.
function directions(t={}) {
  const f=t["foot:forward"]!=="no" && t["oneway:foot"]!=="-1";
  const b=t["foot:backward"]!=="no" && t["oneway:foot"]!=="yes";
  return {forward:f,backward:b};
}
const dy=radius/111320, dx=radius/(111320*Math.cos(rad(lat)));
const box=[lat-dy,lon-dx,lat+dy,lon+dx].join(",");
const q='[out:json][timeout:35];(way["highway"]('+box+'););out body;>;out skel qt;';
const res=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8"},
  body:new URLSearchParams({data:q}),signal:AbortSignal.timeout(45000)});
if(!res.ok) throw new Error("Overpass HTTP "+res.status);
const data=await res.json(), nodes=new Map(), ways=[];
for(const e of data.elements||[]) {
  if(e.type==="node") nodes.set(e.id,{id:e.id,lat:e.lat,lon:e.lon});
  if(e.type==="way" && eligible(e.tags)) ways.push(e);
}
const adj=new Map();
function addArc(a,b,m,w,t) {
  if(!adj.has(a)) adj.set(a,[]);
  adj.get(a).push({to:b,m,way:w});
}
for(const w of ways) for(let i=1;i<w.nodes.length;i++) {
  const a=nodes.get(w.nodes[i-1]), b=nodes.get(w.nodes[i]);
  if(a&&b) {
    const m=distance(a,b), dir=directions(w.tags);
    if(m>0&&m<250) {
      if(dir.forward) addArc(a.id,b.id,m,w.id,w.tags);
      if(dir.backward) addArc(b.id,a.id,m,w.id,w.tags);
    }
  }
}
if(!adj.size) throw new Error("No eligible directed pedestrian edges found.");
let start=null, snap=Infinity;
for(const id of adj.keys()) { const n=nodes.get(id), d=distance({lat,lon},n); if(d<snap){snap=d;start=id;} }
if(snap>snapLimit) throw new Error("Nearest eligible graph node exceeds snap limit; no candidates generated.");
class Heap {
  a=[];
  push(v){this.a.push(v);let i=this.a.length-1;while(i){const p=(i-1)>>1;if(this.a[p][0]<=v[0])break;this.a[i]=this.a[p];i=p;}this.a[i]=v;}
  pop(){if(!this.a.length)return null;const root=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(true){let c=i*2+1;if(c>=this.a.length)break;if(c+1<this.a.length&&this.a[c+1][0]<this.a[c][0])c++;if(this.a[c][0]>=last[0])break;this.a[i]=this.a[c];i=c;}this.a[i]=last;}return root;}
}
const dist=new Map([[start,0]]), prev=new Map(), heap=new Heap();
heap.push([0,start]);
const maxOut=Math.max(...miles)*MILE/2+100;
while(heap.a.length) {
  const [cost,id]=heap.pop(); if(cost!==dist.get(id)||cost>maxOut)continue;
  for(const e of adj.get(id)||[]) {const nd=cost+e.m;if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,id);heap.push([nd,e.to]);}}
}
const results=miles.map(mi=>{
  const target=mi*MILE/2;
  const candidates=[...dist.entries()].filter(([id,d])=>id!==start&&Math.abs(d-target)<=Math.max(20,target*.035))
    .sort((a,b)=>Math.abs(a[1]-target)-Math.abs(b[1]-target)).slice(0,12)
    .map(([id,d])=>({nodeId:id,networkDistanceMeters:+d.toFixed(1),networkDistanceMiles:+(d/MILE).toFixed(4),
      pathNodeCount:(()=>{let n=id,c=1;while(n!==start&&prev.has(n)){n=prev.get(n);c++;}return c;})()}));
  return {requestedOutAndBackMiles:mi,targetOutboundMiles:+(mi/2).toFixed(4),candidates};
});
console.log(JSON.stringify({source:"OpenStreetMap pedestrian-tagged ways via Overpass",radiusMeters:radius,
  eligibleWayCount:ways.length,graphNodeCount:adj.size,snappedStartOffsetMeters:+snap.toFixed(1),results,
  limitations:["Candidate distances are graph lengths over selected OSM-tagged ways, not provider-routed distances.",
  "Explicit foot direction tags are honored; vehicle oneway tags alone are not applied to pedestrians.",
  "This pass does not enforce crossing legality, polygon/parcel exclusions, field overlays, or side-specific sidewalk geometry.",
  "Road centerlines are included only when OSM explicitly tags a sidewalk; side-specific geometry still needs validation.",
  "Unknown access and incomplete tags are not proof of legal public access or safe pedestrian conditions.",
  "Coordinates and route geometry are intentionally omitted from output."]},null,2));
