/**
 * Haversine distance between two lat/lng points in kilometers.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check that all points in an array are at least `minKm` apart from each other.
 * Each point is { lat, lng }.
 */
function allFarEnough(points, minKm) {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (haversineKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng) < minKm) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Filter candidates that are within `maxKm` of a reference point
 * and NOT already in the existing set.
 */
function filterNearby(reference, candidates, maxKm, existingNames) {
  return candidates.filter((c) => {
    if (existingNames.has(c.name)) return false;
    const dist = haversineKm(reference.lat, reference.lng, c.lat, c.lng);
    return dist <= maxKm && dist > 0;
  });
}

module.exports = { haversineKm, allFarEnough, filterNearby };
