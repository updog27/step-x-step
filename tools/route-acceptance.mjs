// Conservative route acceptance policy for Step x Step.
// This module evaluates evidence; it does not infer sidewalk geometry or safety.
// Map crossing tags are clues for review, never proof that a crossing is safe.

const VALID_STATUSES = new Set(["verified", "unverified", "rejected"]);

function validEvidenceStatus(value) {
  return VALID_STATUSES.has(value);
}

/**
 * Evaluate whether a candidate pedestrian route may be released to a user.
 *
 * Required input shape:
 * {
 *   requestedDistanceMeters: number,
 *   pathDistanceMeters: number,
 *   originConnector: {
 *     status: "verified"|"unverified"|"rejected",
 *     sameSideAccess: boolean,
 *     crossingRequired?: boolean,
 *     fieldVerified?: boolean
 *   },
 *   connections: [{
 *     id?: string,
 *     status: "verified"|"unverified"|"rejected",
 *     crossingRequired?: boolean,
 *     crossingEvidence?: { mapped?: boolean, type?: string },
 *     fieldVerified?: boolean
 *   }]
 * }
 *
 * A roadway crossing is releasable only with an explicit field verification.
 * OSM crossing evidence alone cannot satisfy that gate. An ordinary mapped
 * network connection must be verified as topologically continuous. An
 * unverified gap remains a review item, not an assumed connection.
 */
export function evaluateRouteAcceptance(input, options = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("Route acceptance input is required");
  }
  const requested = input.requestedDistanceMeters;
  const actual = input.pathDistanceMeters;
  if (!Number.isFinite(requested) || requested <= 0 ||
      !Number.isFinite(actual) || actual <= 0) {
    throw new TypeError("Requested and path distances must be positive finite meters");
  }

  const ratio = options.distanceToleranceRatio ?? 0.02;
  const minimum = options.minimumDistanceToleranceMeters ?? 15;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 0.1 ||
      !Number.isFinite(minimum) || minimum < 0) {
    throw new RangeError("Distance tolerance must be 0–0.1 and minimum tolerance non-negative");
  }

  const reasons = [];
  const reviewItems = [];
  const rejectedItems = [];
  const toleranceMeters = Math.max(minimum, requested * ratio);
  const distanceErrorMeters = Math.abs(actual - requested);

  if (distanceErrorMeters > toleranceMeters) {
    reasons.push("requested_distance_out_of_tolerance");
  }

  const connector = input.originConnector;
  if (!connector || !validEvidenceStatus(connector.status)) {
    reviewItems.push({ code: "origin_connector_unverified", id: "origin" });
  } else if (connector.status === "rejected") {
    rejectedItems.push({ code: "origin_connector_rejected", id: "origin" });
  } else if (connector.status !== "verified" || connector.sameSideAccess !== true) {
    reviewItems.push({ code: "origin_same_side_access_unverified", id: "origin" });
  }
  if (connector?.crossingRequired === true && connector?.fieldVerified !== true) {
    reviewItems.push({ code: "origin_requires_field_verified_road_crossing", id: "origin" });
  }

  if (!Array.isArray(input.connections) || input.connections.length === 0) {
    reviewItems.push({ code: "route_connections_not_supplied", id: "route" });
  } else {
    input.connections.forEach((connection, index) => {
      const id = connection?.id ?? `connection-${index + 1}`;
      if (!connection || !validEvidenceStatus(connection.status)) {
        reviewItems.push({ code: "connection_status_unverified", id });
        return;
      }
      if (connection.status === "rejected") {
        rejectedItems.push({ code: "connection_rejected", id });
        return;
      }
      if (connection.status !== "verified") {
        reviewItems.push({ code: "connection_topology_unverified", id });
      }
      if (connection.crossingRequired === true && connection.fieldVerified !== true) {
        reviewItems.push({
          code: connection.crossingEvidence?.mapped === true
            ? "mapped_crossing_requires_field_verification"
            : "roadway_crossing_requires_field_verification",
          id
        });
      }
    });
  }

  const rejected = rejectedItems.length > 0;
  const needsReview = reviewItems.length > 0 || reasons.length > 0;
  const status = rejected ? "rejected" : needsReview ? "needs_field_review" : "accepted";

  return {
    accepted: status === "accepted",
    status,
    reasons,
    reviewItems,
    rejectedItems,
    distance: {
      requestedMeters: requested,
      actualMeters: actual,
      errorMeters: +distanceErrorMeters.toFixed(2),
      toleranceMeters: +toleranceMeters.toFixed(2),
      withinTolerance: distanceErrorMeters <= toleranceMeters
    },
    limitations: [
      "Acceptance means the supplied topology, connector, crossing, and distance evidence passed these gates; it is not a guarantee of real-world safety.",
      "Mapped crossing tags are descriptive evidence only and never replace field verification of a required roadway crossing.",
      "The caller must supply complete connection and field-observation records; omitted or unknown evidence fails closed."
    ]
  };
}
