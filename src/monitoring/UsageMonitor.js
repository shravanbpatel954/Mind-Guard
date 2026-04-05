import { NativeModules } from 'react-native';
import { getMonitoringStartTs } from '../storage/LocalDB';

const { UsageStatsModule } = NativeModules;

const OWN_PACKAGE = 'com.mindguard';

/** Messaging, SMS, dialer, email, video calls — foreground time in these apps (not call duration). */
const communicationPackages = new Set([
  'com.whatsapp',
  'com.whatsapp.w4b',
  'org.telegram.messenger',
  'org.telegram.messenger.web',
  'org.telegram.biftogram',
  'org.thoughtcrime.securesms',
  'jp.naver.line.android',
  'com.viber.voip',
  'com.skype.raider',
  'com.skype.m2',
  'com.google.android.apps.tachyon',
  'com.google.android.apps.messaging',
  'com.android.mms',
  'com.samsung.android.messaging',
  'com.android.dialer',
  'com.google.android.dialer',
  'com.samsung.android.dialer',
  'com.android.incallui',
  'com.samsung.android.incallui',
  'com.google.android.gm',
  'com.microsoft.office.outlook',
  'com.samsung.android.email.provider',
  'com.android.email',
  'com.microsoft.teams',
  'com.slack',
  'com.discord',
  'us.zoom.videomeetings',
  'com.zoom.videomeetings',
  'com.google.android.apps.meetings',
  'com.android.server.telecom',
  'com.truecaller',
]);

/** Streaming, music, games (also uses native isGame), browsers/news. */
const entertainmentPackages = new Set([
  'com.google.android.youtube',
  'com.google.android.youtube.music',
  'com.netflix.mediaclient',
  'com.amazon.avod.thirdpartyclient',
  'com.disney.disneyplus',
  'com.spotify.music',
  'com.apple.android.music',
  'com.amazon.mp3',
  'com.soundcloud.android',
  'tv.twitch.android.app',
  'in.startv.hotstar',
  'com.google.android.apps.youtube.kids',
  'com.android.chrome',
  'org.mozilla.firefox',
  'com.microsoft.emmx',
  'com.brave.browser',
  'com.opera.browser',
  'com.sec.android.app.sbrowser',
  'com.huawei.browser',
]);

const checkPermission = async () => {
  try {
    const granted = await UsageStatsModule.checkPermission();
    return granted;
  } catch (error) {
    console.log('Permission check error:', error);
    return false;
  }
};

const requestPermission = () => {
  try {
    const { Linking } = require('react-native');
    Linking.openSettings();
  } catch (error) {
    console.log('Permission request error:', error);
  }
};

const isUserApp = (packageName) => {
  if (packageName === OWN_PACKAGE) return false;
  const systemPrefixes = [
    'android',
    'com.android',
    'com.google.android.gms',
    'com.google.android.gsf',
    'com.google.android.inputmethod',
    'com.google.android.ext',
    'com.qualcomm',
    'com.mediatek',
    'com.lava',
    'com.miui',
    'com.oneplus',
    'com.samsung.android',
    'com.sec.android',
    'com.huawei',
    'com.qti',
    'com.vivo',
    'com.oppo',
  ];
  return !systemPrefixes.some((prefix) => packageName.startsWith(prefix));
};

const socialPackages = [
  'com.instagram.android',
  'com.whatsapp',
  'com.whatsapp.w4b',
  'com.facebook.katana',
  'com.facebook.lite',
  'com.twitter.android',
  'com.snapchat.android',
  'com.google.android.youtube',
  'com.linkedin.android',
  'com.pinterest',
  'com.reddit.frontpage',
  'com.zhiliaoapp.musically',
  'com.ss.android.ugc.trill',
];

/** Include OEM messaging/dialer & catalogued apps even when isUserApp excludes com.samsung.* etc. */
const shouldIncludeApp = (app) => {
  const pkg = app.packageName;
  if (pkg === OWN_PACKAGE) return false;
  if (communicationPackages.has(pkg)) return true;
  if (entertainmentPackages.has(pkg)) return true;
  if (socialPackages.includes(pkg)) return true;
  if (app.isGame === true) return true;
  return isUserApp(pkg);
};

const isEntertainmentApp = (app) => {
  const pkg = app.packageName;
  if (entertainmentPackages.has(pkg)) return true;
  return app.isGame === true;
};

const displayLabel = (app) => {
  if (app.appLabel && String(app.appLabel).trim()) return String(app.appLabel).trim();
  const p = app.packageName || '';
  const parts = p.split('.');
  return parts[parts.length - 1] || p;
};

const toAppRow = (app) => {
  const usageTime = app.totalTimeInForeground || 0;
  const launches = app.launchCount || 0;
  return {
    packageName: app.packageName,
    appLabel: displayLabel(app),
    minutes: Math.round(usageTime / 60000),
    ms: usageTime,
    launches,
    isGame: app.isGame === true,
  };
};

const sortByMinutesDesc = (a, b) => b.minutes - a.minutes || b.ms - a.ms;
const sortByLaunchesDesc = (a, b) => b.launches - a.launches || b.minutes - a.minutes;

const buildBreakdowns = (stats, nightStats) => {
  const todayRows = [];
  if (stats && stats.length > 0) {
    stats.forEach((app) => {
      if (!shouldIncludeApp(app)) return;
      const usageTime = app.totalTimeInForeground || 0;
      const launches = app.launchCount || 0;
      if (usageTime < 1000 && launches === 0) return;
      todayRows.push(toAppRow(app));
    });
  }
  todayRows.sort(sortByMinutesDesc);

  const socialRows = todayRows.filter((r) => socialPackages.includes(r.packageName));

  const communicationRows = todayRows.filter((r) => communicationPackages.has(r.packageName));

  const entertainmentRows = todayRows.filter((r) => {
    if (entertainmentPackages.has(r.packageName)) return true;
    return r.isGame === true;
  });

  const nightRows = [];
  if (nightStats && nightStats.length > 0) {
    nightStats.forEach((app) => {
      if (!shouldIncludeApp(app)) return;
      const usageTime = app.totalTimeInForeground || 0;
      const launches = app.launchCount || 0;
      if (usageTime < 1000 && launches === 0) return;
      nightRows.push(toAppRow(app));
    });
  }
  nightRows.sort(sortByMinutesDesc);

  const launchRows = [...todayRows].sort(sortByLaunchesDesc).filter((r) => r.launches > 0);

  return {
    screenTimeApps: todayRows,
    socialAppsBreakdown: socialRows,
    communicationAppsBreakdown: communicationRows,
    entertainmentAppsBreakdown: entertainmentRows,
    nightApps: nightRows,
    launchesByApp: launchRows,
  };
};

const getUsageStats = async () => {
  try {
    const now = new Date();
    const monitoringStart = await getMonitoringStartTs();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const todayQueryStart = Math.max(startOfDay.getTime(), monitoringStart);

    const nightStart = new Date(startOfDay);
    nightStart.setDate(nightStart.getDate() - 1);
    nightStart.setHours(23, 0, 0, 0);

    const nightEnd = new Date(startOfDay);
    nightEnd.setHours(5, 0, 0, 0);

    const nightQueryStart = Math.max(nightStart.getTime(), monitoringStart);
    const nightQueryEnd = Math.min(nightEnd.getTime(), now.getTime());

    const stats = await UsageStatsModule.getUsageStats(todayQueryStart, now.getTime());

    let nightStats = [];
    if (nightQueryStart < nightQueryEnd) {
      nightStats = await UsageStatsModule.getUsageStats(nightQueryStart, nightQueryEnd);
    }

    let totalScreenTime = 0;
    let socialAppTime = 0;
    let communicationTime = 0;
    let entertainmentTime = 0;
    let appLaunches = 0;
    let nightUsage = 0;
    let appVarietyCount = 0;

    if (stats && stats.length > 0) {
      stats.forEach((app) => {
        if (!shouldIncludeApp(app)) return;
        const usageTime = app.totalTimeInForeground || 0;
        const launches = app.launchCount || 0;
        if (usageTime < 1000 && launches === 0) return;
        appVarietyCount += 1;
        if (usageTime < 1000) return;
        totalScreenTime += usageTime;
        appLaunches += app.launchCount || 0;
        if (socialPackages.includes(app.packageName)) {
          socialAppTime += usageTime;
        }
        if (communicationPackages.has(app.packageName)) {
          communicationTime += usageTime;
        }
        if (isEntertainmentApp(app)) {
          entertainmentTime += usageTime;
        }
      });
    }

    if (nightStats && nightStats.length > 0) {
      nightStats.forEach((app) => {
        if (!shouldIncludeApp(app)) return;
        const usageTime = app.totalTimeInForeground || 0;
        nightUsage += usageTime;
      });
    }

    const breakdowns = buildBreakdowns(stats, nightStats);

    
    

    let locationVariety = 0;
    let mobilityRadius = 0;
    let mobilityKm = 0;
    let dayType = 'weekday';
    let locationPlaces = [];
    let locationMeta = null;
    let pointsCollected = 0;

    try {
      const { getLocationMetrics } = require('./LocationMonitor');
      const loc = await getLocationMetrics();
      locationVariety = loc.uniquePlaces ?? 0;
      const td = loc.totalDistanceKm ?? 0;
      mobilityRadius = td;
      mobilityKm = td;
      dayType = loc.dayType || 'weekday';
      locationPlaces = loc.locationPlaces || [];
      locationMeta = loc.locationMeta || null;
      pointsCollected = loc.pointsCollected ?? 0;
    } catch (e) {
      console.log('Location metrics skipped:', e);
    }

    const result = {
      date: startOfDay.toISOString().split('T')[0],
      totalScreenTime: Math.round(totalScreenTime / 60000),
      socialAppTime: Math.round(socialAppTime / 60000),
      communicationTime: Math.round(communicationTime / 60000),
      entertainmentTime: Math.round(entertainmentTime / 60000),
      appVarietyCount,
      appLaunches,
      nightUsage: Math.round(nightUsage / 60000),
      locationVariety,
      homeStayDuration: 0,
      mobilityRadius,
      mobilityKm,
      dayType,
      locationPlaces,
      locationMeta,
      pointsCollected,
      timestamp: now.getTime(),
      ...breakdowns,
    };

    return result;
  } catch (error) {
    console.log('Usage stats error:', error);
    return null;
  }
};

export { checkPermission, requestPermission, getUsageStats };
