// Pure OSM pedestrian graph primitives. No network or user-location access.
const EARTH_RADIUS_METERS = 6371008.8;
const radians = value => value * Math.PI / 180;

export function haversineMeters(a, b) {
  const p1 = radians(a.lat), p2 = radians(b.lat);
  const dp = radians(b.lat - a.lat), dl = radians(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Classify OSM ways conservatively. A positive foot-access tag on a
// carriageway does not turn its centerline into sidewalk geometry.
export function classifyPedestrianWay(tags = {}) {
  const highway = tags.highway;
  if (!highway) return {status:"excluded",reason:"missing_highway"};
  if (["proposed","construction","abandoned","raceway","bus_guideway",
       "motorway","motorway_link","trunk","trunk_link","parking_aisle"].includes(highway)) {
    return {status:"excluded",reason:"non_routable_highway_class"};
  }
  if (["no","private","customers","delivery","destination","agricultural",
       "forestry","restricted"].includes(tags.access) ||
      ["no","private"].includes(tags.foot)) {
    return {status:"excluded",reason:"restricted_access"};
  }
  if (["footway","path","pedestrian","steps"].includes(highway)) {
    return {status:"eligible",reason:"dedicated_pedestrian_geometry"};
  }
  if (highway==="cycleway" && ["yes","designated","permissive"].includes(tags.foot)) {
    return {status:"eligible",reason:"cycleway_with_explicit_foot_access"};
  }
  if (["service","residential","living_street","unclassified","tertiary",
       "secondary","primary","road"].includes(highway)) {
    if (tags.sidewalk && tags.sidewalk!=="no") {
      return {status:"needs_review",reason:"sidewalk_tag_without_sidewalk_geometry"};
    }
    if (["yes","designated","permissive"].includes(tags.foot)) {
      return {status:"needs_review",reason:"foot_access_on_carriageway_centerline"};
    }
    return {status:"excluded",reason:"roadway_centerline_not_sidewalk_geometry"};
  }
  if (tags.foot==="yes" || tags.foot==="designated" || tags.foot==="permissive") {
    return {status:"needs_review",reason:"explicit_foot_access_but_geometry_type_unclear"};
  }
  return {status:"excluded",reason:"not_a_supported_pedestrian_way"};
}

export function isEligiblePedestrianWay(tags = {}) {
  return classifyPedestrianWay(tags).status === "eligible";
}

export function pedestrianDirections(tags = {}) {
  return {
    forward: tags["foot:forward"] !== "no" && tags["oneway:foot"] !== "-1",
    backward: tags["foot:backward"] !== "no" && tags["oneway:foot"] !== "yes"
  };
}

// nodes: Map(id -> {id,lat,lon}); ways: [{id,nodes:[...],tags:{...}}]
export function buildDirectedPedestrianGraph(nodes, ways, maxEdgeMeters = 250) {
  const adjacency = new Map();
  const add = (from, to, meters, wayId, edgeId, tags = {}) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, meters, wayId, edgeId, tags: {...tags} });
  };
  for (const way of ways) {
    if (!isEligiblePedestrianWay(way.tags)) continue;
    const direction = pedestrianDirections(way.tags);
    for (let i = 1; i < way.nodes.length; i++) {
      const from = nodes.get(way.nodes[i - 1]), to = nodes.get(way.nodes[i]);
      if (!from || !to) continue;
      const meters = haversineMeters(from, to);
      if (!(meters > 0 && meters < maxEdgeMeters)) continue;
      if (direction.forward) add(from.id, to.id, meters, way.id, String(way.id)+":"+i+":f", way.tags);
      if (direction.backward) add(to.id, from.id, meters, way.id, String(way.id)+":"+i+":b", way.tags);
    }
  }
  return adjacency;
}

export function dijkstra(adjacency, start, maxDistanceMeters = Infinity) {
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const queue = [];
  const push = item => {
    queue.push(item);
    let index = queue.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (queue[parent][0] <= item[0]) break;
      queue[index] = queue[parent];
      index = parent;
    }
    queue[index] = item;
  };
  const pop = () => {
    if (!queue.length) return null;
    const root = queue[0], last = queue.pop();
    if (queue.length) {
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= queue.length) break;
        if (child + 1 < queue.length && queue[child + 1][0] < queue[child][0]) child++;
        if (queue[child][0] >= last[0]) break;
        queue[index] = queue[child];
        index = child;
      }
      queue[index] = last;
    }
    return root;
  };
  push([0, start]);
  while (queue.length) {
    const [cost, id] = pop();
    if (cost !== distances.get(id) || cost > maxDistanceMeters) continue;
    for (const edge of adjacency.get(id) || []) {
      const next = cost + edge.meters;
      if (next < (distances.get(edge.to) ?? Infinity) && next <= maxDistanceMeters) {
        distances.set(edge.to, next);
        previous.set(edge.to, id);
        push([next, edge.to]);
      }
    }
  }
  return { distances, previous };
}

export function reconstructNodePath(previous, start, end) {
  if (start === end) return [start];
  if (!previous.has(end)) return null;
  const path = [end];
  let current = end;
  while (current !== start) {
    current = previous.get(current);
    if (current === undefined) return null;
    path.push(current);
  }
  return path.reverse();
}


const directedEdgeKey = (from, to) => JSON.stringify([from, to]);
const graphEdgeKey = (from, edge, index=0) => edge.edgeId ?? JSON.stringify([from,edge.to,edge.wayId ?? null,edge.meters,index]);

function shortestPath(adjacency, start, end, options = {}) {
  const bannedNodes=options.bannedNodes||new Set(), bannedEdges=options.bannedEdges||new Set();
  const maxDistanceMeters=options.maxDistanceMeters??Infinity;
  if(bannedNodes.has(start)||bannedNodes.has(end))return null;
  const distances=new Map([[start,0]]), previous=new Map(), queue=[];
  const push=item=>{queue.push(item);let i=queue.length-1;while(i>0){const p=(i-1)>>1;if(queue[p][0]<=item[0])break;queue[i]=queue[p];i=p;}queue[i]=item;};
  const pop=()=>{if(!queue.length)return null;const root=queue[0],last=queue.pop();if(queue.length){let i=0;while(true){let ch=i*2+1;if(ch>=queue.length)break;if(ch+1<queue.length&&queue[ch+1][0]<queue[ch][0])ch++;if(queue[ch][0]>=last[0])break;queue[i]=queue[ch];i=ch;}queue[i]=last;}return root;};
  push([0,start]);
  while(queue.length){const [cost,node]=pop();if(cost!==distances.get(node)||cost>maxDistanceMeters)continue;if(node===end)break;
    const edges=adjacency.get(node)||[];
    for(let edgeIndex=0;edgeIndex<edges.length;edgeIndex++){const edge=edges[edgeIndex],key=graphEdgeKey(node,edge,edgeIndex);
      if(bannedNodes.has(edge.to)||bannedEdges.has(key))continue;
      const next=cost+edge.meters;if(next<(distances.get(edge.to)??Infinity)&&next<=maxDistanceMeters){distances.set(edge.to,next);previous.set(edge.to,{from:node,edge,key});push([next,edge.to]);}
    }
  }
  if(!distances.has(end))return null;
  const nodes=[end],edges=[],edgeKeys=[];let current=end;
  while(current!==start){const step=previous.get(current);if(!step)return null;edges.push(step.edge);edgeKeys.push(step.key);current=step.from;nodes.push(current);}
  nodes.reverse();edges.reverse();edgeKeys.reverse();
  return {nodes,edges,edgeKeys,distanceMeters:distances.get(end)};
}

function pathDistance(adjacency,path){if(Array.isArray(path.edges))return path.edges.reduce((sum,edge)=>sum+edge.meters,0);let total=0;for(let i=1;i<path.nodes.length;i++){const edge=(adjacency.get(path.nodes[i-1])||[]).find(item=>item.to===path.nodes[i]);if(!edge)return Infinity;total+=edge.meters;}return total;}

// Yen's loopless k-shortest paths. Results are ordered by network distance.
// This finds alternatives to one endpoint; it does not by itself prove that
// alternatives are sufficiently different for a useful user-facing choice.
export function kShortestPaths(adjacency, start, end, k = 3, options = {}) {
  if (!Number.isInteger(k) || k < 1 || k > 10) throw new RangeError("k must be an integer from 1 to 10");
  const first = shortestPath(adjacency, start, end, options);
  if (!first) return [];
  const accepted = [first];
  const candidates = new Map();
  const maxDistanceMeters = options.maxDistanceMeters ?? Infinity;

  for (let index = 1; index < k; index++) {
    const previousPath = accepted[index - 1];
    for (let spurIndex = 0; spurIndex < previousPath.nodes.length - 1; spurIndex++) {
      const root = previousPath.nodes.slice(0, spurIndex + 1);
      const spurNode = root[root.length - 1];
      const bannedEdges = new Set();
      for (const path of accepted) {
        if (path.nodes.length > spurIndex + 1 &&
            root.every((node, i) => path.nodes[i] === node)) {
          bannedEdges.add(path.edgeKeys?.[spurIndex] ?? directedEdgeKey(path.nodes[spurIndex], path.nodes[spurIndex + 1]));
        }
      }
      const bannedNodes = new Set(root.slice(0, -1));
      const spur = shortestPath(adjacency, spurNode, end, {
        bannedNodes, bannedEdges, maxDistanceMeters
      });
      if (!spur) continue;
      const combinedNodes = root.slice(0, -1).concat(spur.nodes);
      const combinedEdges = previousPath.edges.slice(0,spurIndex).concat(spur.edges);
      const combinedKeys = previousPath.edgeKeys.slice(0,spurIndex).concat(spur.edgeKeys);
      const key = JSON.stringify(combinedKeys);
      if (accepted.some(path => JSON.stringify(path.edgeKeys) === key) || candidates.has(key)) continue;
      const distanceMeters = pathDistance(adjacency, {nodes:combinedNodes,edges:combinedEdges});
      if (distanceMeters <= maxDistanceMeters) candidates.set(key, {nodes:combinedNodes,edges:combinedEdges,edgeKeys:combinedKeys,distanceMeters});
    }
    if (!candidates.size) break;
    const best = [...candidates.entries()].sort((a,b) =>
      a[1].distanceMeters - b[1].distanceMeters || a[0].localeCompare(b[0]))[0];
    accepted.push(best[1]);
    candidates.delete(best[0]);
  }
  return accepted;
}


// Directed-edge Jaccard overlap: 0 means no shared directed edges, 1 means identical.
export function directedPathOverlap(pathA, pathB) {
  const edges = path => new Set(path.slice(1).map((node,index) =>
    directedEdgeKey(path[index],node)));
  const a = edges(pathA), b = edges(pathB);
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const edge of a) if (b.has(edge)) shared++;
  return shared / (a.size + b.size - shared);
}

// Greedily retain short paths that add meaningful new directed-edge coverage.
// The first (shortest) path is always retained; later paths must meet the
// configured overlap ceiling against every already-selected path.
export function selectDiversePaths(paths, maxPaths = 3, maxOverlap = 0.65) {
  if (!Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > 10) {
    throw new RangeError("maxPaths must be an integer from 1 to 10");
  }
  if (!Number.isFinite(maxOverlap) || maxOverlap < 0 || maxOverlap > 1) {
    throw new RangeError("maxOverlap must be between 0 and 1");
  }
  const ordered = [...paths].sort((a,b) =>
    a.distanceMeters - b.distanceMeters ||
    JSON.stringify(a.nodes).localeCompare(JSON.stringify(b.nodes)));
  const selected = [];
  for (const candidate of ordered) {
    if (selected.every(existing =>
      directedPathOverlap(existing.nodes,candidate.nodes) <= maxOverlap)) {
      selected.push(candidate);
      if (selected.length >= maxPaths) break;
    }
  }
  return selected.map(path => ({
    ...path,
    maxOverlapWithSelected: selected.length === 1 ? 0 :
      Math.max(...selected.filter(other => other !== path)
        .map(other => directedPathOverlap(path.nodes,other.nodes)))
  }));
}


// Weighted Jaccard overlap by OSM way ID. This treats differently segmented
// edges on the same mapped way as one corridor. It is a corridor proxy:
// separate OSM ways can still describe the same physical street.
export function corridorPathOverlap(adjacency, pathA, pathB) {
  const weightsFor = input => {
    const path = Array.isArray(input) ? {nodes:input} : input;
    const weights = new Map();
    for (let i = 1; i < path.nodes.length; i++) {
      const edge = Array.isArray(path.edges) ? path.edges[i-1] :
        (adjacency.get(path.nodes[i - 1]) || []).filter(item => item.to === path.nodes[i])
          .sort((a,b) => a.meters - b.meters)[0];
      if (!edge) continue;
      const key = String(edge.wayId ?? directedEdgeKey(path.nodes[i - 1],path.nodes[i]));
      weights.set(key,(weights.get(key) || 0) + edge.meters);
    }
    return weights;
  };
  const a = weightsFor(pathA), b = weightsFor(pathB);
  const keys = new Set([...a.keys(),...b.keys()]);
  if (!keys.size) return 1;
  let intersection = 0, union = 0;
  for (const key of keys) {
    intersection += Math.min(a.get(key) || 0,b.get(key) || 0);
    union += Math.max(a.get(key) || 0,b.get(key) || 0);
  }
  return union ? intersection / union : 1;
}

export function selectCorridorDiversePaths(adjacency, paths, maxPaths = 3, maxOverlap = 0.55) {
  if (!Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > 10) {
    throw new RangeError("maxPaths must be an integer from 1 to 10");
  }
  if (!Number.isFinite(maxOverlap) || maxOverlap < 0 || maxOverlap > 1) {
    throw new RangeError("maxOverlap must be between 0 and 1");
  }
  const ordered = [...paths].sort((a,b) =>
    a.distanceMeters - b.distanceMeters ||
    JSON.stringify(a.nodes).localeCompare(JSON.stringify(b.nodes)));
  const selected = [];
  for (const candidate of ordered) {
    if (selected.every(existing =>
      corridorPathOverlap(adjacency,existing,candidate) <= maxOverlap)) {
      selected.push(candidate);
      if (selected.length >= maxPaths) break;
    }
  }
  return selected.map(path => ({
    ...path,
    maxCorridorOverlapWithSelected: selected.length === 1 ? 0 :
      Math.max(...selected.filter(other => other !== path)
        .map(other => corridorPathOverlap(adjacency,path,other)))
  }));
}


// Project a GPS point onto mapped pedestrian edge geometry using a local
// equirectangular plane. The result is a geometric snap candidate only;
// it does not prove that the straight GPS-to-edge connector is walkable.
export function projectPointToSegment(point, a, b) {
  const cosLat = Math.cos(radians(point.lat));
  const x = coord => radians(coord.lon - point.lon) * EARTH_RADIUS_METERS * cosLat;
  const y = coord => radians(coord.lat - point.lat) * EARTH_RADIUS_METERS;
  const ax=x(a), ay=y(a), bx=x(b), by=y(b);
  const dx=bx-ax, dy=by-ay, lengthSquared=dx*dx+dy*dy;
  const fraction=lengthSquared ? Math.max(0,Math.min(1,-(ax*dx+ay*dy)/lengthSquared)) : 0;
  const px=ax+fraction*dx, py=ay+fraction*dy;
  const projected={lat:point.lat+py/EARTH_RADIUS_METERS*180/Math.PI,
    lon:point.lon+px/(EARTH_RADIUS_METERS*cosLat)*180/Math.PI};
  return {fraction,point:projected,offsetMeters:Math.hypot(px,py)};
}

// Finds the closest directed graph edge. Direction is preserved in the
// returned edge descriptor; callers must still validate an actual connector.
export function findNearestPedestrianEdge(nodes, adjacency, origin, maxSnapMeters=60) {
  if (!Number.isFinite(maxSnapMeters) || maxSnapMeters < 0) {
    throw new RangeError("maxSnapMeters must be a non-negative finite number");
  }
  let best=null;
  for (const [from,edges] of adjacency) {
    const a=nodes.get(from);
    if (!a) continue;
    for (let edgeIndex=0; edgeIndex<edges.length; edgeIndex++) {
      const edge=edges[edgeIndex];
      const b=nodes.get(edge.to);
      if (!b) continue;
      const projection=projectPointToSegment(origin,a,b);
      if (!best || projection.offsetMeters < best.offsetMeters) {
        best={from,to:edge.to,wayId:edge.wayId,meters:edge.meters,edgeIndex,
          fraction:projection.fraction,point:projection.point,
          offsetMeters:projection.offsetMeters};
      }
    }
  }
  if (!best || best.offsetMeters > maxSnapMeters) return null;
  return best;
}

// Split only the selected mapped segment at a virtual point. Existing
// directed arcs are replaced with direction-preserving sub-arcs; no new
// reverse direction is invented. Edge metadata (including wayId) is retained.
export function splitPedestrianEdgeAtProjection(adjacency, projection, virtualNodeId) {
  if (!projection || projection.from === undefined || projection.to === undefined ||
      !Number.isFinite(projection.fraction) || projection.fraction <= 0 ||
      projection.fraction >= 1 || virtualNodeId === undefined) {
    throw new TypeError("A valid interior edge projection and virtual node ID are required");
  }
  const next=new Map();
  for (const [from,edges] of adjacency) {
    next.set(from,edges.map(edge=>({...edge})));
  }
  next.set(virtualNodeId,[]);
  const forward=(next.get(projection.from)||[]);
  const index=Number.isInteger(projection.edgeIndex) ? projection.edgeIndex :
    forward.findIndex(edge=>edge.to===projection.to && edge.wayId===projection.wayId && (projection.meters===undefined || edge.meters===projection.meters));
  if (index < 0 || !forward[index] || forward[index].to!==projection.to ||
      forward[index].wayId!==projection.wayId || (projection.meters!==undefined && forward[index].meters!==projection.meters)) {
    throw new Error("Projected directed edge no longer exists in graph");
  }
  const edge=forward[index];
  forward.splice(index,1);
  const firstMeters=edge.meters*projection.fraction;
  const secondMeters=edge.meters-firstMeters;
  forward.push({...edge,to:virtualNodeId,meters:firstMeters,...(edge.edgeId ? {edgeId:edge.edgeId+":a"} : {})});
  next.get(virtualNodeId).push({...edge,to:projection.to,meters:secondMeters,...(edge.edgeId ? {edgeId:edge.edgeId+":b"} : {})});

  // If the exact reverse arc exists, split it too, but preserve its own
  // direction. One-way pedestrian edges remain one-way.
  const reverse=(next.get(projection.to)||[]);
  const reverseMatches=reverse.map((item,index)=>({item,index})).filter(({item})=>
    item.to===projection.from && item.wayId===projection.wayId && item.meters===edge.meters);
  // If parallel reverse arcs are indistinguishable, do not guess which one
  // corresponds to the projected segment; leave reverse travel disconnected.
  const reverseIndex=reverseMatches.length===1 ? reverseMatches[0].index : -1;
  if (reverseIndex >= 0) {
    const reverseEdge=reverse[reverseIndex];
    reverse.splice(reverseIndex,1);
    reverse.push({...reverseEdge,to:virtualNodeId,meters:reverseEdge.meters*(1-projection.fraction),...(reverseEdge.edgeId ? {edgeId:reverseEdge.edgeId+":a"} : {})});
    next.get(virtualNodeId).push({...reverseEdge,to:projection.from,meters:reverseEdge.meters*projection.fraction,...(reverseEdge.edgeId ? {edgeId:reverseEdge.edgeId+":b"} : {})});
  }
  return next;
}


// Attach a private GPS origin to a directed pedestrian graph for diagnostics.
// Endpoint snaps are accepted only when the resulting node has an outgoing
// pedestrian edge. Interior snaps split the exact directed edge. This remains
// a geometric snap only: connectorStatus is always unverified.
export function snapOriginToPedestrianGraph(nodes, adjacency, origin, maxSnapMeters=60,
  virtualNodeId="__stepx_private_origin_snap__") {
  if (nodes.has(virtualNodeId) || adjacency.has(virtualNodeId)) {
    throw new Error("Virtual origin node ID already exists");
  }
  const projection=findNearestPedestrianEdge(nodes,adjacency,origin,maxSnapMeters);
  if (!projection) return {ok:false,reason:"no_eligible_edge_within_snap_limit"};
  let graph=adjacency, startNode;
  if (projection.fraction <= 0.000001) {
    startNode=projection.from;
  } else if (projection.fraction >= 0.999999) {
    startNode=projection.to;
  } else {
    startNode=virtualNodeId;
    graph=splitPedestrianEdgeAtProjection(adjacency,projection,virtualNodeId);
  }
  if (!(graph.get(startNode)||[]).length) {
    return {ok:false,reason:"snapped_node_has_no_outgoing_pedestrian_edge",
      projection:{from:projection.from,to:projection.to,wayId:projection.wayId,
        fraction:projection.fraction,offsetMeters:projection.offsetMeters}};
  }
  return {ok:true,graph,startNode,connectorStatus:"unverified",
    projection:{from:projection.from,to:projection.to,wayId:projection.wayId,
      fraction:projection.fraction,offsetMeters:projection.offsetMeters,
      isVirtual:startNode===virtualNodeId},
    virtualNode:startNode===virtualNodeId ? {id:virtualNodeId,...projection.point} : null};
}


// Return explicit crossing evidence at an OSM node. This is evidence metadata,
// not a judgment that a crossing is safe, accessible, or legally usable.
export function pedestrianCrossingEvidence(nodeTags = {}) {
  const signals = nodeTags.crossing === "traffic_signals" ||
    nodeTags["crossing:signals"] === "yes";
  // A highway=traffic_signals node alone maps signal control, not necessarily
  // a pedestrian crossing. Preserve that distinction instead of inferring one.
  const signalNodeOnly = nodeTags.highway === "traffic_signals" &&
    nodeTags.crossing === undefined && nodeTags["crossing:markings"] === undefined;
  const crossingMapped = nodeTags.highway === "crossing" ||
    nodeTags.crossing !== undefined || nodeTags["crossing:markings"] !== undefined;
  if (!crossingMapped) {
    return {mapped:false,type:"unknown",controlled:false,
      signals:signals || signalNodeOnly};
  }
  const type = nodeTags.crossing || nodeTags["crossing:markings"] ||
    (nodeTags.highway === "crossing" ? "crossing" : "unknown");
  const controlled = signals ||
    ["marked","zebra","pelican","puffin","toucan","traffic_signals","yes"].includes(type);
  return {mapped:true,type,controlled,signals};
}

// Summarize mapped crossing evidence for a graph node without treating an
// untagged intersection as a crossing.
export function crossingEvidenceForNode(nodes, nodeId) {
  const node = nodes.get(nodeId);
  return pedestrianCrossingEvidence(node?.tags || {});
}
 
// Detect geometric intersections between a candidate pedestrian path and
// mapped roadway centerlines. This identifies places where the selected
// geometry appears to cross a road; it does not establish a legal/safe crossing.
const ROADWAY_HIGHWAYS=new Set([
 "motorway","motorway_link","trunk","trunk_link","primary","primary_link",
 "secondary","secondary_link","tertiary","tertiary_link","unclassified",
 "residential","living_street","service","road"
]);
function localXY(point,originLat,originLon) {
 const cos=Math.cos(radians(originLat));
 return {x:radians(point.lon-originLon)*EARTH_RADIUS_METERS*cos,
         y:radians(point.lat-originLat)*EARTH_RADIUS_METERS};
}
function segmentIntersection(a,b,c,d,epsilon=1e-7) {
 const rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y;
 const cross=rx*sy-ry*sx;
 if(Math.abs(cross)<epsilon)return null;
 const qx=c.x-a.x,qy=c.y-a.y;
 const t=(qx*sy-qy*sx)/cross,u=(qx*ry-qy*rx)/cross;
 if(t < -epsilon || t > 1+epsilon || u < -epsilon || u > 1+epsilon)return null;
 return {t:Math.max(0,Math.min(1,t)),u:Math.max(0,Math.min(1,u))};
}
function segmentAngleDegrees(a,b,c,d) {
 const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y;
 const denom=Math.hypot(ux,uy)*Math.hypot(vx,vy);
 if(!denom)return 0;
 const cosine=Math.max(-1,Math.min(1,Math.abs((ux*vx+uy*vy)/denom)));
 return Math.acos(cosine)*180/Math.PI;
}
// Prefer paths with fewer mapped roadway-centerline intersections, then
// shorter distance, while preserving a corridor-diversity ceiling. This is a
// crossing-count heuristic, not a safety score or guarantee of a safe route.
// Build a GeoJSON LineString for a complete out-and-back only when both
// directed legs are supplied and connect at the same turnaround and origin.
// The helper measures the actual supplied geometry; it does not claim exact
// requested-distance compliance or validate field safety/access.
export function buildOutAndBackRoute(nodes,outboundPath,returnPath) {
 const validPath=p=>p&&Array.isArray(p.nodes)&&p.nodes.length>=2;
 if(!(nodes instanceof Map)||!validPath(outboundPath)||!validPath(returnPath))
  throw new TypeError("Node coordinates and two non-empty directed paths are required");
 const outboundStart=outboundPath.nodes[0],turnaround=outboundPath.nodes.at(-1);
 if(returnPath.nodes[0]!==turnaround||returnPath.nodes.at(-1)!==outboundStart)
  throw new Error("Return path must connect the outbound turnaround to the original start");
 const sequence=outboundPath.nodes.concat(returnPath.nodes.slice(1));
 const coordinates=sequence.map(id=>{
  const n=nodes.get(id);
  if(!n||!Number.isFinite(n.lon)||!Number.isFinite(n.lat)||Math.abs(n.lon)>180||Math.abs(n.lat)>90)
   throw new Error("Route contains a missing or invalid coordinate");
  return [n.lon,n.lat];
 });
 let distanceMeters=0;
 for(let i=1;i<sequence.length;i++)distanceMeters+=haversineMeters(nodes.get(sequence[i-1]),nodes.get(sequence[i]));
 return {
  type:"Feature",
  properties:{routeType:"out_and_back",outboundNodeCount:outboundPath.nodes.length,
   returnNodeCount:returnPath.nodes.length,totalNodeCount:sequence.length,
   outboundDistanceMeters:+outboundPath.nodes.slice(1).reduce((sum,id,i)=>
    sum+haversineMeters(nodes.get(outboundPath.nodes[i]),nodes.get(id)),0).toFixed(2),
   returnDistanceMeters:+returnPath.nodes.slice(1).reduce((sum,id,i)=>
    sum+haversineMeters(nodes.get(returnPath.nodes[i]),nodes.get(id)),0).toFixed(2),
   totalDistanceMeters:+distanceMeters.toFixed(2)},
  geometry:{type:"LineString",coordinates}
 };
}

// Build a complete out-and-back candidate by independently routing the return
// leg over directed pedestrian arcs. A reverse of the outbound path is never
// assumed: one-way foot restrictions remain in force.
export function buildDirectedOutAndBackCandidate(adjacency,nodes,outboundPath,options={}) {
 if(!(adjacency instanceof Map)||!(nodes instanceof Map)||
    !outboundPath||!Array.isArray(outboundPath.nodes)||outboundPath.nodes.length<2)
  throw new TypeError("Directed graph, node coordinates, and outbound path are required");
 const origin=outboundPath.nodes[0],turnaround=outboundPath.nodes.at(-1);
 const maxReturnDistanceMeters=options.maxReturnDistanceMeters??Infinity;
 if(!(maxReturnDistanceMeters>0))throw new RangeError("Return distance limit must be positive");
 const returnPath=shortestPath(adjacency,turnaround,origin,{maxDistanceMeters:maxReturnDistanceMeters});
 if(!returnPath)return {ok:false,reason:"no_directed_return_path",originNode:origin,turnaroundNode:turnaround};
 const route=buildOutAndBackRoute(nodes,outboundPath,returnPath);
 const requestedDistanceMeters=options.requestedDistanceMeters;
 const toleranceMeters=options.distanceToleranceMeters??15;
 if(requestedDistanceMeters!==undefined&&(!Number.isFinite(requestedDistanceMeters)||requestedDistanceMeters<=0))
  throw new RangeError("Requested route distance must be positive and finite");
 if(!Number.isFinite(toleranceMeters)||toleranceMeters<0)throw new RangeError("Distance tolerance must be non-negative");
 const errorMeters=requestedDistanceMeters===undefined?null:
  Math.abs(route.properties.totalDistanceMeters-requestedDistanceMeters);
 return {ok:true,route,returnPath,
  distance:{outboundMeters:+outboundPath.distanceMeters.toFixed(2),
   returnMeters:+returnPath.distanceMeters.toFixed(2),
   totalMeters:route.properties.totalDistanceMeters,
   requestedMeters:requestedDistanceMeters??null,errorMeters,
   toleranceMeters:requestedDistanceMeters===undefined?null:toleranceMeters,
   withinTolerance:requestedDistanceMeters===undefined?null:errorMeters<=toleranceMeters},
  limitations:["Return leg is independently searched over directed mapped pedestrian edges.",
   "A valid graph return does not verify the GPS-origin connector, public access, crossings, accessibility, or real-world safety.",
   "Distance tolerance is measured on mapped graph edge lengths; it does not authorize arbitrary off-network trimming."]};
}

export function selectCrossingAwarePaths(nodes,ways,paths,maxPaths=3,maxCorridorOverlap=0.55,options={}) {
 if(!Number.isInteger(maxPaths)||maxPaths<1||maxPaths>10)throw new RangeError("maxPaths must be 1–10");
 if(!Number.isFinite(maxCorridorOverlap)||maxCorridorOverlap<0||maxCorridorOverlap>1)throw new RangeError("maxCorridorOverlap must be 0–1");
 const scored=paths.map(path=>({...path,
  crossingAssessment:detectRoadwayCrossingsForPath(nodes,ways,path,options)}))
 .sort((a,b)=>a.crossingAssessment.crossingCount-b.crossingAssessment.crossingCount||
  a.distanceMeters-b.distanceMeters||
  JSON.stringify(a.nodes).localeCompare(JSON.stringify(b.nodes)));
 const selected=[];
 for(const candidate of scored){
  if(selected.every(existing=>corridorPathOverlap(new Map(),existing,candidate)<=maxCorridorOverlap)){
   selected.push(candidate);
   if(selected.length>=maxPaths)break;
  }
 }
 return selected.map(path=>({...path,
  detectedRoadwayCrossingCount:path.crossingAssessment.crossingCount,
  crossingGeometry:path.crossingAssessment.crossings,
  maxCorridorOverlapWithSelected:selected.length===1?0:
   Math.max(...selected.filter(other=>other!==path).map(other=>corridorPathOverlap(new Map(),path,other)))
 }));
}

export function detectRoadwayCrossingsForPath(nodes,ways,path,options={}) {
 const nodeIds=Array.isArray(path)?path:path?.nodes;
 if(!Array.isArray(nodeIds)||nodeIds.length<2)throw new TypeError("Path must contain at least two node IDs");
 if(!(nodes instanceof Map)||!Array.isArray(ways))throw new TypeError("Node map and OSM ways are required");
 const minAngle=options.minimumCrossingAngleDegrees??25;
 const dedupeMeters=options.dedupeDistanceMeters??8;
 if(!Number.isFinite(minAngle)||minAngle<0||minAngle>90||!Number.isFinite(dedupeMeters)||dedupeMeters<0)throw new RangeError("Invalid crossing geometry thresholds");
 const crossings=[];
 for(let i=1;i<nodeIds.length;i++){
  const from=nodes.get(nodeIds[i-1]),to=nodes.get(nodeIds[i]);
  if(!from||!to)continue;
  const originLat=(from.lat+to.lat)/2,originLon=(from.lon+to.lon)/2;
  const a=localXY(from,originLat,originLon),b=localXY(to,originLat,originLon);
  for(const way of ways){
   const highway=way.tags?.highway;
   if(!ROADWAY_HIGHWAYS.has(highway)||way.tags?.access==="no"||way.tags?.access==="private")continue;
   for(let j=1;j<(way.nodes||[]).length;j++){
    const roadA=nodes.get(way.nodes[j-1]),roadB=nodes.get(way.nodes[j]);
    if(!roadA||!roadB)continue;
    const c=localXY(roadA,originLat,originLon),d=localXY(roadB,originLat,originLon);
    const hit=segmentIntersection(a,b,c,d);
    if(!hit)continue;
    const angle=segmentAngleDegrees(a,b,c,d);
    if(angle<minAngle)continue;
    const point={x:a.x+(b.x-a.x)*hit.t,y:a.y+(b.y-a.y)*hit.t};
    const duplicate=crossings.find(item=>item.wayId===way.id&&
      Math.hypot(item._x-point.x,item._y-point.y)<=dedupeMeters);
    if(duplicate)continue;
    crossings.push({wayId:way.id,roadClass:highway,pathSegmentIndex:i-1,
      roadSegmentIndex:j-1,intersectionAngleDegrees:+angle.toFixed(1),
      pathFraction:+hit.t.toFixed(4),roadFraction:+hit.u.toFixed(4),
      mappedCrossingEvidence:pedestrianCrossingEvidence(
       (nodes.get(nodeIds[i-1])?.tags?.crossing||nodes.get(nodeIds[i])?.tags?.crossing)
        ? {crossing:nodes.get(nodeIds[i-1])?.tags?.crossing||nodes.get(nodeIds[i])?.tags?.crossing}
        : {}).mapped,
      _x:point.x,_y:point.y});
   }
  }
 }
 const publicCrossings=crossings.map(({_x,_y,...item})=>item);
 return {status:publicCrossings.length?"crossing_geometry_detected":"no_roadway_intersection_detected",
  crossingCount:publicCrossings.length,crossings:publicCrossings,
  limitations:[
   "This is a planar intersection heuristic over mapped OSM way segments, not a legal-crossing or safety determination.",
   "Road centerlines may be offset from the actual carriageway; complex junctions, grade separation, bridges, tunnels, and incomplete OSM geometry can cause false positives or negatives.",
   "A detected intersection requires crossing evidence review and current field verification before route acceptance.",
   "No detected intersection does not prove that the route avoids every roadway crossing."
  ]};
}


 // Feature-level inventory for the complete out-and-back geometry. Connections
 // are grouped by OSM way; geometric road intersections are distinct crossings.
 export function buildRouteFeatureInventory(nodes,ways,outboundPath,returnPath,options={}) {
  const valid=p=>p&&Array.isArray(p.nodes)&&Array.isArray(p.edges)&&p.edges.length===p.nodes.length-1;
  if(!(nodes instanceof Map)||!Array.isArray(ways)||!valid(outboundPath)||!valid(returnPath))
   throw new TypeError("Node map, OSM ways, and complete directed outbound/return paths are required");
  const origin=outboundPath.nodes[0],turnaround=outboundPath.nodes.at(-1);
  if(returnPath.nodes[0]!==turnaround||returnPath.nodes.at(-1)!==origin)
   throw new Error("Route legs do not form a complete out-and-back");
  const routeNodes=outboundPath.nodes.concat(returnPath.nodes.slice(1));
  const routeEdges=outboundPath.edges.concat(returnPath.edges),connections=new Map();
  for(let i=0;i<routeEdges.length;i++){
   const edge=routeEdges[i],wayId=edge.wayId;
   if(wayId===undefined||wayId===null)continue;
   const id="connection:osm-way:"+String(wayId);
   if(!connections.has(id))connections.set(id,{id,featureType:"connection",status:"unverified",
    crossingRequired:false,routeSegmentIndexes:[],osmWayId:wayId});
   connections.get(id).routeSegmentIndexes.push(i);
  }
  const assessment=detectRoadwayCrossingsForPath(nodes,ways,{nodes:routeNodes},options);
  const crossings=assessment.crossings.map(c=>{
   const id="crossing:osm-way:"+String(c.wayId)+":route-segment:"+c.pathSegmentIndex;
   const a=nodes.get(routeNodes[c.pathSegmentIndex])?.tags||{},b=nodes.get(routeNodes[c.pathSegmentIndex+1])?.tags||{};
   const ae=pedestrianCrossingEvidence(a),be=pedestrianCrossingEvidence(b);
   const road=ways.find(w=>w.id===c.wayId),roadTags=road?.tags||{};
   const mapped=ae.mapped||be.mapped;
   const controlled=ae.controlled||be.controlled||roadTags.crossing==="traffic_signals"||
    roadTags["crossing:signals"]==="yes";
   return {id,featureType:"crossing",status:"unverified",crossingRequired:true,
    crossingEvidence:{mapped,controlled},
    osmWayId:c.wayId,roadClass:c.roadClass,routeSegmentIndex:c.pathSegmentIndex,
    intersectionAngleDegrees:c.intersectionAngleDegrees};
  });
  const mappedNodeCrossings=[];
  for(let i=0;i<routeNodes.length;i++){
   const e=pedestrianCrossingEvidence(nodes.get(routeNodes[i])?.tags||{});
   if(e.mapped)mappedNodeCrossings.push({nodeId:routeNodes[i],routeNodeIndex:i,type:e.type});
  }
  return {connections:[...connections.values()],crossings,mappedNodeCrossings,
   routeNodeCount:routeNodes.length,routeEdgeCount:routeEdges.length,
   crossingGeometryStatus:assessment.status,
   limitations:[...assessment.limitations,
    "Connections are grouped by OSM way and require current field verification.",
    "Mapped crossing tags are reported separately and are not assumed to match each geometric road intersection."]};
 }

// Report only mapped crossing evidence encountered by a supplied graph path.
// This does not decide whether a roadway crossing is required or safe.
export function inspectPathCrossingEvidence(nodes, path) {
  const nodeIds = Array.isArray(path) ? path : path?.nodes;
  if (!Array.isArray(nodeIds) || nodeIds.length < 1) {
    throw new TypeError("A non-empty path node sequence is required");
  }
  const observations = [];
  let unknownNodeCount = 0, signalOnlyNodeCount = 0;
  for (const nodeId of nodeIds) {
    const tags = nodes.get(nodeId)?.tags || {};
    const evidence = pedestrianCrossingEvidence(tags);
    if (evidence.mapped) observations.push({nodeId, ...evidence});
    else {
      unknownNodeCount++;
      if (evidence.signals) signalOnlyNodeCount++;
    }
  }
  const pathEdges = Array.isArray(path?.edges) ? path.edges : [];
  const crossingWayEdges = pathEdges.filter(edge =>
    edge?.tags?.highway === "crossing" || edge?.tags?.footway === "crossing"
  ).map(edge => ({
    wayId: edge.wayId ?? null,
    type: edge.tags?.crossing || edge.tags?.highway || edge.tags?.footway || "crossing"
  }));
  return {
    nodeCount: nodeIds.length,
    mappedCrossingNodeCount: observations.length,
    unknownNodeCount,
    signalOnlyNodeCount,
    crossingWayEdgeCount: crossingWayEdges.length,
    observations,
    crossingWayEdges,
    limitations: [
      "Only explicit OSM crossing tags are reported; an untagged node is unknown, not proof that no crossing exists.",
      "Signal-only nodes are not classified as pedestrian crossings without crossing-specific tags.",
      "This inspection does not infer whether a roadway crossing is required and does not establish legality, accessibility, signal operation, or safety."
    ]
  };
}



// Structural audit only: identify isolated nodes, terminal ends, and junctions
// where crossing evidence is absent. It does not infer that a crossing is
// required or safe; callers must inspect geometry and street context.
export function auditPedestrianConnectivity(nodes, adjacency, startNode = undefined) {
  const incident = new Map();
  const incomingCounts = new Map();
  let crossingTaggedEdges=0;
  const add = (id, neighbor, edge) => {
    if (!incident.has(id)) incident.set(id,new Map());
    const neighbors=incident.get(id);
    if (!neighbors.has(neighbor)) neighbors.set(neighbor,new Set());
    neighbors.get(neighbor).add(String(edge.wayId ?? "unknown"));
  };
  for (const id of nodes.keys()) incident.set(id,new Map());
  for (const [from,edges] of adjacency) {
    for (const edge of edges) {
      if (edge.tags?.highway==="crossing" || edge.tags?.footway==="crossing") crossingTaggedEdges++;
      add(from,edge.to,edge);
      add(edge.to,from,edge);
      incomingCounts.set(edge.to,(incomingCounts.get(edge.to)||0)+1);
    }
  }
  // Weak components reveal disconnected mapped islands; directed reachability
  // separately reveals nodes that cannot be reached from the selected origin.
  const visited=new Set(), components=[];
  for (const id of nodes.keys()) {
    if (visited.has(id)) continue;
    const queue=[id], members=[];
    visited.add(id);
    while(queue.length) {
      const current=queue.shift(); members.push(current);
      for(const neighbor of (incident.get(current)||new Map()).keys()) {
        if(!visited.has(neighbor)) {visited.add(neighbor);queue.push(neighbor);}
      }
    }
    components.push({componentId:components.length+1,nodeCount:members.length,
      nodeIds:members});
  }
  let reachableFromStart=null, unreachableFromStart=[];
  if(startNode!==undefined) {
    const reachable=new Set([startNode]), queue=[startNode];
    while(queue.length) {
      const current=queue.shift();
      for(const edge of adjacency.get(current)||[]) {
        if(!reachable.has(edge.to)) {reachable.add(edge.to);queue.push(edge.to);}
      }
    }
    reachableFromStart=reachable.size;
    unreachableFromStart=[...nodes.keys()].filter(id=>!reachable.has(id));
  }
  const isolated=[], terminals=[], junctions=[];
  for (const [id,node] of nodes) {
    const neighbors=incident.get(id);
    const degree=neighbors?.size || 0;
    const incoming=incomingCounts.get(id)||0;
    const outgoing=(adjacency.get(id)||[]).length;
    const evidence=pedestrianCrossingEvidence(node.tags||{});
    const item={nodeId:id,degree,incoming,outgoing,wayCount:new Set(
      [...(neighbors?.values()||[])].flatMap(set=>[...set])).size,
      crossingMapped:evidence.mapped,crossingType:evidence.type};
    if (degree===0) isolated.push(item);
    else if (degree===1) terminals.push(item);
    else if (degree>=3) junctions.push({...item,crossingEvidence:evidence});
  }
  return {nodeCount:nodes.size,connectedNodeCount:incident.size,
    componentCount:components.length,components,
    ...(startNode!==undefined?{startNode,reachableFromStart,unreachableFromStart}:{}),
    crossingTaggedEdges,isolated,terminals,junctions,
    junctionsWithoutMappedCrossing:junctions.filter(item=>!item.crossingMapped)};
}