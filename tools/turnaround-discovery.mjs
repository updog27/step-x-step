import {kShortestPaths,corridorPathOverlap} from "./pedestrian-graph.mjs";

/**
 * Discover turnarounds near a target distance, including prefixes of
 * alternative paths to a bounded set of near-target shortest-tree anchors.
 * Returned path objects retain exact directed edges for downstream routing.
 */
export function discoverTurnaroundCandidates(adjacency,start,candidatePool,target,searchBandMeters,options={}) {
  const maxAnchors=options.maxAnchors ?? 8;
  const pathsPerAnchor=options.pathsPerAnchor ?? 3;
  const maxTurnarounds=options.maxTurnarounds ?? 24;
  const maxOverlap=options.maxOverlap ?? 0.75;
  if (!Number.isFinite(target)||target<=0||!Number.isFinite(searchBandMeters)||searchBandMeters<=0)
    throw new RangeError("target and searchBandMeters must be positive finite numbers");
  if (!Number.isInteger(maxAnchors)||maxAnchors<0||!Number.isInteger(pathsPerAnchor)||pathsPerAnchor<1||
      !Number.isInteger(maxTurnarounds)||maxTurnarounds<1||!Number.isFinite(maxOverlap)||maxOverlap<0||maxOverlap>1)
    throw new RangeError("invalid turnaround discovery options");

  const turnaroundById=new Map(candidatePool.map(([id,meters])=>[id,{id,meters,path:null}]));
  for (const [anchorId] of candidatePool.slice(0,maxAnchors)) {
    const anchorPaths=kShortestPaths(adjacency,start,anchorId,pathsPerAnchor,
      {maxDistanceMeters:target+searchBandMeters});
    for (const path of anchorPaths) {
      let cumulativeMeters=0;
      for (let index=1;index<path.nodes.length;index++) {
        cumulativeMeters+=path.edges[index-1].meters;
        if (Math.abs(cumulativeMeters-target)>searchBandMeters) continue;
        const id=path.nodes[index];
        if (id===start) continue;
        const existing=turnaroundById.get(id);
        if (!existing||cumulativeMeters<existing.meters) {
          turnaroundById.set(id,{id,meters:cumulativeMeters,path:{
            nodes:path.nodes.slice(0,index+1),
            edges:path.edges.slice(0,index),
            edgeKeys:path.edgeKeys?.slice(0,index) ?? [],
            distanceMeters:cumulativeMeters
          }});
        }
      }
    }
  }
  const expandedPool=[...turnaroundById.values()].sort((a,b)=>
    Math.abs(a.meters-target)-Math.abs(b.meters-target)||String(a.id).localeCompare(String(b.id)));
  const selected=[];
  for (const candidate of expandedPool) {
    const candidatePath=candidate.path||kShortestPaths(adjacency,start,candidate.id,1,
      {maxDistanceMeters:candidate.meters+0.01})[0];
    if (!candidatePath) continue;
    if (selected.every(existing=>corridorPathOverlap(adjacency,existing.path,candidatePath)<=maxOverlap))
      selected.push({candidate:[candidate.id,candidate.meters],path:candidatePath});
    if (selected.length>=maxTurnarounds) break;
  }
  return selected;
}
