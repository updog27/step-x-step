// Manual, bounded live-data validation against a public Tampa landmark.
// This script reports aggregate diagnostics only; it never prints coordinates or OSM IDs.
import {loadOsmGraph} from "../netlify/functions/routes.mjs";
import {
  classifyPedestrianWay,
  snapOriginToPedestrianGraph,
  auditPedestrianConnectivity
} from "./pedestrian-graph.mjs";
import {generateOutAndBackMiles} from "./route-engine.mjs";

const TEST_SITE = "Curtis Hixon Waterfront Park, Tampa";
const ORIGIN = {lat:27.9498,lon:-82.4646}; // public landmark reference, not a user location
const SEARCH_RADIUS_METERS = 1400;
const TEST_DISTANCE_MILES = 0.5;

function countBy(values,keyFn){
  const counts={};
  for(const value of values){const key=keyFn(value);counts[key]=(counts[key]||0)+1;}
  return counts;
}

async function main(){
  console.log("Step x Step live OSM validation");
  console.log("Test area:",TEST_SITE);
  console.log("Requested network search radius:",SEARCH_RADIUS_METERS,"m");
  const map=await loadOsmGraph(ORIGIN.lat,ORIGIN.lon,SEARCH_RADIUS_METERS);
  const wayClasses=countBy(map.ways,way=>classifyPedestrianWay(way.tags).status);
  const eligibleWays=map.ways.filter(way=>classifyPedestrianWay(way.tags).status==="eligible");
  const reviewWays=map.ways.filter(way=>classifyPedestrianWay(way.tags).status==="needs_review");
  const graphNodeCount=map.graph.size;
  const edgeCount=[...map.graph.values()].reduce((sum,edges)=>sum+edges.length,0);
  const graphNodeIds=new Set(map.graph.keys());
  for(const edges of map.graph.values())for(const edge of edges)graphNodeIds.add(edge.to);
  const graphNodes=new Map([...map.nodes].filter(([id])=>graphNodeIds.has(id)));
  const audit=auditPedestrianConnectivity(graphNodes,map.graph);
  console.log("Provider:",map.provider||"cached provider metadata unavailable");
  console.log("Cache hit:",map.cacheHit===true);
  console.log("Raw OSM node count:",map.nodes.size);
  console.log("Raw OSM way count:",map.ways.length);
  console.log("Way classification:",JSON.stringify(wayClasses));
  console.log("Eligible pedestrian ways:",eligibleWays.length);
  console.log("Needs-review ways:",reviewWays.length);
  console.log("Directed graph nodes:",graphNodeCount);
  console.log("Directed graph edges:",edgeCount);
  console.log("Graph nodes included in connectivity audit:",graphNodes.size);
  console.log("Weakly connected components:",audit.componentCount);
  console.log("Isolated nodes:",audit.isolated.length);
  if(!graphNodeCount)throw new Error("No directed pedestrian graph was built from live OSM data.");

  const snapped=snapOriginToPedestrianGraph(map.nodes,map.graph,ORIGIN,60);
  console.log("Origin snap within production 60m limit:",snapped.ok);
  if(!snapped.ok){
    console.log("Snap result:",snapped.reason);
    console.log("Validation outcome: MAP DATA ACQUIRED; TEST ORIGIN NOT CONNECTED TO ELIGIBLE PEDESTRIAN GEOMETRY.");
    process.exitCode=2;
    return;
  }
  console.log("Origin connector status:",snapped.connectorStatus);
  console.log("Origin projection offset (m):",snapped.connectorReview.straightLineOffsetMeters);
  console.log("Origin connector review:",snapped.connectorReview.distanceClass);

  const nodes=new Map(map.nodes);
  if(snapped.virtualNode)nodes.set(snapped.startNode,snapped.virtualNode);
  const result=generateOutAndBackMiles({
    nodes,ways:map.ways,adjacency:snapped.graph,startNode:snapped.startNode,
    miles:TEST_DISTANCE_MILES,originConnector:{status:"unverified"}
  });
  console.log("Candidate search distance (miles):",TEST_DISTANCE_MILES);
  console.log("Candidate status:",result.status);
  console.log("Complete round-trip candidates:",result.candidateCount);
  console.log("Turnarounds evaluated:",result.diagnostics.turnaroundsEvaluated);
  console.log("Withheld for field review:",result.diagnostics.withheldForReview);
  console.log("Candidate distance summaries (m):",JSON.stringify(result.routes.map(route=>({
    total:route.distance?.totalMeters??null,
    outbound:route.distance?.outboundMeters??null,
    return:route.distance?.returnMeters??null,
    accepted:route.acceptance.accepted,
    reviewCodes:route.acceptance.reviewItems.map(item=>item.code)
  }))));
  if(result.candidateCount===0){
    console.log("Validation outcome: LIVE OSM DATA ACQUIRED; NO COMPLETE ROUND TRIP FOUND FOR THIS FIXTURE.");
    process.exitCode=2;
    return;
  }
  console.log("Validation outcome: LIVE OSM DATA ACQUIRED AND ROUTE ENGINE GENERATED COMPLETE GRAPH-BASED ROUND-TRIP CANDIDATES.");
  console.log("Navigation geometry remains withheld pending field verification; this is expected.");
}

main().catch(error=>{
  console.error("Live OSM validation failed:",error.code||error.name,error.message);
  process.exitCode=1;
});
