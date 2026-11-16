// Manual, bounded live-data validation against public Tampa landmarks.
// Aggregate diagnostics only: never print coordinates or OSM node/way IDs.
// Snap and feature diagnostics are review aids, never route-acceptance evidence.
import {loadOsmGraph} from "../netlify/functions/routes.mjs";
import {
  classifyPedestrianWay,
  snapOriginToPedestrianGraph,
  auditPedestrianConnectivity,
  detectOriginConnectorRoadwayIntersections
} from "./pedestrian-graph.mjs";
import {generateOutAndBackMiles} from "./route-engine.mjs";

const TEST_SITES = [
  {name:"Curtis Hixon Waterfront Park, Tampa",origin:{lat:27.9498,lon:-82.4646}},
  {name:"Armature Works / Tampa Heights, Tampa",origin:{lat:27.9619,lon:-82.4646}},
  {name:"Ybor City Historic District, Tampa",origin:{lat:27.9604,lon:-82.4376}}
];
const SEARCH_RADIUS_METERS=1400;
const TEST_DISTANCE_MILES=0.5;

function countBy(values,keyFn){
  const counts={};
  for(const value of values){const key=keyFn(value);counts[key]=(counts[key]||0)+1;}
  return counts;
}

async function validateSite(site){
  console.log("\n---",site.name,"---");
  const map=await loadOsmGraph(site.origin.lat,site.origin.lon,SEARCH_RADIUS_METERS);
  const wayClasses=countBy(map.ways,way=>classifyPedestrianWay(way.tags).status);
  const eligibleWays=map.ways.filter(way=>classifyPedestrianWay(way.tags).status==="eligible");
  const reviewWays=map.ways.filter(way=>classifyPedestrianWay(way.tags).status==="needs_review");
  const edgeCount=[...map.graph.values()].reduce((sum,edges)=>sum+edges.length,0);
  const graphNodeIds=new Set(map.graph.keys());
  for(const edges of map.graph.values())for(const edge of edges)graphNodeIds.add(edge.to);
  const graphNodes=new Map([...map.nodes].filter(([id])=>graphNodeIds.has(id)));
  const audit=auditPedestrianConnectivity(graphNodes,map.graph);

  console.log("Provider:",map.provider||"cached provider metadata unavailable");
  console.log("Cache hit:",map.cacheHit===true);
  console.log("Raw OSM nodes / ways:",map.nodes.size,"/",map.ways.length);
  console.log("Way classification:",JSON.stringify(wayClasses));
  console.log("Eligible / needs-review pedestrian ways:",eligibleWays.length,"/",reviewWays.length);
  console.log("Directed graph nodes / edges:",graphNodes.size,"/",edgeCount);
  console.log("Weak components / isolated graph nodes:",audit.componentCount,"/",audit.isolated.length);
  if(!graphNodes.size)throw new Error("No directed pedestrian graph was built for "+site.name);

  const snapped=snapOriginToPedestrianGraph(map.nodes,map.graph,site.origin,60);
  console.log("Origin snap within production 60m limit:",snapped.ok);
  if(!snapped.ok){
    console.log("Origin snap result:",snapped.reason);
    return {site:site.name,mapLoaded:true,originSnapped:false,candidateCount:0};
  }
  console.log("Origin connector status / offset / review:",snapped.connectorStatus,"/",snapped.connectorReview.straightLineOffsetMeters,"m /",snapped.connectorReview.distanceClass);
  console.log("Nearest mapped feature:",JSON.stringify({
    position:snapped.connectorReview.projectedPosition,
    edgeLengthMeters:snapped.connectorReview.edgeLengthMeters,
    classification:snapped.connectorReview.nearestWayClassification,
    tags:snapped.connectorReview.nearestWayTags
  }));
  const connectorRoadwayReview=detectOriginConnectorRoadwayIntersections(
    map.nodes,map.ways,site.origin,(snapped.virtualNode || map.nodes.get(snapped.startNode))
  );
  console.log("Straight-line connector roadway intersections:",connectorRoadwayReview.crossingCount,
    connectorRoadwayReview.crossings.map(item=>item.roadClass));
  const nodes=new Map(map.nodes);
  if(snapped.virtualNode)nodes.set(snapped.startNode,snapped.virtualNode);
  const result=generateOutAndBackMiles({
    nodes,ways:map.ways,adjacency:snapped.graph,startNode:snapped.startNode,
    miles:TEST_DISTANCE_MILES,originConnector:{status:"unverified"}
  });
  console.log("Candidate status:",result.status);
  console.log("Complete round-trip candidates:",result.candidateCount);
  console.log("Turnarounds evaluated / withheld for review:",result.diagnostics.turnaroundsEvaluated,"/",result.diagnostics.withheldForReview);
  console.log("Top route distances (m):",JSON.stringify(result.routes.map(route=>({
    total:route.distance?.totalMeters??null,
    outbound:route.distance?.outboundMeters??null,
    return:route.distance?.returnMeters??null,
    accepted:route.acceptance.accepted
  }))));
  const best=result.routes[0];
  const inventory=best?.featureInventory;
  console.log("Best candidate feature inventory:",JSON.stringify(inventory?{
    connectionFeatures:inventory.connections.length,
    roadwayCrossingFeatures:inventory.crossings.length,
    mappedCrossingNodes:inventory.mappedNodeCrossings.length,
    crossingGeometryStatus:inventory.crossingGeometryStatus,
    crossingRoadClasses:countBy(inventory.crossings,item=>item.roadClass)
  }:null));
  console.log("Best candidate acceptance review codes:",JSON.stringify(best?.acceptance.reviewItems.map(item=>item.code)||[]));
  console.log("Navigation geometry withheld:",result.routes.every(route=>!route.acceptance.accepted));
  return {site:site.name,mapLoaded:true,originSnapped:true,candidateCount:result.candidateCount,componentCount:audit.componentCount,
    originOffsetMeters:snapped.connectorReview.straightLineOffsetMeters,
    nearestHighway:snapped.connectorReview.nearestWayTags.highway,
    connectorRoadwayIntersections:connectorRoadwayReview.crossingCount,
    routeConnections:inventory?.connections.length??0,routeCrossings:inventory?.crossings.length??0};
}

async function main(){
  console.log("Step x Step live OSM validation");
  console.log("Public test sites:",TEST_SITES.length);
  console.log("Search radius:",SEARCH_RADIUS_METERS,"m; route request:",TEST_DISTANCE_MILES,"mile out-and-back");
  const outcomes=[];
  for(const site of TEST_SITES)outcomes.push(await validateSite(site));
  console.log("\n=== Aggregate result ===");
  console.log(JSON.stringify(outcomes,null,2));
  const loaded=outcomes.filter(item=>item.mapLoaded).length;
  const routed=outcomes.filter(item=>item.candidateCount>0).length;
  console.log("Map extracts loaded:",loaded,"/",TEST_SITES.length);
  console.log("Sites producing complete graph-based round trips:",routed,"/",TEST_SITES.length);
  if(loaded!==TEST_SITES.length)throw new Error("One or more live OSM map extracts could not be loaded.");
  console.log("Live map-data acquisition succeeded at all test sites. Candidate generation and evidence outcomes are reported per site.");
}

main().catch(error=>{
  console.error("Live OSM validation failed:",error.code||error.name,error.message);
  process.exitCode=1;
});
