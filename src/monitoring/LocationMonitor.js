// LocationMonitor.js
// Movement pattern tracking — weekday vs weekend context for ML.
// No saved "home"; unique areas from GPS clusters; trip distance from consecutive moves.

import GetLocation from 'react-native-get-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid } from 'react-native';

const LOCATION_LOG_KEY = 'location_log_today';
const LEGACY_STORAGE_KEY = 'location_data_today';
const MIGRATE_FLAG_KEY = 'location_log_migrated_v2';

async function migrateLegacyLocationLogOnce() {
  try {
    if (await AsyncStorage.getItem(MIGRATE_FLAG_KEY)) return;
    const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    const cur = await AsyncStorage.getItem(LOCATION_LOG_KEY);
    if (legacy && !cur) {
      await AsyncStorage.setItem(LOCATION_LOG_KEY, legacy);
    }
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    await AsyncStorage.setItem(MIGRATE_FLAG_KEY, '1');
  } catch (e) {
    console.log('Location migrate error:', e);
  }
}

/** Keep in sync with the periodic timer in UserDashboard. */
export const LOCATION_CHECK_INTERVAL_MINUTES = 30;

const CLUSTER_RADIUS_KM = 0.3;
const SEGMENT_MIN_KM = 0.1;

function formatCoordLine(lat, lon) {
  return `${Number(lat).toFixed(4)}°, ${Number(lon).toFixed(4)}°`;
}

export function getDayType(date = new Date()) {
  const d = date.getDay();
  return d === 0 || d === 6 ? 'weekend' : 'weekday';
}

export async function requestLocationPermission() {
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Permission',
        message:
          'MindGuard uses movement patterns to detect isolation. No location data ever leaves your phone.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      }
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (e) {
    return false;
  }
}

export async function checkLocationPermission() {
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  } catch (e) {
    return false;
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clusterIntoPlaces(points, radiusKm = CLUSTER_RADIUS_KM) {
  const clusters = [];
  for (const pt of points) {
    let found = false;
    for (const c of clusters) {
      if (distanceKm(pt.lat, pt.lon, c.lat, c.lon) <= radiusKm) {
        c.lat = (c.lat * c.count + pt.lat) / (c.count + 1);
        c.lon = (c.lon * c.count + pt.lon) / (c.count + 1);
        c.count += 1;
        found = true;
        break;
      }
    }
    if (!found) {
      clusters.push({ lat: pt.lat, lon: pt.lon, count: 1 });
    }
  }
  return clusters;
}

function totalDistanceTraveled(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distanceKm(
      points[i - 1].lat,
      points[i - 1].lon,
      points[i].lat,
      points[i].lon
    );
    if (d > SEGMENT_MIN_KM) total += d;
  }
  return parseFloat(total.toFixed(2));
}

async function getCurrentPosition() {
  try {
    const pos = await GetLocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 10000,
    });
    return { lat: pos.latitude, lon: pos.longitude };
  } catch (e) {
    console.log('GPS error:', e);
    return null;
  }
}

export async function recordLocationSnapshot() {
  const pos = await getCurrentPosition();
  if (!pos) return null;

  const snapshot = {
    lat: pos.lat,
    lon: pos.lon,
    ts: Date.now(),
  };

  try {
    await migrateLegacyLocationLogOnce();
    const raw = await AsyncStorage.getItem(LOCATION_LOG_KEY);
    const log = raw ? JSON.parse(raw) : [];
    log.push(snapshot);
    await AsyncStorage.setItem(LOCATION_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.log('Snapshot save error:', e);
  }
  return snapshot;
}

/** @deprecated use recordLocationSnapshot */
export const recordCurrentLocation = recordLocationSnapshot;

export async function getLocationMetrics() {
  try {
    await migrateLegacyLocationLogOnce();

    const raw = await AsyncStorage.getItem(LOCATION_LOG_KEY);
    const points = raw ? JSON.parse(raw) : [];
    const dayType = getDayType();

    const empty = {
      uniquePlaces: 0,
      totalDistanceKm: 0,
      dayType,
      pointsCollected: points.length,
      locationPlaces: [],
      locationMeta: {
        dayType,
        pointsCollected: points.length,
        clusterRadiusM: Math.round(CLUSTER_RADIUS_KM * 1000),
        segmentMinM: Math.round(SEGMENT_MIN_KM * 1000),
        sampleIntervalMins: LOCATION_CHECK_INTERVAL_MINUTES,
      },
    };

    if (points.length === 0) {
      return empty;
    }

    if (points.length < 2) {
      return {
        ...empty,
        uniquePlaces: 1,
        locationPlaces: [
          {
            id: 'place-0',
            title: 'Area 1',
            sampleCount: 1,
            coordsLine: formatCoordLine(points[0].lat, points[0].lon),
          },
        ],
      };
    }

    const clusters = clusterIntoPlaces(points);
    const uniquePlaces = clusters.length;
    const totalDistanceKm = totalDistanceTraveled(points);

    const sorted = [...clusters].sort((a, b) => b.count - a.count);
    const locationPlaces = sorted.map((cl, i) => ({
      id: `place-${i}`,
      title: `Area ${i + 1}`,
      sampleCount: cl.count,
      coordsLine: formatCoordLine(cl.lat, cl.lon),
    }));

    return {
      uniquePlaces,
      totalDistanceKm,
      dayType,
      pointsCollected: points.length,
      locationPlaces,
      locationMeta: {
        dayType,
        pointsCollected: points.length,
        clusterRadiusM: Math.round(CLUSTER_RADIUS_KM * 1000),
        segmentMinM: Math.round(SEGMENT_MIN_KM * 1000),
        sampleIntervalMins: LOCATION_CHECK_INTERVAL_MINUTES,
      },
    };
  } catch (e) {
    console.log('Location metrics error:', e);
    return {
      uniquePlaces: 0,
      totalDistanceKm: 0,
      dayType: getDayType(),
      pointsCollected: 0,
      locationPlaces: [],
      locationMeta: null,
    };
  }
}

export async function clearTodayLocationData() {
  try {
    await AsyncStorage.removeItem(LOCATION_LOG_KEY);
  } catch (e) {
    console.log('Clear location error:', e);
  }
}
