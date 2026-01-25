interface Coordinates {
  latitude: number;
  longitude: number;
}

interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
  geometry?: any;
}

// Cache for route calculations
const routeCache = new Map<string, RouteResult>();

function getCacheKey(from: Coordinates, to: Coordinates): string {
  return `${from.latitude},${from.longitude}-${to.latitude},${to.longitude}`;
}

export async function calculateRouteFromCoordinates(
  from: Coordinates,
  to: Coordinates
): Promise<RouteResult> {
  const cacheKey = getCacheKey(from, to);

  // Check cache first
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)!;
  }

  const apiKey = process.env.ORS_API_KEY;

  // If no API key, return estimated values based on straight-line distance
  if (!apiKey) {
    const estimatedResult = calculateEstimatedRoute(from, to);
    routeCache.set(cacheKey, estimatedResult);
    return estimatedResult;
  }

  try {
    const response = await fetch(
      'https://api.openrouteservice.org/v2/directions/driving-hgv',
      {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [from.longitude, from.latitude],
            [to.longitude, to.latitude],
          ],
          units: 'km',
        }),
      }
    );

    if (!response.ok) {
      console.warn('OpenRouteService API error, using estimated values');
      const estimatedResult = calculateEstimatedRoute(from, to);
      routeCache.set(cacheKey, estimatedResult);
      return estimatedResult;
    }

    const data = await response.json();
    const route = data.routes?.[0];

    if (!route) {
      const estimatedResult = calculateEstimatedRoute(from, to);
      routeCache.set(cacheKey, estimatedResult);
      return estimatedResult;
    }

    const result: RouteResult = {
      distanceKm: route.summary.distance,
      durationMinutes: Math.round(route.summary.duration / 60),
      geometry: route.geometry,
    };

    routeCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.warn('Failed to calculate route via API, using estimated values:', error);
    const estimatedResult = calculateEstimatedRoute(from, to);
    routeCache.set(cacheKey, estimatedResult);
    return estimatedResult;
  }
}

function calculateEstimatedRoute(from: Coordinates, to: Coordinates): RouteResult {
  // Haversine formula for straight-line distance
  const R = 6371; // Earth's radius in km
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(from.latitude)) *
      Math.cos(toRad(to.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineDistance = R * c;

  // Estimate road distance as 1.3x straight line (typical road factor)
  const distanceKm = straightLineDistance * 1.3;

  // Estimate 60 km/h average speed for heavy vehicles
  const durationMinutes = Math.round((distanceKm / 60) * 60);

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes,
  };
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Predefined routes for common paths (can be used as fallback or initial data)
export const PREDEFINED_ROUTES = {
  MILANO_TIRANO: {
    name: 'Milano -> Tirano',
    distanceKm: 150,
    durationMinutes: 150, // 2h30
    tollCost: 15,
  },
  TIRANO_LIVIGNO: {
    name: 'Tirano -> Livigno',
    distanceKm: 45,
    durationMinutes: 45,
    tollCost: 0,
  },
  LIVIGNO_TIRANO: {
    name: 'Livigno -> Tirano',
    distanceKm: 45,
    durationMinutes: 45,
    tollCost: 0,
  },
  TIRANO_MILANO: {
    name: 'Tirano -> Milano',
    distanceKm: 150,
    durationMinutes: 150,
    tollCost: 15,
  },
};
