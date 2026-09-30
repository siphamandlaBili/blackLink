import { SOWETO_BOUNDS } from '../config/constants.js';

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** GeoJSON point from lat/lng. Note the order: GeoJSON is [lng, lat]. */
export const toPoint = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });

/** { lat, lng } from a GeoJSON point. */
export const fromPoint = (point) => (point?.coordinates ? { lng: point.coordinates[0], lat: point.coordinates[1] } : null);

/** Great-circle distance in metres between two { lat, lng }. */
export function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const insideSoweto = ({ lat, lng }) =>
  lng >= SOWETO_BOUNDS.minLng && lng <= SOWETO_BOUNDS.maxLng && lat >= SOWETO_BOUNDS.minLat && lat <= SOWETO_BOUNDS.maxLat;

/** Rounds to ~1 km (2 decimals) so a "remembered area" never stores a precise location. */
export const roundArea = ({ lat, lng }) => ({ lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 });
