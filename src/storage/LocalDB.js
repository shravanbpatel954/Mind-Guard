import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

const { UsageStatsModule } = NativeModules;

const KEYS = {
  DAILY_USAGE: 'daily_usage',
  BASELINE: 'baseline',
  RISK_HISTORY: 'risk_history',
  MONITORING_START_TS: 'monitoring_start_ts',
  APP_INSTALL_TIME_MS: 'app_install_time_ms',
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

// Inject fake 7-day data to skip the learning curve
const injectFakeBaseline = async () => {
  try {
    const fakeHistory = [];
    const now = new Date();
    
    // Generate 7 days of descending dummy history
    for (let i = 7; i > 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      
      fakeHistory.push({
        date: d.toISOString().split('T')[0],
        totalScreenTime: isWeekend ? 320 : 210, // minutes
        socialAppTime: isWeekend ? 180 : 90,
        communicationTime: isWeekend ? 40 : 60,
        entertainmentTime: isWeekend ? 100 : 60,
        appVarietyCount: 12,
        appLaunches: 80,
        nightUsage: isWeekend ? 60 : 10,
        locationVariety: 3,
        homeStayDuration: 0,
        mobilityRadius: isWeekend ? 15.5 : 25.2,
        dayType: isWeekend ? 'weekend' : 'weekday',
        timestamp: d.getTime(),
      });
    }
    
    await AsyncStorage.setItem(KEYS.DAILY_USAGE, JSON.stringify(fakeHistory));
    
    const { calculateBaseline } = require('../analysis/BehaviorAnalyzer');
    const bl = calculateBaseline(fakeHistory);
    await saveBaseline(bl);
    
    return true;
  } catch (error) {
    console.log('Inject fake data error:', error);
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
  injectFakeBaseline,
};
