// Callable, deterministic pedestrian route engine. Network acquisition and origin
// access verification are deliberately outside this module.
import {
  dijkstra, kShortestPaths, selectCrossingAwarePaths,
  buildDirectedOutAndBackCandidate, buildRouteFeatureInventory,
  selectRoundTripCorridorDiversePaths
} from "./pedestrian-graph.mjs";
import {discoverTurnaroundCandidates} from "./turnaround-discovery.mjs";
import {evaluateRouteAcceptance} from "./route-acceptance.mjs";

const METERS_PER_MILE=1609.344;
const finitePositive=(value)=>Number.isFinite(value)&&value>0;

export function generateOutAndBackCandidates({
  nodes, ways=[], adjacency, startNode, requestedDistanceMeters,
  originConnector={status:"unverified"}, maxAlternatives=3,
  distanceToleranceRatio=0.02, minimumDistanceToleranceMeters=5,
  searchBandRatio=0.12, minimumSearchBandMeters=60,
  maxTurnarounds=24, pathsPerTurnaround=8
}={}) {
  if (!(nodes instanceof Map) || !(adjacency instanceof Map))
    throw new TypeError("nodes and adjacency must be Maps");
  if (!adjacency.has(startNode)) throw new RangeError("startNode is not in the directed pedestrian graph");
  if (!finitePositive(requestedDistanceMeters)) throw new RangeError("requestedDistanceMeters must be positive finite meters");
  if (!Number.isInteger(maxAlternatives)||maxAlternatives<1||maxAlternatives>3)
    throw new RangeError("maxAlternatives must be an integer from 1 to 3");
  if (!finitePositive(searchBandRatio)||searchBandRatio>0.5||
      !finitePositive(minimumSearchBandMeters)||!Number.isInteger(maxTurnarounds)||maxTurnarounds<1||
      !Number.isInteger(pathsPerTurnaround)||pathsPerTurnaround<1)
    throw new RangeError("invalid candidate search controls");

  const targetOutbound=requestedDistanceMeters/2;
  const searchBand=Math.max(minimumSearchBandMeters,targetOutbound*searchBandRatio);
  const {distances}=dijkstra(adjacency,startNode,targetOutbound+searchBand);
  const pool=[...distances.entries()]
    .filter(([id,meters])=>id!==startNode&&Math.abs(meters-targetOutbound)<=searchBand)
    .sort((a,b)=>Math.abs(a[1]-targetOutbound)-Math.abs(b[1]-targetOutbound));
  const turnarounds=discoverTurnaroundCandidates(adjacency,startNode,pool,targetOutbound,searchBand,{maxTurnarounds});
  const evaluated=[];
  for(const {candidate:[turnaroundNode,networkDistance],path:discoveryPath} of turnarounds) {
    const paths=kShortestPaths(adjacency,startNode,turnaroundNode,pathsPerTurnaround,
      {maxDistanceMeters:targetOutbound+searchBand});
    const seeded=discoveryPath?[discoveryPath,...paths]:paths;
    const unique=[...new Map(seeded.map(path=>[
      JSON.stringify(path.edgeKeys?.length?path.edgeKeys:path.edges.map((edge,i)=>edge.edgeId??edge.wayId??`${path.nodes[i]}>${edge.to}`)),path
    ])).values()];
    const outboundAlternatives=selectCrossingAwarePaths(nodes,ways,unique,pathsPerTurnaround,0.55);
    const complete=[];
    for(const outboundPath of outboundAlternatives) {
      const assembled=buildDirectedOutAndBackCandidate(adjacency,nodes,outboundPath,{
        requestedDistanceMeters,
        distanceToleranceMeters:Math.max(minimumDistanceToleranceMeters,requestedDistanceMeters*distanceToleranceRatio)
      });
      if(!assembled.ok) continue;
      const inventory=buildRouteFeatureInventory(nodes,ways,outboundPath,assembled.returnPath);
      const acceptance=evaluateRouteAcceptance({
        requestedDistanceMeters,
        pathDistanceMeters:assembled.route.properties.totalDistanceMeters,
        originConnector,
        connections:[...inventory.connections,...inventory.crossings]
      },{distanceToleranceRatio,minimumDistanceToleranceMeters});
      complete.push({
        turnaroundNode,
        outboundPath,
        returnPath:assembled.returnPath,
        route:assembled.route,
        distance:assembled.distance,
        distanceErrorMeters:assembled.distance.errorMeters,
        featureInventory:inventory,
        acceptance,
        outboundRoadwayCrossingCount:outboundPath.detectedRoadwayCrossingCount??0,
        roundTripRoadwayCrossingCount:inventory.crossings.length
      });
    }
    const diverse=selectRoundTripCorridorDiversePaths(adjacency,complete,maxAlternatives,0.55);
    evaluated.push(...diverse.map(candidate=>({
      ...candidate,
      turnaround:{nodeId:turnaroundNode,networkDistanceMeters:networkDistance},
      status:candidate.acceptance.accepted?"accepted":"needs_field_review"
    })));
  }
  evaluated.sort((a,b)=>
    Number(b.acceptance.accepted)-Number(a.acceptance.accepted)||
    a.roundTripRoadwayCrossingCount-b.roundTripRoadwayCrossingCount||
    a.distance.errorMeters-b.distance.errorMeters);
  const selected=selectRoundTripCorridorDiversePaths(adjacency,evaluated,maxAlternatives,0.55);
  const routes=selected.map((candidate,index)=>({
    ...candidate,
    rank:index+1,
    // Geometry is returned only for candidates whose complete path passed
    // the evidence and distance acceptance gates.
    route:candidate.acceptance.accepted?candidate.route:null
  }));
  return {
    status:routes.some(route=>route.acceptance.accepted)?"routes_available":
      routes.length?"field_review_required":"no_complete_round_trip_found",
    requestedDistanceMeters,
    targetOutboundDistanceMeters:targetOutbound,
    toleranceMeters:Math.max(minimumDistanceToleranceMeters,requestedDistanceMeters*distanceToleranceRatio),
    candidateCount:evaluated.length,
    routes,
    diagnostics:{
      turnaroundsEvaluated:turnarounds.length,
      completeRoundTrips:evaluated.length,
      withheldForReview:evaluated.filter(candidate=>!candidate.acceptance.accepted).length
    }
  };
}

// Convenience adapter for distance input expressed in miles.
export function generateOutAndBackMiles(options={}) {
  if (!finitePositive(options.miles)) throw new RangeError("miles must be positive finite");
  return generateOutAndBackCandidates({...options,requestedDistanceMeters:options.miles*METERS_PER_MILE});
}
