# Step x Step — Project Control Plan

**Status date:** 2026-11-16  
**Project objective:** Launch a reliable walking/running route generator. The core promise is that a user enters a distance and receives useful, genuinely different pedestrian routes that return to the start when requested, stay within a measured distance tolerance, and do not invent pedestrian connections.

## Executive status

The project is in an engineering-prototype stage, not release-candidate stage.

The repository currently has three materially different lines of work:

- `main`: the original GPS tracking/map application.
- `route-generation-work`: the user-facing route UI and Netlify function. This is 101 commits ahead of `main`.
- `pedestrian-network-prototype`: a separate pedestrian-graph and route-acceptance research implementation. This is 202 commits ahead of `main`.

The two feature branches are siblings from `main`; neither contains the other's work. The pedestrian graph engine is not integrated into the Netlify route function or the deployed app. This is the primary delivery blocker. Do not describe the graph prototype as a working user-facing route generator.

## Project management rules

1. Keep `main` and production untouched until a release candidate passes the release gates below.
2. Do not merge the two feature branches wholesale. Integrate deliberately, in small reviewable changes, after interface contracts and tests are established.
3. Never repair route-distance mismatch by truncating a pedestrian path at an arbitrary coordinate and reversing it. A turnaround must be a routable graph location, and the return leg must be independently found on valid directed pedestrian edges.
4. Do not retry a routing provider repeatedly when the failure is structural. Capture the failure, identify whether it is provider coverage, graph topology, access tagging, endpoint snapping, geometry/distance, or API configuration, then apply the corresponding fix or change provider/architecture.
5. Fail closed: do not present a route as verified when origin access, pedestrian connections, or required crossings remain unknown.
6. Keep provider credentials server-side. Add request timeouts, bounded retries, rate limiting, structured error codes, and observability before public launch.
7. Maintain offline deterministic tests for algorithms; add live integration tests separately and label them as such.
8. Do not ask for field testing until a coherent end-to-end candidate build is available.

## Confirmed technical findings

### Structural flaw in the older route-generation branch

The out-and-back implementation in `route-generation-work/netlify/functions/routes.js` obtains an ORS route to an arbitrary waypoint/destination, truncates its returned geometry at exactly half the requested distance, and reverses the truncated coordinates to fabricate the return leg. This guarantees a displayed length mathematically, but the truncated endpoint is not proven to be a routable pedestrian-network junction. The reverse segment is not independently routed and may imply an impossible connection or inaccessible crossing.

The one-way branch also trims provider geometry to the exact target. Trimming is not necessarily invalid for a one-way route if the endpoint is explicitly accepted as an arbitrary point on an accessible path, but it must not be reused to construct a return path or presented as a verified accessible destination without endpoint validation.

### Current pedestrian-network prototype

The prototype replaces arbitrary geometric truncation with:
- directed OSM pedestrian edges;
- GPS-origin projection and graph-edge splitting;
- bounded turnaround discovery from graph nodes;
- Yen k-shortest path alternatives;
- independent directed return-path search;
- complete round-trip geometry distance measurement;
- corridor overlap and roadway-crossing heuristics;
- feature-level field observation and route acceptance gates.

However, the current CLI candidate generator is diagnostic-only. It marks the origin connector unverified and withholds every candidate. It does not yet expose a production API contract, persist map extracts, or deliver usable route geometry to the existing UI.

## Architecture decision in progress

**Preferred route-generation architecture:** use a pedestrian graph as the source of truth for route topology and exact-distance turnaround selection. A routing provider may be used as a challenger, map-data source, or comparison oracle, but must not silently override graph validity.

Provider evaluation:
- **Valhalla:** first challenger to benchmark for pedestrian route generation and endpoint/waypoint behavior. It is open source, supports pedestrian costing, and can be self-hosted for predictable control. Hosted endpoint reliability, data freshness, and service terms must be verified before production use.
- **GraphHopper:** second challenger. Its Directions API supports route planning and related services; pedestrian profile coverage, alternatives, and pricing must be measured for our target geographies.
- **openrouteservice (ORS):** retain as a baseline/optional provider, not the only routing dependency. Hosted service limits and behavior must be tested against our required route distances and request volume.
- **Mapbox walking:** useful comparison option for standard A-to-B walking directions, but it does not by itself solve exact-distance round-trip turnaround selection or our evidence/acceptance requirements.

Do not choose a provider based on marketing claims. Run the same anonymized benchmark cases against each provider and compare: route availability, pedestrian-edge legality, geometry distance, endpoint snapping, alternate-route diversity, response time, error rate, and cost.

## Delivery workstreams and gates

### Gate A — Architecture and reproducibility
- Identify the canonical application branch and hosting/deployment target.
- Define a stable route-engine interface between UI/serverless API and pedestrian graph.
- Add deterministic fixtures for representative network topologies, disconnected paths, one-way foot access, origin-on-edge splits, dead ends, loops, and parallel sidewalks.
- Define structured failure codes; never collapse provider errors into "no route found."

### Gate B — End-to-end route engine
- Integrate graph construction, origin snap, turnaround discovery, independent return routing, complete route assembly, and acceptance into one callable server-side workflow.
- Ensure the same geometry is used for map display, distance calculation, and route adherence.
- Return route geometry only when topology and distance checks pass; otherwise return a specific actionable failure.
- Produce up to three distinct alternatives, but return fewer when fewer valid alternatives exist. Never manufacture three.

### Gate C — Live map-data validation
- Test representative locations and distances with live OSM data.
- Record Overpass response completeness, missing ways/nodes, rate limits, and provider failures.
- Cache bounded map extracts with freshness metadata; avoid repeated full-area queries on every user request.
- Validate access tags, graph connectivity, origin connector, and crossing evidence. Unknown remains unknown.

### Gate D — Product integration
- Connect the stable route-engine API to the existing map UI.
- Verify route-type semantics: out-and-back, loop, one-way, and free-run.
- Display measured route distance and honest map-evidence status.
- Ensure route selection, tracking, reset, and GPS adherence work with the selected geometry.

### Gate E — Release candidate
- Automated unit, integration, API-contract, and browser/device tests pass.
- Live route benchmark passes in more than one neighborhood and for multiple distances.
- No artificial path trimming or unvalidated reverse-edge construction.
- API keys remain server-side; abuse/rate limits and monitoring are configured.
- Rollback path and production deployment checklist are documented.
- User field test is scheduled only after these gates pass.

## Immediate next actions

1. Map the app branch and prototype branch at the file/API level and select a canonical integration branch without merging either wholesale.
2. Extract the graph prototype's route-generation workflow behind a pure callable interface, separate from CLI diagnostics.
3. Add end-to-end fixture tests that prove a turnaround and return leg are connected graph paths and that displayed distance is measured from final geometry.
4. Build a provider benchmark harness for Valhalla, GraphHopper, and ORS using identical non-sensitive test cases.
5. Integrate the validated engine into the Netlify function only after the contract and tests are in place.

## Release language

Until Gate E is complete, describe the product as a prototype under development. A passing offline test suite proves the tested algorithmic behavior only; it does not prove live map-data coverage, real-world sidewalk access, safe crossings, or launch readiness.


## Current implementation checkpoint — 2026-11-16

The pedestrian candidate engine has been extracted into `tools/route-engine.mjs` and is callable with normalized graph data. Deterministic contract tests live in `tools/route-engine.test.mjs`.

A Netlify serverless adapter now exists at `netlify/functions/routes.mjs`. It:
- accepts POST requests with origin and requested out-and-back distance;
- validates inputs and limits prototype requests to 3 miles;
- acquires pedestrian-tagged OSM ways from Overpass server-side;
- normalizes map data into the directed pedestrian graph;
- snaps the origin to the eligible graph while retaining an unverified connector status;
- invokes the callable engine;
- caches map responses in-process for five minutes (maximum 32 bounding boxes);
- applies an instance-local per-client request limit;
- returns stable failure codes and suppresses route geometry unless acceptance passes.

The browser interface now has a separate **Find My Route** action. It calls the serverless endpoint and communicates review/no-route/provider states without pretending that withheld geometry is navigable. The existing GPS activity tracker remains separate.

API contract and known limitations are documented in `docs/ROUTE_API.md`. Serverless adapter tests cover request validation, withheld geometry, OSM normalization/cache behavior, and provider rate limiting.

CI has passed on commit `348f8e6228226881439037e2afe8237436cee4fb`, including browser/server syntax checks and the offline test suite. Production/main has not been changed and no deployment has been performed.

### Remaining integration gates

1. Validate a real Overpass response and complete route candidate against controlled test coordinates without exposing precise coordinates in logs.
2. Add provider timeout/retry/backoff and shared cache/rate limiting before production use.
3. Improve candidate engine tests with realistic directed pedestrian graph fixtures and explicit expected route-distance behavior.
4. Resolve the current origin-connector and route-feature field-verification workflow. Until then, the API correctly returns field-review status and no usable geometry.
5. Test the Netlify function in a preview environment and verify browser/API behavior end-to-end.
6. Only after those gates pass should route geometry be enabled for navigation or a production deployment be considered.
