# Step x Step — Pedestrian Network Prototype

## Purpose
Build and validate a route-generation prototype independently of the current Netlify/ORS implementation. Do not merge into production until the acceptance tests pass.

## Current system baseline
The repository has multiple materially different branches, and the Netlify production deployment branch has not yet been confirmed. The `main` branch is the basic GPS tracker and does not contain the route-generation function. The `route-generation-work` branch contains the current route-generation implementation reviewed for this prototype: a Netlify Function calls the HeiGIT-hosted OpenRouteService foot-walking endpoint and Overpass map-data screening. Its out-and-back candidate logic still uses eight compass bearings, calculates geographic endpoints, adds offset waypoints for diagonal alternatives, trims the returned route geometry at half the requested distance, and reverses that trimmed geometry. Later commits also added directional-detour filtering and a specific corridor experiment, but the underlying endpoint-and-trim approach remains. This can produce a near-exact length while selecting a poor or invalid turnaround location. The client sends the device's live latitude/longitude, requested distance in meters, and route type to `/.netlify/functions/routes`; free-run bypasses the route function. Do not assume this branch is deployed at the public Netlify URL until the site's deploy metadata is confirmed.

## Proposed prototype architecture
1. **OSM pedestrian graph extraction** — retrieve pedestrian-relevant ways and nodes for a bounded test area. Preserve way geometry, node connectivity, tags, access restrictions, crossings, and sidewalk-side metadata. Separately mapped sidewalks must remain separate graph edges; never infer that a route on one side of a road is supported by a sidewalk on the other side.
2. **Graph construction and validation** — build connected pedestrian edges with explicit edge classifications and provenance. Treat unknown access and unknown sidewalk status as unknown, not as proof of public access or proof of a sidewalk.
3. **Candidate turnaround generation** — enumerate eligible graph nodes and points along eligible pedestrian edges reachable from the snapped start within the outbound target distance. Exclude candidates inside mapped parking, private/restricted access, and mapped commercial/industrial land-use polygons. Where parcel boundaries are unavailable, record that property exclusion is based only on OSM land-use/access tags and is not a legal-access guarantee.
4. **Network-distance routing** — calculate outbound network paths to candidates using Valhalla pedestrian costing first. Compare a small controlled sample against GraphHopper and the existing ORS output. Record route geometry, distance, edge tags, engine, and snap locations.
5. **Exact out-and-back construction** — select a valid outbound path no longer than half the target; return by reversing the exact same geometry. Do not trim a path at an arbitrary point unless that point lies on a verified eligible pedestrian edge and passes all spatial exclusions.
6. **Alternative selection** — select up to three distinct candidates based on route overlap, direction/coverage, and quality score. Return fewer than three when fewer than three candidates pass; never fabricate alternatives.
7. **Independent validation** — apply hard checks before returning a route. Distance tolerance, turnaround eligibility, restricted-access intersection, parking/property intersection, graph connectivity, and route distinctness are measurable pass/fail tests.

## Test area and known ground truth
Use the previously discussed Tampa test area around W Palmetto St, N Grady Ave, N Harold Ave, and W Columbus Dr. The user has confirmed that prior app tests started at their home on W Palmetto St and supplied the precise test coordinates in chat. Treat these coordinates as private test input: do not store them in this repository, public logs, or test reports. Supply them at runtime through environment variables or a local, untracked test fixture before evaluating route distances. The user has specifically confirmed a sidewalk on the east side of N Grady Ave and no sidewalk on its west side. This is a field observation and must be treated as ground truth for that segment even if OSM data is missing or incorrectly tagged.

## Acceptance criteria
- Out-and-back total distance is at or below the requested distance and within 0.05 mi of target.
- Outbound distance is within 0.025 mi of half the requested distance where network geometry permits; otherwise report no valid route rather than fabricate a turnaround.
- Return path exactly retraces outbound geometry.
- No route uses a mapped private driveway, parking aisle, parking interior, or restricted-access edge.
- No route enters a mapped commercial/industrial property polygon unless a verified public pedestrian easement/path is explicitly represented in the pedestrian graph and the user approves that policy. Default is reject.
- N Grady Ave test segment must use the east-side sidewalk; a west-side route is a failure.
- No unsupported inference from nearby sidewalk proximity to the opposite side of a road.
- Up to three meaningfully distinct alternatives; fewer are acceptable if only fewer pass.
- Log every rejection reason and source tag for reproducible debugging.

## Engine evaluation
### Valhalla — first prototype candidate
Test pedestrian costing, walkway/sidewalk factors, exclude polygons, route shape output, and snapping behavior. Valhalla is a routing engine, not a substitute for our candidate-turnaround and validation logic.
### GraphHopper — comparator
Evaluate pedestrian/foot profile availability, custom model controls, map matching/snapping, alternative route behavior, and hosted/self-hosted costs.
### Existing ORS — baseline comparator
Keep the current provider only as a baseline during the experiment. Do not alter the production endpoint during evaluation.

## Safety and data limitations
OSM coverage and tags are incomplete. A route engine cannot establish actual sidewalk condition, legal public access, current construction, or safe crossings from map data alone. Unknown must remain visible as unknown. Field-verified corrections for the test segment should be maintained as a separate test overlay, not silently written back into OSM.

## Scope guardrails
- This branch is experimental and separate from `main` and PR #2.
- Do not change production, merge PR #2, or replace the current app.
- First deliverable is a reproducible graph/route comparison for the Tampa test area, then decide whether Valhalla should become the primary engine.


## Repository review update (2026-11-13)
- `main` is the repository default branch and contains the basic tracker; it is 101 commits behind `route-generation-work` at the time of review.
- `route-generation-work` contains the actual route-generation UI and serverless function. It is not equivalent to `main`, and it should not be merged wholesale as a routing fix.
- The client expects a JSON response with a `routes` array and reports a strict maximum-distance message. The backend currently assigns the requested total distance to some candidate records after trimming; acceptance testing must independently recompute the polyline length rather than trust the returned `distanceMeters` field.
- The latest branch history includes commits to correct directional alternatives, constrain route backtracking, restore exact-distance out-and-back generation, and test the Palmetto/Grady/Columbus and Harold corridors. These are meaningful iterative improvements, but they do not convert the algorithm into a connected pedestrian graph.
- Pull request #2 (`route-network-constraints`) remains open and draft. Its own description says Deploy Preview testing against real starting coordinates is still required. It must not be treated as production-ready.
- Netlify project lookup by the site name returned no accessible project records in this session. Therefore the deployed branch and published deploy cannot be verified from the connected Netlify account yet.


## Routing engine API review (2026-11-13)

### Valhalla
- The official route API accepts JSON requests with `costing: "pedestrian"`, locations, and optional pedestrian costing options.
- Documented pedestrian controls include `walkway_factor`, `sidewalk_factor`, `alley_factor`, and `driveway_factor`. These can influence preference but are not hard proof that an edge is publicly accessible or that a sidewalk is present on the correct side.
- Valhalla's pedestrian model excludes roads without pedestrian access according to its OSM-derived access interpretation. This is useful baseline behavior, not a substitute for our explicit exclusion/validation layer.
- A hosted community server may be useful for a limited prototype, but it must be treated as best-effort/fair-use infrastructure, not a production service with an SLA. A production deployment should use a managed provider with documented limits or self-host a pinned OSM extract and Valhalla build.

### GraphHopper
- The Directions API supports a `foot` routing profile where available and custom models for modifying route priorities.
- The hosted Directions API is a commercial service; API key, plan coverage, quotas, and current foot-profile availability must be checked before selecting it for production.
- Self-hosted GraphHopper requires a configured `foot` profile and its own OSM graph preparation. It is therefore a useful engine comparator, but not a drop-in unauthenticated public endpoint.
- Custom models can adjust route weighting, but, like Valhalla costing factors, do not independently guarantee exact sidewalk-side compliance or legal public access.

### Comparison decision
Valhalla remains the first prototype candidate because pedestrian costing exposes explicit walkway, sidewalk, alley, and driveway factors, and the project can be self-hosted. GraphHopper remains the comparator. Neither engine should be accepted solely on its route response: our own graph/edge checks, field-observation overlay, property exclusions, and independently measured geometry are mandatory.

### Test harness contract
The comparison harness must:
1. Read the start coordinate only from local environment variables; never commit the Tampa home coordinate or write it to logs.
2. Accept distance and route type as test inputs and keep those inputs identical across engines.
3. Store provider, request profile/options, HTTP status, provider-reported distance, independently measured GeoJSON/polyline length, geometry, snap offset, and elapsed time.
4. Evaluate each returned path against OSM pedestrian edges and the private field-observation overlay.
5. Report separate hard failures (restricted/private access, parking/service interior, wrong-side sidewalk, disconnected pedestrian edge) and soft quality indicators (major-road exposure, crossing count, detour, route overlap).
6. Keep engine output separate from acceptance decisions; no engine's own `distance` field or access classification is authoritative.
7. Avoid high-volume calls to public community endpoints. Use a small, deterministic matrix of test distances and directions and cache responses locally.

### Current execution limitation
This environment can inspect and update repository files but cannot presently execute external routing requests from the runtime. No Valhalla, GraphHopper, or ORS route results have been obtained in this session. The implementation/test harness must not be described as validated until it is run with working network access and credentials where required.


## First executable prototype utility (2026-11-13)

Added `tools/pedestrian-candidates.mjs` on this branch. It is a deliberately narrow first implementation of the graph-extraction/candidate-generation stage:

- Reads the private origin from local `STEPX_TEST_LAT` and `STEPX_TEST_LON` environment variables; refuses to run without them.
- Queries a bounded Overpass area and builds an undirected graph from selected pedestrian-tagged OSM ways.
- Uses Dijkstra shortest-path distances from the nearest eligible graph node.
- Finds up to 12 graph-node candidates near half of each requested out-and-back distance (default test distances: 0.5, 1, and 2 miles).
- Omits origin coordinates and route geometry from its output so the output can be retained without disclosing the private test location.
- Supports a local Overpass endpoint override and configurable search radius/snap limit.

Example local invocation (substitute the private values locally; do not paste them into repository files or shared logs):

```bash
STEPX_TEST_LAT=<private-latitude> STEPX_TEST_LON=<private-longitude> node tools/pedestrian-candidates.mjs --miles 0.5,1,2
```

### Known limitations — not acceptance-ready

This is graph candidate generation, not a route engine comparison and not a complete safety validator. The current graph pass:
- treats eligible OSM ways as undirected;
- does not yet enforce one-way directionality, crossing legality, polygon/parcel exclusions, field-observation overlays, or side-specific sidewalk geometry;
- only includes road centerlines where OSM explicitly tags a sidewalk, but still cannot establish which side is represented;
- excludes service and parking-aisle ways, but does not yet spatially test route geometry against parking or commercial property polygons;
- snaps to the nearest eligible graph node within a configurable limit; a nearest-node snap is not proof that the user's actual location connects to that graph edge;
- uses public Overpass by default, so execution should remain low-volume and best-effort.

The script has been committed but has not been executed in this environment: outbound network access is unavailable here. Its output must be reviewed and its limitations addressed before connecting candidate nodes to Valhalla, GraphHopper, or the app.


### Follow-up graph correctness pass (2026-11-13)

The candidate utility now honors explicit pedestrian direction tags when constructing directed graph arcs:
- `foot:forward=no` removes forward travel along the OSM way.
- `foot:backward=no` removes backward travel.
- `oneway:foot=yes` and `oneway:foot=-1` apply the corresponding pedestrian direction.
- A vehicle `oneway=yes` tag by itself is deliberately not treated as a pedestrian one-way restriction.

The utility also validates its configured search radius and start-snap limit before making a request.

This improves graph semantics but does not solve the remaining topology and safety gaps. In particular, the nearest-node snap is only a proximity check: it does not yet build a verified connector from the exact GPS origin to the graph. The current Dijkstra tree produces candidate nodes on shortest paths from the selected snap node; those candidates are not yet three distinct route alternatives. Candidate node IDs are diagnostic identifiers, not route coordinates or a guarantee of legal access. No live Overpass execution has been performed from this environment.


### Reusable graph module and k-shortest alternatives (2026-11-13)

The graph logic has been extracted to `tools/pedestrian-graph.mjs`, with offline unit tests in `tools/pedestrian-graph.test.mjs`. The candidate generator now imports these shared functions rather than keeping a second copy of eligibility and direction rules.

The module provides:
- Haversine edge-length calculation.
- Pedestrian-way eligibility and explicit foot-direction handling.
- Directed graph construction.
- Binary-heap Dijkstra shortest paths with an optional maximum distance.
- Path reconstruction.
- Yen's loopless k-shortest-path algorithm, bounded to 1–10 requested paths.

For each candidate turnaround node, the utility now reports up to three shortest loopless path variants to that same endpoint, subject to the outbound-distance tolerance. Each variant reports its rank, independently summed graph distance, and node count; geometry and coordinates remain omitted.

Important interpretation:
- These are alternate paths to one endpoint, not yet independently selected turnaround points or guaranteed user-distinct route choices.
- Yen's algorithm prevents repeated nodes within an individual path, but does not enforce a minimum edge-disjointness or route-overlap threshold between alternatives.
- Alternatives are ordered by network length, not by safety or comfort. The hard safety validator and route-diversity scoring are still outstanding.
- The candidate generator has not been executed against live Overpass data in this environment. The unit tests are committed but must be run in a Node.js environment before this branch is treated as verified.

The earlier description of the graph as undirected is superseded by the explicit directed-way implementation described above.


### Route-overlap filtering (2026-11-13)

Added directed-edge overlap scoring and a diversity selector to the graph module:

- `directedPathOverlap` computes Jaccard overlap across directed edges. Reversing an edge is treated as a different traversal, which matters on explicitly one-way pedestrian links.
- `selectDiversePaths` sorts candidate paths by network length and greedily keeps paths whose overlap with every already-selected path is at or below a configurable ceiling.
- Candidate generation now asks Yen's algorithm for a pool of up to eight paths to each candidate turnaround, then retains up to three with a maximum directed-edge Jaccard overlap of 0.65.
- Output reports each retained variant's maximum overlap with another retained variant.

This is a first structural diversity filter, not a visual-route or safety guarantee. Paths can still share the same street corridor while using different OSM node segmentation, and paths with low edge overlap can still look similar on a map. The next refinement should collapse consecutive edges by OSM way/corridor identity and score shared corridor length, then diversify turnaround nodes as well as paths to a fixed endpoint.

The candidate turnaround nodes themselves still come from one Dijkstra shortest-path tree. This stage therefore produces diverse path variants per candidate endpoint, not a globally optimized set of three independent out-and-back routes. No live Overpass execution or Node test run has been performed in this environment.


### Corridor-level diversity and turnaround selection (2026-11-13)

The graph module now includes weighted corridor-overlap scoring based on OSM way IDs:

- `corridorPathOverlap` compares the length traveled on each OSM way and calculates weighted Jaccard overlap. It catches alternatives that use different node segmentation along the same mapped way.
- `selectCorridorDiversePaths` greedily selects short path variants while enforcing a maximum shared-corridor overlap.
- For each requested distance, candidate generation now screens turnaround nodes against one another using the same corridor metric, retaining up to 12 candidate endpoints with no more than 0.75 overlap against already selected endpoints.
- For each selected endpoint, it searches up to eight Yen path variants and retains up to three with no more than 0.55 corridor overlap.
- Output reports maximum corridor overlap for each selected path variant.

These thresholds are initial engineering heuristics, not empirically calibrated quality scores. OSM way IDs are a better corridor proxy than raw node-edge overlap, but distinct OSM ways can still represent the same physical street, sidewalk, or adjacent parallel facilities. Geometry-based corridor clustering and map visualization are still needed.

The turnaround candidates remain drawn from the Dijkstra shortest-path tree. This is now a diverse subset of reachable endpoints, not a global search over all possible outbound paths. No live Overpass request or Node test execution has been performed in this environment. The earlier directed-edge-only diversity description above is superseded for candidate generation by this corridor-level approach; the directed-edge utilities remain available for diagnostics.


### GPS-to-edge projection primitives (2026-11-13)

Added reusable offline graph utilities for the next snap stage:

- `projectPointToSegment` projects a GPS point onto a mapped segment in a local metric plane and reports the along-edge fraction, projected coordinate, and perpendicular offset.
- `findNearestPedestrianEdge` searches directed eligible graph arcs and returns the nearest segment projection only when it falls within a caller-supplied snap limit.
- `splitPedestrianEdgeAtProjection` replaces the selected directed arc with two sub-arcs at a virtual node. If the reverse arc exists, it is split independently; if it does not exist, no reverse travel is invented. OSM way identity and edge distance are retained.

These are geometry/topology primitives, not a verified GPS connector. The candidate generator still uses nearest-node snapping and has not been switched over. A short straight line from the device location to the projected point may cross a road, driveway, fence, private parcel, or building; proximity alone is not proof of walkable access. Before integration, the virtual node must be added to the node-coordinate map, the selected segment must be split consistently, and a connector must be independently validated or rejected. The next test pass should also address parallel edges sharing the same endpoint pair and OSM way ID, and preserve edge identity through shortest-path algorithms rather than reconstructing it from node sequences.

Four additional offline tests cover projection, snap-limit rejection, bidirectional splitting, and one-way preservation. They are committed but have not been executed in a Node.js runtime in this session.


### Parallel-edge identity safeguard (2026-11-13)

The edge-projection result now carries the selected adjacency-list edge index, and the splitter verifies that the indexed arc still matches the projected endpoints, OSM way ID, and length before changing the graph. This avoids accidentally splitting the first of several parallel arcs that share endpoints and a way ID. Reverse travel is split only when there is exactly one matching reverse arc with the same way ID and length; when parallel reverse arcs are ambiguous, the utility deliberately leaves reverse travel disconnected rather than guessing. An offline regression test covers selection among parallel arcs.

A remaining graph-model limitation is that shortest-path results are still represented primarily as node sequences. Parallel arcs between the same node pair can therefore lose their exact edge identity in path reconstruction, corridor scoring, and Yen spur-edge exclusion. This needs a separate edge-aware path representation before the graph can be relied on for final route scoring.


### Edge-aware shortest paths (2026-11-13)

The k-shortest-path implementation now retains the exact directed edge selected at every step, not only the node sequence. Graph edges created from OSM ways receive stable directional segment IDs. Yen's spur search bans the specific directed edge used by an accepted path, and candidate identity is based on edge sequences. Path distance and corridor overlap use the retained edge records. This allows two genuinely distinct parallel mapped ways between the same pair of nodes to remain separate alternatives instead of collapsing into one node-sequence path.

A regression test covers two parallel edges with identical endpoints but different way identity and length. This is still a code-level change only: tests have been added but not executed in a Node runtime during this session. Candidate generator and its corridor-diversity reporting still pass node sequences into parts of the scoring layer; those interfaces should be migrated to edge-aware path objects before treating alternatives as fully audited.


### Fail-closed GPS edge-projection integration (2026-11-14)

The candidate utility now uses `findNearestPedestrianEdge` rather than selecting the nearest graph node. For an interior projection, it splits the selected directed edge and inserts a virtual origin node with the projected coordinate in the in-memory node map. Endpoint projections use the corresponding existing graph node to avoid creating a zero-length edge.

Crucially, the origin-to-network connector is still unverified. The utility therefore withholds all generated route candidates and labels each requested distance `withheld_unverified_origin_connector`. It reports only the snap offset, projection fraction, and diagnostic candidate count; it does not print coordinates or route geometry. This is an intentional fail-closed state, not a completed routing feature.

The CI workflow now syntax-checks `tools/pedestrian-candidates.mjs` in addition to running the offline graph unit tests. The script has not yet been executed against live Overpass data in this environment. Before any route can be released, implement a connector validator that can establish same-side pedestrian access using mapped/field-verified topology; otherwise keep the route withheld. Do not bypass this gate with a configuration flag.


### Directed origin-snap topology checks (2026-11-14)

Extracted the GPS-origin attachment into the pure graph module as `snapOriginToPedestrianGraph`, so the production candidate script and offline tests use the same logic.

- Interior projections split the selected directed edge and return a virtual start node.
- Endpoint projections reuse the mapped node, but are rejected if that node has no outgoing pedestrian edge. This prevents a one-way dead-end endpoint from being treated as a valid starting point.
- Bidirectional interior edges retain both legal directions; one-way edges do not gain an invented reverse connection.
- The helper rejects virtual-node ID collisions and snaps outside the configured distance.
- The input graph is not mutated.
- Every successful snap still reports `connectorStatus: "unverified"`; this helper does not establish a safe or legal connection from GPS to the mapped path.

The candidate script now uses this shared helper. Its adjacency binding was changed to mutable because interior snapping replaces the graph with a split copy. Offline regression tests cover interior, endpoint, one-way, bidirectional, distant-origin, and ID-collision cases. The latest CI run is pending; no live Overpass request has been performed.


### Conservative sidewalk-geometry eligibility (2026-11-14)

Tightened the graph's eligibility policy to avoid a misleading representation of sidewalks:

- Dedicated pedestrian ways (`footway`, `path`, `pedestrian`, and `steps`) remain eligible subject to access tags.
- A cycleway is eligible only when foot access is explicitly allowed.
- Road centerlines are now excluded even when tagged `sidewalk=left`, `right`, or `both`. Those tags indicate sidewalk presence but do not provide the sidewalk's actual geometry or establish which side is safely connected to the user's position.
- Through-routing excludes destination-only and restricted access values, including `destination`, `agricultural`, `forestry`, and `restricted`, as well as private/customer/delivery access.

This intentionally reduces graph coverage in exchange for avoiding false sidewalk geometry. Separate sidewalk ways mapped in OSM may still be eligible, but their connectivity, crossings, and access must be validated independently. It does not resolve the Grady Avenue side-of-street question by itself. Added regression tests for the stricter eligibility policy. No live map or routing data was queried.


### Crossing-evidence primitives (2026-11-14)

The graph now preserves OSM tags on directed edges, and the candidate generator retains tags on OSM node records. Added `pedestrianCrossingEvidence` and `crossingEvidenceForNode` to distinguish:
- no mapped crossing evidence (unknown);
- a mapped crossing or marking;
- an explicitly controlled crossing such as traffic signals.

This is deliberately evidence-only. A mapped zebra marking or signal does not prove current operation, accessibility, legal crossing conditions, or safe timing. An untagged node is not treated as a crossing. The candidate generator does not yet use crossing evidence as a route acceptance gate, so routes remain withheld while origin connection is unverified.

Also corrected the candidate report's limitation text: road centerlines are excluded even when a sidewalk-presence tag exists; dedicated sidewalk geometry and side-specific connectivity must be mapped and validated. Offline regression tests cover mapped, controlled, unmarked, and unknown crossing evidence. No live Overpass request has been performed.


### Pedestrian connectivity audit diagnostics (2026-11-14)

Added `auditPedestrianConnectivity(nodes, adjacency)` to the offline graph module. It summarizes:
- isolated OSM nodes with no eligible pedestrian edge;
- terminal nodes with one distinct neighboring node;
- junctions with three or more distinct neighbors;
- junctions lacking explicit mapped crossing evidence;
- incoming/outgoing directed-edge counts and distinct way counts for each diagnostic record.

The audit uses the undirected incidence of eligible pedestrian edges to identify structural junctions while separately preserving directed in/out counts. It is linear in the number of graph nodes and edges. The candidate generator now emits aggregate counts only; it does not print node IDs, coordinates, or geometry.

These findings are review flags, not safety judgments. A junction without crossing tags may not require a road crossing, and a mapped crossing does not prove safety. Likewise, a terminal may be a legitimate path endpoint. The diagnostics do not yet block candidate generation; all candidate paths remain withheld because the GPS connector is unverified. Added a synthetic regression test for isolated nodes, terminal nodes, and junctions with/without crossing evidence. No live Overpass request was made.


### Crossing-tag interpretation correction (2026-11-14)

Refined crossing evidence to avoid treating every `highway=traffic_signals` node as a mapped pedestrian crossing. A signalized road node without crossing-specific tags now reports signal evidence separately while leaving pedestrian-crossing status unknown. Explicit `crossing=traffic_signals` remains mapped crossing evidence. Crossing-marking values are retained as the evidence type, including explicit `no` markings. Added regression cases for these distinctions.

The connectivity audit also counts edges explicitly tagged as `footway=crossing` or `highway=crossing`. The candidate utility exposes this as an aggregate count only. This remains descriptive OSM evidence; it does not establish crossing legality, signal availability to pedestrians, or safety.


### Structured field-observation and path-crossing review (2026-11-14)

Added `tools/field-observations.mjs` with a versioned, feature-matched observation record and deterministic validation:

- Common fields: schema version, observation ID, feature ID/type, verification status, and ISO-8601 observation timestamp.
- Observations must match the exact route feature and expected feature type.
- Observations older than 90 days are stale by default; future-dated records, missing fields, and mismatched feature IDs fail closed.
- Connector observations require continuity, same-side access, and public-access checks.
- Ordinary pedestrian connection observations require continuity and public-access checks.
- Crossing observations require crossing presence, pedestrian access, and a curb-ramp status. If mapped evidence indicates a controlled crossing, signal operation must also be explicitly verified.
- The maximum observation age can be configured by the caller, within a bounded 0–365 day range.

Added `assessCrossingRequirement` to preserve three distinct outcomes: not required, field review needed, and field verified. The function does not infer crossing necessity: `crossingRequired` must come from a separate geometry/context review. A mapped crossing tag alone never passes the field-verification gate.

Updated `tools/route-acceptance.mjs` to require structured, current, feature-matched field observations for origin connectors, ordinary route connections, and required crossings. The previous boolean-only fieldVerified shortcut is no longer sufficient. Acceptance remains a supplied-evidence gate, not a guarantee of safety.

Added `inspectPathCrossingEvidence` to the graph module. Given a path's node sequence and optional edge records, it reports explicit mapped crossing nodes and crossing-tagged way edges, while separately counting unknown nodes and signal-only nodes. A generic traffic-signal node is not misclassified as a pedestrian crossing. The inspector reports evidence only; it does not decide whether a roadway crossing is required.

Offline CI now runs the graph, field-observation, and route-acceptance suites together. The latest run for commit `6975be68ef65361b2f532cff8bf242ceb63c6ff7` completed successfully.

### Remaining integration boundary

The candidate generator still withholds all user-facing routes because its GPS-origin connector is unverified. The new observation and crossing-inspection modules establish validation primitives, but no live Overpass run, real-world field observation, geometry-based road-crossing inference, or app/UI integration has been completed. Do not mark any route accepted until the app supplies complete per-feature observations and the separate geometry/context review has classified crossing necessity.
