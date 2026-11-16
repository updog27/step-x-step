# Step x Step route API (prototype)

## Endpoint

Netlify function: `/.netlify/functions/routes`

Method: `POST`

Request JSON:

```json
{
  "lat": 27.0,
  "lon": -82.0,
  "miles": 1,
  "routeType": "out_and_back"
}
```

- `lat` and `lon` are the device's current location. Do not log or persist them.
- `miles` must be greater than 0 and no more than 10.
- Only `out_and_back` is supported by this prototype endpoint.
- The endpoint requests pedestrian-tagged OpenStreetMap ways from Overpass.
- Map data is cached in the function instance for five minutes (up to 32 bounding boxes).
- Requests are rate-limited per forwarded client address per function instance.

## Response contract

Success-shaped responses include `status`, `requestedDistanceMeters`, `toleranceMeters`, `candidateCount`, `diagnostics`, and `routes`.

Possible result states:
- `routes_available`: at least one candidate passed every acceptance gate.
- `field_review_required`: candidate round trips exist, but evidence or distance gates prevent publication.
- `no_complete_round_trip_found`: no complete directed out-and-back candidate was generated.
- `no_route`: the origin could not be snapped to the eligible pedestrian graph.
- `unavailable`: map-data service failed or was incomplete.

The API deliberately does not return candidate node IDs, raw map geometry, or route geometry for review-only candidates. Geometry is only included for an accepted candidate. The origin connector is currently unverified, so ordinary live requests are expected to return field-review status rather than a usable route.

## Important limitations

This endpoint is an integration milestone, not a release-ready navigation service. OSM completeness, same-side sidewalk access, legal crossings, private-property exclusions, accessibility, and field verification are not established by map matching. Do not describe a withheld candidate as a safe or usable route.

The map provider is called server-side. Do not put provider credentials or location values in client logs. The in-memory cache and rate limiter are instance-local; production hardening requires shared cache/rate limiting, provider retry/backoff, observability without precise location, and load testing.
