import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

const { UsageStatsModule } = NativeModules;

const KEYS = {
  DAILY_USAGE: 'daily_usage',
  BASELINE: 'baseline',
  RISK_HISTORY: 'risk_history',
  MONITORING_START_TS: 'monitoring_start_ts',
  APP_INSTALL_TIME_MS: 'app_install_time_ms',
  DEMO_ACTIVE: 'mindguard_demo_active',
  DEMO_TODAY_STATS: 'mindguard_demo_today_stats',
};

/** Local calendar YYYY-MM-DD (matches UsageMonitor start-of-day key). */
const formatLocalYmd = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const calendarDayType = (d = new Date()) => {
  const day = d.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
};

const mkDemoAppRow = (packageName, appLabel, minutes, launches, isGame = false) => ({
  packageName,
  appLabel,
  minutes,
  ms: minutes * 60000,
  launches,
  isGame,
});

/**
 * Rich “today” snapshot for presentation mode (same shape as getUsageStats()).
 */
const buildPresentationDemoTodayStats = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dayType = calendarDayType(now);

  const screenTimeApps = [
    mkDemoAppRow('com.instagram.android', 'Instagram', 128, 44),
    mkDemoAppRow('com.google.android.youtube', 'YouTube', 96, 21),
    mkDemoAppRow('com.whatsapp', 'WhatsApp', 72, 31),
    mkDemoAppRow('com.android.chrome', 'Chrome', 58, 36),
    mkDemoAppRow('com.zhiliaoapp.musically', 'TikTok', 52, 17),
    mkDemoAppRow('com.facebook.katana', 'Facebook', 41, 14),
    mkDemoAppRow('com.netflix.mediaclient', 'Netflix', 34, 5),
    mkDemoAppRow('com.spotify.music', 'Spotify', 22, 7),
    mkDemoAppRow('com.google.android.gm', 'Gmail', 18, 12),
    mkDemoAppRow('com.google.android.apps.messaging', 'Messages', 11, 9),
  ];

  const socialAppsBreakdown = [
    mkDemoAppRow('com.instagram.android', 'Instagram', 128, 44),
    mkDemoAppRow('com.google.android.youtube', 'YouTube', 96, 21),
    mkDemoAppRow('com.whatsapp', 'WhatsApp', 72, 31),
    mkDemoAppRow('com.zhiliaoapp.musically', 'TikTok', 52, 17),
    mkDemoAppRow('com.facebook.katana', 'Facebook', 41, 14),
  ];

  const communicationAppsBreakdown = [
    mkDemoAppRow('com.whatsapp', 'WhatsApp', 72, 31),
    mkDemoAppRow('com.google.android.gm', 'Gmail', 18, 12),
    mkDemoAppRow('com.google.android.apps.messaging', 'Messages', 11, 9),
  ];

  const entertainmentAppsBreakdown = [
    mkDemoAppRow('com.google.android.youtube', 'YouTube', 96, 21),
    mkDemoAppRow('com.android.chrome', 'Chrome', 58, 36),
    mkDemoAppRow('com.netflix.mediaclient', 'Netflix', 34, 5),
    mkDemoAppRow('com.spotify.music', 'Spotify', 22, 7),
    mkDemoAppRow('com.zhiliaoapp.musically', 'TikTok', 52, 17),
  ];

  const nightApps = [
    mkDemoAppRow('com.instagram.android', 'Instagram', 38, 6),
    mkDemoAppRow('com.zhiliaoapp.musically', 'TikTok', 24, 5),
    mkDemoAppRow('com.android.chrome', 'Chrome', 14, 4),
  ];

  const launchesByApp = [...screenTimeApps].sort((a, b) => b.launches - a.launches);

  const locationPlaces = [
    {
      id: 'demo-home',
      title: 'Home',
      sampleCount: 8,
      coordsLine: 'approx. 12.97° N, 77.59° E',
    },
    {
      id: 'demo-work',
      title: 'Work / campus',
      sampleCount: 5,
      coordsLine: 'approx. 12.93° N, 77.62° E',
    },
    {
      id: 'demo-cafe',
      title: 'Café',
      sampleCount: 2,
      coordsLine: 'approx. 12.95° N, 77.60° E',
    },
  ];

  const locationMeta = {
    dayType,
    pointsCollected: 15,
    clusterRadiusM: 300,
    segmentMinM: 100,
    sampleIntervalMins: 15,
  };

  return {
    date: formatLocalYmd(start),
    totalScreenTime: 312,
    socialAppTime: 198,
    communicationTime: 55,
    entertainmentTime: 165,
    appVarietyCount: 14,
    appLaunches: 186,
    nightUsage: 72,
    locationVariety: 3,
    homeStayDuration: 0,
    mobilityRadius: 14.2,
    mobilityKm: 14.2,
    dayType,
    locationPlaces,
    locationMeta,
    pointsCollected: 15,
    timestamp: now.getTime(),
    screenTimeApps,
    socialAppsBreakdown,
    communicationAppsBreakdown,
    entertainmentAppsBreakdown,
    nightApps,
    launchesByApp,
  };
};

const getFirstInstallTimeMs = async () => {
  try {
    if (!UsageStatsModule?.getFirstInstallTime) return 0;
    const t = await UsageStatsModule.getFirstInstallTime();
    return typeof t === 'number' && !Number.isNaN(t) ? t : 0;
  } catch {
    return 0;
  }
};

/**
 * If the app was reinstalled or AsyncStorage was restored from backup, stored install time
 * won't match PackageManager.firstInstallTime — clear usage history and reset monitoring.
 */
const ensureInstallConsistency = async () => {
  const firstInstall = await getFirstInstallTimeMs();
  if (firstInstall <= 0) return;
  try {
    const raw = await AsyncStorage.getItem(KEYS.APP_INSTALL_TIME_MS);
    if (raw == null || raw === '') {
      await AsyncStorage.setItem(KEYS.APP_INSTALL_TIME_MS, String(firstInstall));
      return;
    }
    const prev = Number(raw);
    if (Number.isNaN(prev) || prev !== firstInstall) {
      await AsyncStorage.multiRemove([
        KEYS.DAILY_USAGE,
        KEYS.BASELINE,
        KEYS.RISK_HISTORY,
        KEYS.MONITORING_START_TS,
      ]);
      await AsyncStorage.setItem(KEYS.APP_INSTALL_TIME_MS, String(firstInstall));
      await AsyncStorage.setItem(KEYS.MONITORING_START_TS, String(Date.now()));
    }
  } catch (error) {
    console.log('ensureInstallConsistency error:', error);
  }
};

/** When MindGuard first ran this install — usage queries are clipped to this instant onward. */
const ensureMonitoringStartTs = async () => {
  const firstInstall = await getFirstInstallTimeMs();
  try {
    const raw = await AsyncStorage.getItem(KEYS.MONITORING_START_TS);
    let stored = null;
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (!Number.isNaN(n)) stored = n;
    }
    let candidate;
    if (stored == null) {
      candidate = Date.now();
    } else {
      candidate = Math.max(stored, firstInstall);
    }
    const clamped = Math.min(candidate, Date.now());
    if (stored == null || clamped !== stored) {
      await AsyncStorage.setItem(KEYS.MONITORING_START_TS, String(clamped));
    }
    return clamped;
  } catch (error) {
    console.log('ensureMonitoringStartTs error:', error);
    return Date.now();
  }
};

const getMonitoringStartTs = async () => ensureMonitoringStartTs();

// Persist only aggregates — per-app breakdowns stay in memory for the session
const slimDailyUsage = (data) => ({
  date: data.date,
  totalScreenTime: data.totalScreenTime,
  socialAppTime: data.socialAppTime,
  communicationTime: data.communicationTime,
  entertainmentTime: data.entertainmentTime,
  appVarietyCount: data.appVarietyCount,
  appLaunches: data.appLaunches,
  nightUsage: data.nightUsage,
  locationVariety: data.locationVariety,
  homeStayDuration: 0,
  mobilityRadius: data.mobilityRadius,
  dayType: data.dayType === 'weekend' ? 'weekend' : 'weekday',
  timestamp: data.timestamp,
});

// Save today's usage data (one row per calendar day; refresh updates same day)
const saveDailyUsage = async (data) => {
  try {
    const slim = slimDailyUsage(data);
    const existing = await getDailyUsageHistory();
    const idx = existing.findIndex((d) => d.date === slim.date);
    let updated;
    if (idx >= 0) {
      updated = [...existing];
      updated[idx] = slim;
    } else {
      updated = [...existing, slim];
    }
    // Keep only last 30 days
    const last30 = updated.slice(-30);
    await AsyncStorage.setItem(KEYS.DAILY_USAGE, JSON.stringify(last30));
    return true;
  } catch (error) {
    console.log('Save daily usage error:', error);
    return false;
  }
};

// Get all daily usage history
const getDailyUsageHistory = async () => {
  try {
    const data = await AsyncStorage.getItem(KEYS.DAILY_USAGE);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.log('Get daily usage error:', error);
    return [];
  }
};

// Save baseline
const saveBaseline = async (baseline) => {
  try {
    await AsyncStorage.setItem(KEYS.BASELINE, JSON.stringify(baseline));
    return true;
  } catch (error) {
    console.log('Save baseline error:', error);
    return false;
  }
};

// Get baseline
const getBaseline = async () => {
  try {
    const data = await AsyncStorage.getItem(KEYS.BASELINE);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.log('Get baseline error:', error);
    return null;
  }
};

// Save risk score
const saveRiskScore = async (riskData) => {
  try {
    const existing = await getRiskHistory();
    const updated = [...existing, riskData];
    const last30 = updated.slice(-30);
    await AsyncStorage.setItem(KEYS.RISK_HISTORY, JSON.stringify(last30));
    return true;
  } catch (error) {
    console.log('Save risk score error:', error);
    return false;
  }
};

// Get risk history
const getRiskHistory = async () => {
  try {
    const data = await AsyncStorage.getItem(KEYS.RISK_HISTORY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.log('Get risk history error:', error);
    return [];
  }
};

// Clear all data
const clearAllData = async () => {
  try {
    await AsyncStorage.multiRemove(Object.values(KEYS));
    return true;
  } catch (error) {
    console.log('Clear data error:', error);
    return false;
  }
};

/**
 * Writes a week of sample history (skips the 7-day learning gate) and enables a
 * local-only “today” overlay for demos. Does not upload data.
 */
const injectPresentationDemoData = async () => {
  try {
    const fakeHistory = [];
    const now = new Date();

    for (let i = 7; i > 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

      fakeHistory.push({
        date: formatLocalYmd(d),
        totalScreenTime: isWeekend ? 300 : 205,
        socialAppTime: isWeekend ? 165 : 85,
        communicationTime: isWeekend ? 45 : 58,
        entertainmentTime: isWeekend ? 95 : 55,
        appVarietyCount: 12,
        appLaunches: 78,
        nightUsage: isWeekend ? 55 : 12,
        locationVariety: 3,
        homeStayDuration: 0,
        mobilityRadius: isWeekend ? 14.2 : 22.5,
        dayType: isWeekend ? 'weekend' : 'weekday',
        timestamp: d.getTime(),
      });
    }

    await AsyncStorage.setItem(KEYS.DAILY_USAGE, JSON.stringify(fakeHistory));

    const { calculateBaseline } = require('../analysis/BehaviorAnalyzer');
    const bl = calculateBaseline(fakeHistory);
    await saveBaseline(bl);

    await AsyncStorage.setItem(KEYS.DEMO_TODAY_STATS, JSON.stringify(buildPresentationDemoTodayStats()));
    await AsyncStorage.setItem(KEYS.DEMO_ACTIVE, '1');

    return true;
  } catch (error) {
    console.log('Inject presentation demo error:', error);
    return false;
  }
};

const getPresentationDemoTodayStats = async () => {
  try {
    if ((await AsyncStorage.getItem(KEYS.DEMO_ACTIVE)) !== '1') return null;
    const raw = await AsyncStorage.getItem(KEYS.DEMO_TODAY_STATS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/** Removes demo overlay and stored usage aggregates (back to a clean slate on-device). */
const clearPresentationDemoData = async () => {
  try {
    await AsyncStorage.multiRemove([
      KEYS.DEMO_ACTIVE,
      KEYS.DEMO_TODAY_STATS,
      KEYS.DAILY_USAGE,
      KEYS.BASELINE,
      KEYS.RISK_HISTORY,
    ]);
    return true;
  } catch (error) {
    console.log('Clear presentation demo error:', error);
    return false;
  }
};

export {
  ensureInstallConsistency,
  ensureMonitoringStartTs,
  getMonitoringStartTs,
  getFirstInstallTimeMs,
  saveDailyUsage,
  getDailyUsageHistory,
  saveBaseline,
  getBaseline,
  saveRiskScore,
  getRiskHistory,
  clearAllData,
  injectPresentationDemoData,
  getPresentationDemoTodayStats,
  clearPresentationDemoData,
};
