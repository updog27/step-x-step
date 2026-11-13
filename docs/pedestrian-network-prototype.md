# Step x Step — Pedestrian Network Prototype

## Purpose
Build and validate a route-generation prototype independently of the current Netlify/ORS implementation. Do not merge into production until the acceptance tests pass.

## Current system baseline
The existing application uses Leaflet for map display, Netlify Functions for route generation, OpenStreetMap data queried through Overpass, and the HeiGIT-hosted OpenRouteService foot-walking endpoint. Its out-and-back method chooses eight compass bearings, routes to a geographic endpoint, trims the resulting geometry at half the requested distance, and reverses that trimmed geometry. This can produce an exact length while selecting a poor or invalid turnaround location.

## Proposed prototype architecture
1. **OSM pedestrian graph extraction** — retrieve pedestrian-relevant ways and nodes for a bounded test area. Preserve way geometry, node connectivity, tags, access restrictions, crossings, and sidewalk-side metadata. Separately mapped sidewalks must remain separate graph edges; never infer that a route on one side of a road is supported by a sidewalk on the other side.
2. **Graph construction and validation** — build connected pedestrian edges with explicit edge classifications and provenance. Treat unknown access and unknown sidewalk status as unknown, not as proof of public access or proof of a sidewalk.
3. **Candidate turnaround generation** — enumerate eligible graph nodes and points along eligible pedestrian edges reachable from the snapped start within the outbound target distance. Exclude candidates inside mapped parking, private/restricted access, and mapped commercial/industrial land-use polygons. Where parcel boundaries are unavailable, record that property exclusion is based only on OSM land-use/access tags and is not a legal-access guarantee.
4. **Network-distance routing** — calculate outbound network paths to candidates using Valhalla pedestrian costing first. Compare a small controlled sample against GraphHopper and the existing ORS output. Record route geometry, distance, edge tags, engine, and snap locations.
5. **Exact out-and-back construction** — select a valid outbound path no longer than half the target; return by reversing the exact same geometry. Do not trim a path at an arbitrary point unless that point lies on a verified eligible pedestrian edge and passes all spatial exclusions.
6. **Alternative selection** — select up to three distinct candidates based on route overlap, direction/coverage, and quality score. Return fewer than three when fewer than three candidates pass; never fabricate alternatives.
7. **Independent validation** — apply hard checks before returning a route. Distance tolerance, turnaround eligibility, restricted-access intersection, parking/property intersection, graph connectivity, and route distinctness are measurable pass/fail tests.

## Test area and known ground truth
Use the previously discussed Tampa test area around W Palmetto St, N Grady Ave, N Harold Ave, and W Columbus Dr. The user has specifically confirmed a sidewalk on the east side of N Grady Ave and no sidewalk on its west side. This is a field observation and must be treated as ground truth for that segment even if OSM data is missing or incorrectly tagged. Do not assume the start coordinate is the intersection; obtain the precise start point from the user/map test fixture before evaluating route distances.

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
