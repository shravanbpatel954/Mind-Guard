import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  FlatList,
  AppState,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { checkPermission, getUsageStats } from '../monitoring/UsageMonitor';
import {
  requestLocationPermission,
  recordLocationSnapshot,
  LOCATION_CHECK_INTERVAL_MINUTES,
  getDayType,
} from '../monitoring/LocationMonitor';
import { analyzeWithML } from '../ml/MLAnalyzer';
import { sendRiskAlert } from '../alerts/AlertManager';
import { startLiveLocationSharing } from '../monitoring/LiveLocationSharing';
import { calculateBaseline } from '../analysis/BehaviorAnalyzer';
import {
  ensureInstallConsistency,
  ensureMonitoringStartTs,
  saveDailyUsage,
  getDailyUsageHistory,
  saveBaseline,
  saveRiskScore,
  getPresentationDemoTodayStats,
} from '../storage/LocalDB';
import DashboardHeader from '../components/DashboardHeader';
import { setCallStatus } from '../calls/CallSignalingService';

const { width } = Dimensions.get('window');

/** Deepest focused route in the root stack (avoids popping an active Call when ML opens Chat). */
function getFocusedRouteName(state) {
  if (!state?.routes?.length) return undefined;
  const route = state.routes[state.index];
  if (!route) return undefined;
  if (route.state) return getFocusedRouteName(route.state);
  return route.name;
}

// ─────────────────────────────────────────────
// HELPER: convert minutes to "Xh Ym" string
// ─────────────────────────────────────────────
const fmtMins = (mins) => {
  if (!mins || mins === 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

// ─────────────────────────────────────────────
// RISK CONFIG — one place to read/change rules
// ─────────────────────────────────────────────
const RISK_CONFIG = {
  NORMAL: { color: '#22c55e', bg: '#f0fdf4', label: 'All Good', emoji: '🟢', msg: 'Your patterns look normal today.' },
  MODERATE: { color: '#f59e0b', bg: '#fffbeb', label: 'Watch Out', emoji: '🟡', msg: 'Some changes detected. Take a break if needed.' },
  HIGH: { color: '#ef4444', bg: '#fef2f2', label: 'Check In', emoji: '🔴', msg: 'Significant changes detected. How are you feeling?' },
};

const DETAIL_CONFIG = {
  screen: {
    title: 'Screen time by app',
    empty:
      'No app usage in this period yet. Counts only usage since you opened MindGuard on this install.',
    mode: 'time',
  },
  social: {
    title: 'Social & video apps',
    empty:
      'None of the social apps MindGuard tracks (Instagram, WhatsApp, YouTube, TikTok, etc.) were used in this window.',
    mode: 'time',
  },
  night: {
    title: 'Night use (11pm–5am)',
    empty:
      'No tracked apps were used during the night window (11pm–5am) in this period.',
    mode: 'time',
  },
  launches: {
    title: 'App opens by app',
    empty: 'No app open events recorded in this period.',
    mode: 'launches',
  },
  communication: {
    title: 'Communication apps',
    empty:
      'No messaging, email, or phone apps MindGuard tracks were used in this window. Dialer time is foreground time, not call length.',
    mode: 'time',
  },
  entertainment: {
    title: 'Entertainment, games & browsers',
    empty:
      'No streaming, music, browser, or game apps were used in this window. Games are detected via the Play Store “game” flag on your device.',
    mode: 'time',
  },
  variety: {
    title: 'Apps used (variety)',
    empty: 'No qualifying app usage in this period.',
    mode: 'time',
  },
};

const DETAIL_ROW_KEYS = {
  screen: 'screenTimeApps',
  social: 'socialAppsBreakdown',
  night: 'nightApps',
  launches: 'launchesByApp',
  communication: 'communicationAppsBreakdown',
  entertainment: 'entertainmentAppsBreakdown',
  variety: 'screenTimeApps',
};

const LOCATION_MODAL_KEYS = new Set(['locPlaces', 'locDistance']);

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

const StatCard = ({ emoji, value, label, sub, onPress }) => {
  const inner = (
    <>
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
      {onPress ? <Text style={styles.statTapHint}>Tap for details</Text> : null}
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={styles.statCard} onPress={onPress} activeOpacity={0.75}>
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.statCard}>{inner}</View>;
};

const UsageDetailModal = ({ visible, config, rows, subtitle, onClose }) => {
  if (!config) return null;
  const mode = config.mode;

  const renderItem = ({ item }) => (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        <Text style={styles.detailAppName}>{item.appLabel}</Text>
        <Text style={styles.detailPkg} numberOfLines={1}>
          {item.packageName}
        </Text>
      </View>
      <View style={styles.detailRight}>
        {mode === 'time' ? (
          <>
            <Text style={styles.detailPrimary}>{fmtMins(item.minutes)}</Text>
            {item.launches > 0 ? (
              <Text style={styles.detailSecondary}>{item.launches} opens</Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.detailPrimary}>{item.launches} opens</Text>
            <Text style={styles.detailSecondary}>{fmtMins(item.minutes)}</Text>
          </>
        )}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close details"
        />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{config.title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            App names and package IDs are from your device. Nothing is uploaded.
          </Text>
          {subtitle ? <Text style={styles.modalSubtitle}>{subtitle}</Text> : null}
          {rows.length === 0 ? (
            <Text style={styles.modalEmpty}>{config.empty}</Text>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.packageName}
              renderItem={renderItem}
              style={styles.modalList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const LocationDetailModal = ({ visible, kind, todayStats, onClose }) => {
  if (!visible || !kind) return null;
  const meta = todayStats?.locationMeta;
  const places = todayStats?.locationPlaces || [];
  const dayType = todayStats?.dayType || getDayType();
  const title =
    kind === 'locPlaces' ? 'Areas today' : 'Trip distance (estimate)';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close location details"
        />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.locScroll} showsVerticalScrollIndicator={false}>
            {kind === 'locPlaces' && (
              <>
                <Text style={styles.locIntro}>
                  MindGuard records about one location sample every {LOCATION_CHECK_INTERVAL_MINUTES}{' '}
                  minutes while the app is open. Readings within roughly {meta?.clusterRadiusM ?? 300} m
                  of each other are grouped as one area. Coordinates are approximate and stay on your
                  phone.
                </Text>
                <Text style={styles.locIntro}>
                  Today is treated as a <Text style={styles.locBold}>{dayType}</Text> for the risk model
                  (weekends and weekdays use different baselines).
                </Text>
                {places.length === 0 ? (
                  <Text style={styles.modalEmpty}>
                    No areas yet. Samples appear after MindGuard runs and the timer fires.
                  </Text>
                ) : (
                  places.map((p) => (
                    <View key={p.id} style={styles.locPlaceBlock}>
                      <Text style={styles.locPlaceTitle}>
                        {p.title} — {p.sampleCount} sample{p.sampleCount !== 1 ? 's' : ''}
                      </Text>
                      <Text style={styles.locPlaceLine}>Centre ≈ {p.coordsLine}</Text>
                    </View>
                  ))
                )}
              </>
            )}
            {kind === 'locDistance' && (
              <>
                <Text style={styles.locIntro}>
                  <Text style={styles.locBold}>Trip distance</Text> here means the sum of straight-line
                  gaps between consecutive samples when each gap is larger than about{' '}
                  {meta?.segmentMinM ?? 100} m (smaller jumps are treated as GPS noise).
                </Text>
                <Text style={styles.locIntro}>
                  It is not your car odometer — just movement inferred from sparse phone checks.
                </Text>
                <View style={styles.locStatBox}>
                  <Text style={styles.locStatLine}>
                    Total today:{' '}
                    {todayStats?.mobilityRadius != null ? `${todayStats.mobilityRadius} km` : '—'}
                  </Text>
                  <Text style={styles.locStatLine}>
                    Samples today: {meta?.pointsCollected ?? todayStats?.pointsCollected ?? '—'}
                  </Text>
                  <Text style={styles.locStatLine}>
                    ML uses the <Text style={styles.locBold}>{dayType}</Text> model (weekday vs weekend
                    isolation forest).
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const InsightRow = ({ text, color }) => (
  <View style={[styles.insightRow, { borderLeftColor: color }]}>
    <Text style={styles.insightText}>{text}</Text>
  </View>
);

const ProgressBar = ({ value, max, color }) => {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
};

// ─────────────────────────────────────────────
// PERMISSION SCREEN
// ─────────────────────────────────────────────
const PermissionScreen = ({ onDone, onOpenSettings }) => (
  <View style={styles.permScreen}>
    {onOpenSettings ? (
      <View style={styles.permHeader}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onOpenSettings} style={styles.permSettingsBtn} hitSlop={12}>
          <Text style={styles.permSettingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    <View style={styles.permInner}>
      <Text style={styles.permEmoji}>🔐</Text>
      <Text style={styles.permTitle}>One permission needed</Text>
      <Text style={styles.permBody}>
        MindGuard needs to read your app usage data to detect changes in your
        digital behaviour. This data{' '}
        <Text style={styles.bold}>never leaves your phone</Text> — it is
        analysed on-device only.
      </Text>

      <Text style={styles.permStepsIntro}>
        On Android you can enable this manually:
      </Text>
      <View style={styles.permSteps}>
        <Text style={styles.permStep}>1. Open Settings</Text>
        <Text style={styles.permStep}>2. Go to Apps</Text>
        <Text style={styles.permStep}>3. Open Special app access</Text>
        <Text style={styles.permStep}>4. Tap Usage access</Text>
        <Text style={styles.permStep}>5. Find MindGuard and turn usage access on</Text>
        <Text style={styles.permStep}>6. Return here and tap Done — we&apos;ll check if access is granted</Text>
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onDone}>
        <Text style={styles.primaryBtnText}>Done</Text>
      </TouchableOpacity>
    </View>
  </View>
);

// ─────────────────────────────────────────────
// LEARNING SCREEN (days 1-6)
// ─────────────────────────────────────────────
const LearningScreen = ({ daysTracked, todayStats, onRefresh, onOpenDetail, onOpenSettings }) => (
  <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
    {onOpenSettings ? (
      <DashboardHeader
        title="MindGuard"
        subtitle="Learning your baseline"
        onOpenSettings={onOpenSettings}
      />
    ) : null}
    <View style={styles.section}>
      <Text style={styles.pageTitle}>Learning Your Pattern</Text>
      <Text style={styles.pageSubtitle}>
        MindGuard needs 7 days to understand what "normal" looks like for you.
        After that it will detect changes automatically. Numbers reflect phone use
        since you opened MindGuard on this install — not earlier in the day before that.
      </Text>
    </View>

    {/* Progress bar */}
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Days tracked</Text>
      <Text style={styles.learningCount}>
        {daysTracked} <Text style={styles.learningOf}>/ 7</Text>
      </Text>
      <ProgressBar value={daysTracked} max={7} color="#6366f1" />
      <Text style={styles.learningHint}>
        {7 - daysTracked} more day{7 - daysTracked !== 1 ? 's' : ''} until analysis begins
      </Text>
    </View>

    {/* Today's raw data — so the user can see it IS working */}
    {todayStats && (
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Today's data (collected ✓)</Text>
        <Text style={styles.dayTypePill}>
          {todayStats.dayType === 'weekend' ? 'Weekend' : 'Weekday'} · separate ML baseline for today
        </Text>
        <View style={styles.statsGrid}>
          <StatCard
            emoji="📱"
            value={fmtMins(todayStats.totalScreenTime)}
            label="Screen time"
            onPress={onOpenDetail ? () => onOpenDetail('screen') : undefined}
          />
          <StatCard
            emoji="💬"
            value={fmtMins(todayStats.socialAppTime)}
            label="Social apps"
            onPress={onOpenDetail ? () => onOpenDetail('social') : undefined}
          />
          <StatCard
            emoji="🌙"
            value={fmtMins(todayStats.nightUsage)}
            label="Night use"
            onPress={onOpenDetail ? () => onOpenDetail('night') : undefined}
          />
          <StatCard
            emoji="🔓"
            value={todayStats.appLaunches || '—'}
            label="App opens"
            onPress={onOpenDetail ? () => onOpenDetail('launches') : undefined}
          />
          <StatCard
            emoji="📞"
            value={fmtMins(todayStats.communicationTime)}
            label="Communication"
            onPress={onOpenDetail ? () => onOpenDetail('communication') : undefined}
          />
          <StatCard
            emoji="🎮"
            value={fmtMins(todayStats.entertainmentTime)}
            label="Entertainment"
            onPress={onOpenDetail ? () => onOpenDetail('entertainment') : undefined}
          />
          <StatCard
            emoji="🔄"
            value={todayStats.appVarietyCount != null ? String(todayStats.appVarietyCount) : '—'}
            label="App variety"
            sub="unique apps"
            onPress={onOpenDetail ? () => onOpenDetail('variety') : undefined}
          />
          <StatCard
            emoji="📍"
            value={todayStats.locationVariety != null ? String(todayStats.locationVariety) : '—'}
            label="Areas today"
            sub="Grouped GPS samples"
            onPress={onOpenDetail ? () => onOpenDetail('locPlaces') : undefined}
          />
          <StatCard
            emoji="🚶"
            value={todayStats.mobilityRadius != null ? `${todayStats.mobilityRadius} km` : '—'}
            label="Trip distance"
            sub="Between samples > 100m"
            onPress={onOpenDetail ? () => onOpenDetail('locDistance') : undefined}
          />
        </View>
      </View>
    )}

    <TouchableOpacity style={styles.outlineBtn} onPress={onRefresh}>
      <Text style={styles.outlineBtnText}>↻  Refresh data</Text>
    </TouchableOpacity>
  </ScrollView>
);

// ─────────────────────────────────────────────
// MAIN DASHBOARD (day 7+)
// ─────────────────────────────────────────────
const MainDashboard = ({
  todayStats,
  baseline,
  riskLevel,
  riskScore,
  deviations,
  onRefresh,
  onOpenDetail,
  onOpenSettings,
}) => {
  const risk = RISK_CONFIG[riskLevel] || RISK_CONFIG.NORMAL;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {onOpenSettings ? (
        <DashboardHeader
          title="MindGuard"
          subtitle="Today vs your patterns"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {/* ── RISK CARD ── */}
      <View style={[styles.riskCard, { backgroundColor: risk.bg, borderColor: risk.color }]}>
        <View style={styles.riskTop}>
          <Text style={styles.riskEmoji}>{risk.emoji}</Text>
          <View style={styles.riskTextBlock}>
            <Text style={[styles.riskLabel, { color: risk.color }]}>{risk.label}</Text>
            <Text style={styles.riskMsg}>{risk.msg}</Text>
          </View>
        </View>

        {/* Score bar */}
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>Risk score</Text>
          <Text style={[styles.scoreNum, { color: risk.color }]}>{riskScore}%</Text>
        </View>
        <ProgressBar value={riskScore} max={100} color={risk.color} />

        {/* Plain-English explanation */}
        <Text style={styles.riskExplain}>
          ML risk score (0–100%) uses screen, social, night, communication, entertainment, app
          variety, and location (areas + trip distance). Weekdays and weekends use different
          on-device models so staying home Saturday can still look normal. Not a medical diagnosis.
        </Text>
        <Text style={styles.riskDayType}>
          Today&apos;s model: {todayStats?.dayType === 'weekend' ? 'Weekend' : 'Weekday'} isolation
          forest
        </Text>
      </View>

      {/* ── TODAY vs BASELINE ── */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Today vs your average (tap a row for app breakdown)</Text>

        <CompareRow
          label="Screen time"
          emoji="📱"
          today={fmtMins(todayStats?.totalScreenTime)}
          avg={fmtMins(baseline?.totalScreenTime)}
          todayRaw={todayStats?.totalScreenTime}
          avgRaw={baseline?.totalScreenTime}
          onPress={onOpenDetail ? () => onOpenDetail('screen') : undefined}
        />
        <CompareRow
          label="Social apps"
          emoji="💬"
          today={fmtMins(todayStats?.socialAppTime)}
          avg={fmtMins(baseline?.socialAppTime)}
          todayRaw={todayStats?.socialAppTime}
          avgRaw={baseline?.socialAppTime}
          onPress={onOpenDetail ? () => onOpenDetail('social') : undefined}
        />
        <CompareRow
          label="Night usage"
          emoji="🌙"
          today={fmtMins(todayStats?.nightUsage)}
          avg={fmtMins(baseline?.nightUsage)}
          todayRaw={todayStats?.nightUsage}
          avgRaw={baseline?.nightUsage}
          onPress={onOpenDetail ? () => onOpenDetail('night') : undefined}
        />
        <CompareRow
          label="App opens (total)"
          emoji="🔓"
          today={String(todayStats?.appLaunches ?? '—')}
          avg={baseline?.appLaunches != null ? String(Math.round(baseline.appLaunches)) : '—'}
          todayRaw={todayStats?.appLaunches}
          avgRaw={baseline?.appLaunches}
          onPress={onOpenDetail ? () => onOpenDetail('launches') : undefined}
        />
        <CompareRow
          label="Communication"
          emoji="📞"
          today={fmtMins(todayStats?.communicationTime)}
          avg={fmtMins(baseline?.communicationTime)}
          todayRaw={todayStats?.communicationTime}
          avgRaw={baseline?.communicationTime}
          onPress={onOpenDetail ? () => onOpenDetail('communication') : undefined}
        />
        <CompareRow
          label="Entertainment & games"
          emoji="🎮"
          today={fmtMins(todayStats?.entertainmentTime)}
          avg={fmtMins(baseline?.entertainmentTime)}
          todayRaw={todayStats?.entertainmentTime}
          avgRaw={baseline?.entertainmentTime}
          onPress={onOpenDetail ? () => onOpenDetail('entertainment') : undefined}
        />
        <CompareRow
          label="App variety"
          emoji="🔄"
          today={todayStats?.appVarietyCount != null ? String(todayStats.appVarietyCount) : '—'}
          avg={baseline?.appVarietyCount != null ? String(Math.round(baseline.appVarietyCount)) : '—'}
          todayRaw={todayStats?.appVarietyCount}
          avgRaw={baseline?.appVarietyCount}
          onPress={onOpenDetail ? () => onOpenDetail('variety') : undefined}
        />
        <CompareRow
          label="Areas today"
          emoji="📍"
          today={todayStats?.locationVariety != null ? String(todayStats.locationVariety) : '—'}
          avg={baseline?.locationVariety != null ? String(Math.round(baseline.locationVariety)) : '—'}
          todayRaw={todayStats?.locationVariety}
          avgRaw={baseline?.locationVariety}
          onPress={onOpenDetail ? () => onOpenDetail('locPlaces') : undefined}
        />
        <CompareRow
          label="Trip distance"
          emoji="🚶"
          today={todayStats?.mobilityRadius != null ? `${todayStats.mobilityRadius} km` : '—'}
          avg={baseline?.mobilityRadius != null ? `${Math.round(baseline.mobilityRadius * 10) / 10} km` : '—'}
          todayRaw={todayStats?.mobilityRadius}
          avgRaw={baseline?.mobilityRadius}
          onPress={onOpenDetail ? () => onOpenDetail('locDistance') : undefined}
        />
      </View>

      {/* ── WHAT CHANGED ── */}
      {deviations.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>What changed today</Text>
          {deviations.map((d, i) => (
            <InsightRow key={i} text={d} color={RISK_CONFIG[riskLevel]?.color || '#f59e0b'} />
          ))}
          <Text style={styles.deviationNote}>
            These are observations, not diagnoses. Changes in digital behaviour
            can have many causes.
          </Text>
        </View>
      )}

      {/* ── REFRESH ── */}
      <TouchableOpacity style={styles.outlineBtn} onPress={onRefresh}>
        <Text style={styles.outlineBtnText}>↻  Refresh data</Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
};

// Compare row: today vs average with a small indicator
const CompareRow = ({ label, emoji, today, avg, todayRaw, avgRaw, onPress }) => {
  const diff =
    avgRaw != null && avgRaw > 0 && todayRaw != null ? ((todayRaw - avgRaw) / avgRaw) * 100 : 0;
  const arrow = diff > 10 ? '↑' : diff < -10 ? '↓' : '→';
  const arrowColor = diff < -20 ? '#ef4444' : diff > 20 ? '#f59e0b' : '#22c55e';

  const inner = (
    <>
      <Text style={styles.compareEmoji}>{emoji}</Text>
      <Text style={styles.compareLabel}>{label}</Text>
      <View style={styles.compareValues}>
        <Text style={styles.compareToday}>{today}</Text>
        <Text style={[styles.compareArrow, { color: arrowColor }]}>{arrow}</Text>
        <Text style={styles.compareAvg}>avg {avg}</Text>
      </View>
      {onPress ? <Text style={styles.compareChevron}>›</Text> : null}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.compareRow} onPress={onPress} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.compareRow}>{inner}</View>;
};

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
const UserDashboard = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [hasPermission, setHasPerm] = useState(false);
  const [todayStats, setTodayStats] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [riskLevel, setRiskLevel] = useState('NORMAL');
  const [riskScore, setRiskScore] = useState(0);
  const [deviations, setDeviations] = useState([]);
  const [daysTracked, setDaysTracked] = useState(0);
  const [detailModal, setDetailModal] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  /** Tracks last risk level we already surfaced to the user (popup + CalmBot). */
  const lastUserRiskPopupRef = useRef(null);

  useEffect(() => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;

    // Listen for call requests addressed to this user.
    // Avoid composite-index requirements by filtering status client-side.
    const unsub = firestore()
      .collection('call_sessions')
      .where('calleeId', '==', uid)
      .limit(10)
      .onSnapshot(
        (snap) => {
          const now = Date.now();
          const pending = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((c) => c.status === 'pending' && (c.expiresAtMs || 0) > now)
            .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))[0];
          setIncomingCall(pending || null);
        },
        (e) => console.log('Incoming call listener error', e),
      );

    return () => unsub();
  }, []);

  const acceptIncomingCall = async () => {
    if (!incomingCall?.id) return;
    const id = incomingCall.id;
    const mode = incomingCall.mode || 'voice';
    try {
      await setCallStatus(id, 'accepted');
      setIncomingCall(null);
      if (navigation.push) {
        navigation.push('Call', { callId: id, role: 'callee', mode });
      } else {
        navigation.navigate('Call', { callId: id, role: 'callee', mode });
      }
    } catch (e) {
      Alert.alert('Error', 'Could not accept call. Please try again.');
    }
  };

  const declineIncomingCall = async () => {
    if (!incomingCall?.id) return;
    try {
      await setCallStatus(incomingCall.id, 'declined');
      setIncomingCall(null);
    } catch (e) {
      Alert.alert('Error', 'Could not decline call.');
    }
  };

  const loadAndAnalyze = useCallback(async () => {
    const demoToday = await getPresentationDemoTodayStats();
    let stats = await getUsageStats();
    if (demoToday) stats = demoToday;
    else if (!stats) return;

    setTodayStats(stats);

    try {
      await saveDailyUsage(stats);
    } catch (e) {
      console.log('save error', e);
    }

    let history = [];
    try {
      history = await getDailyUsageHistory();
    } catch (e) {
      console.log('history error', e);
    }
    setDaysTracked(history.length);

    if (history.length >= 7) {
      const last7 = history.slice(-7);
      const bl = calculateBaseline(last7);
      try {
        await saveBaseline(bl);
      } catch (e) {
        console.log('save baseline error', e);
      }
      setBaseline(bl);
    } else {
      setBaseline(null);
    }

    if (history.length < 7) return;

    let result;
    try {
      result = analyzeWithML(stats);
    } catch (e) {
      console.log('ML analyze error:', e);
      result = {
        riskLevel: 'NORMAL',
        riskScore: 0,
        deviations: [],
      };
    }
    setRiskLevel(result.riskLevel);
    setRiskScore(result.riskScore);
    setDeviations(result.deviations);

    if (result.riskLevel !== 'NORMAL') {
      try {
        const alertInfo = await sendRiskAlert(result.riskLevel, result.riskScore, result.deviations);
        if (alertInfo?.alertId) {
          startLiveLocationSharing(alertInfo.alertId, alertInfo.expiresAtMs);
        }
      } catch (e) {
        console.log('sendRiskAlert error:', e);
      }
    }

    // 7. Save risk record (same in presentation demo mode for end-to-end testing)
    try {
      await saveRiskScore({
        date: stats.date,
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
      });
    } catch (e) { }

    // 8. ML risk → CalmBot: HIGH always opens Chat (same as original app); ref only throttles the extra Alert.
    const rl = String(result.riskLevel || 'NORMAL').toUpperCase();
    if (rl === 'NORMAL') {
      lastUserRiskPopupRef.current = 'NORMAL';
    } else if (navigation) {
      if (rl === 'HIGH') {
        setTimeout(() => {
          if (getFocusedRouteName(navigation.getState?.()) === 'Call') {
            return;
          }
          try {
            navigation.navigate('Chat', { riskLevel: 'HIGH' });
          } catch (e) {
            console.log('Navigate to Chat skipped:', e);
          }
          if (lastUserRiskPopupRef.current !== 'HIGH') {
            lastUserRiskPopupRef.current = 'HIGH';
            Alert.alert(
              'MindGuard',
              'Your patterns today look notably different from usual. CalmBot is opening for a private check-in.',
              [{ text: 'OK' }],
            );
          }
        }, 0);
      } else if (rl === 'MODERATE') {
        const p = lastUserRiskPopupRef.current;
        if (p === 'NORMAL' || p === null) {
          lastUserRiskPopupRef.current = 'MODERATE';
          Alert.alert(
            'MindGuard',
            'Some shifts showed up in today’s patterns. You can open CalmBot for a gentle check-in.',
            [
              {
                text: 'Open CalmBot',
                onPress: () => {
                  try {
                    if (getFocusedRouteName(navigation.getState?.()) === 'Call') return;
                    navigation.navigate('Chat', { riskLevel: 'MODERATE' });
                  } catch (e) {
                    console.log('Navigate to Chat skipped:', e);
                  }
                },
              },
              { text: 'Later', style: 'cancel' },
            ],
          );
        }
      }
    }
  }, [navigation]);

  const init = useCallback(async () => {
    setLoading(true);
    try {
      await ensureInstallConsistency();
      await ensureMonitoringStartTs();

      try {
        await requestLocationPermission();
      } catch (e) {
        console.log('Location init skipped:', e);
      }

      const granted = await checkPermission();
      setHasPerm(granted);
      if (granted) await loadAndAnalyze();
    } catch (e) {
      console.log('Dashboard init error:', e);
    } finally {
      setLoading(false);
    }
  }, [loadAndAnalyze]);

  useEffect(() => {
    init();

    const intervalMs = LOCATION_CHECK_INTERVAL_MINUTES * 60 * 1000;

    const recordOnce = async () => {
      try {
        await recordLocationSnapshot();
      } catch (e) {
        console.log('Location record error:', e);
      }
    };

    recordOnce();

    const locationInterval = setInterval(() => {
      recordOnce();
    }, intervalMs);

    return () => clearInterval(locationInterval);
  }, [init]);

  useEffect(() => {
    if (!hasPermission || loading) return undefined;
    const id = setInterval(() => {
      loadAndAnalyze();
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [hasPermission, loading, loadAndAnalyze]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && hasPermission) {
        loadAndAnalyze();
      }
    });
    return () => sub.remove();
  }, [hasPermission, loadAndAnalyze]);

  // ── RENDER ──
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading your data…</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <PermissionScreen
        onDone={init}
        onOpenSettings={() => navigation.navigate('Settings')}
      />
    );
  }

  const showAppDetail = detailModal && DETAIL_CONFIG[detailModal];
  const showLocDetail = detailModal && LOCATION_MODAL_KEYS.has(detailModal);
  const detailConfig = showAppDetail ? DETAIL_CONFIG[detailModal] : null;
  const rowKey = showAppDetail ? DETAIL_ROW_KEYS[detailModal] : null;
  const detailRows =
    rowKey && todayStats ? todayStats[rowKey] || [] : [];
  const detailSubtitle =
    detailModal === 'variety' && todayStats?.appVarietyCount != null
      ? `Unique apps with meaningful use today: ${todayStats.appVarietyCount}`
      : null;

  const openDetail = (key) => setDetailModal(key);
  const closeDetail = () => setDetailModal(null);

  if (daysTracked < 7) {
    return (
      <>
        <LearningScreen
          daysTracked={daysTracked}
          todayStats={todayStats}
          onRefresh={loadAndAnalyze}
          onOpenDetail={openDetail}
          onOpenSettings={() => navigation.navigate('Settings')}
        />
        <UsageDetailModal
          visible={!!showAppDetail}
          config={detailConfig}
          rows={detailRows}
          subtitle={detailSubtitle}
          onClose={closeDetail}
        />
        <LocationDetailModal
          visible={!!showLocDetail}
          kind={showLocDetail ? detailModal : null}
          todayStats={todayStats}
          onClose={closeDetail}
        />
      </>
    );
  }

  return (
    <>
      <Modal visible={!!incomingCall} animationType="fade" transparent>
        <View style={styles.callModalRoot}>
          <View style={styles.callModalCard}>
            <Text style={styles.callModalTitle}>Incoming call</Text>
            <Text style={styles.callModalSubtitle}>
              {incomingCall?.callerName || 'Professional'} is requesting a {incomingCall?.mode === 'video' ? 'video' : 'voice'} call.
            </Text>
            <View style={styles.callBtnRow}>
              <TouchableOpacity style={styles.callDeclineBtn} onPress={declineIncomingCall}>
                <Text style={styles.callDeclineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.callAcceptBtn} onPress={acceptIncomingCall}>
                <Text style={styles.callAcceptText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <MainDashboard
        todayStats={todayStats}
        baseline={baseline}
        riskLevel={riskLevel}
        riskScore={riskScore}
        deviations={deviations}
        onRefresh={loadAndAnalyze}
        onOpenDetail={openDetail}
        onOpenSettings={() => navigation.navigate('Settings')}
      />
      <UsageDetailModal
        visible={!!showAppDetail}
        config={detailConfig}
        rows={detailRows}
        subtitle={detailSubtitle}
        onClose={closeDetail}
      />
      <LocationDetailModal
        visible={!!showLocDetail}
        kind={showLocDetail ? detailModal : null}
        todayStats={todayStats}
        onClose={closeDetail}
      />
    </>
  );
};

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  // Layout
  container: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  section: { paddingTop: 24, paddingBottom: 8 },

  // Loading
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 14 },

  // Permission screen
  permScreen: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 28, paddingTop: 16 },
  permHeader: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
  permSettingsBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  permSettingsIcon: { fontSize: 22 },
  permInner: { flex: 1, justifyContent: 'center', paddingBottom: 28 },
  permEmoji: { fontSize: 52, textAlign: 'center', marginBottom: 16 },
  permTitle: { fontSize: 22, fontWeight: '700', color: '#1e293b', textAlign: 'center', marginBottom: 12 },
  permBody: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  bold: { fontWeight: '700', color: '#1e293b' },
  permStepsIntro: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 10,
    lineHeight: 20,
  },
  permSteps: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 28, gap: 8 },
  permStep: { fontSize: 14, color: '#334155', lineHeight: 22 },

  // Primary button
  primaryBtn: { backgroundColor: '#6366f1', paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Outline button
  outlineBtn: { borderWidth: 1.5, borderColor: '#6366f1', borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 8, marginBottom: 8 },
  outlineBtnText: { color: '#6366f1', fontSize: 15, fontWeight: '600' },

  // Page headings
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
  pageSubtitle: { fontSize: 14, color: '#64748b', lineHeight: 21 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardLabel: { fontSize: 12, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  dayTypePill: {
    fontSize: 12,
    color: '#6366f1',
    fontWeight: '600',
    marginBottom: 10,
    marginTop: -4,
  },

  // Learning screen
  learningCount: { fontSize: 48, fontWeight: '800', color: '#6366f1', lineHeight: 56 },
  learningOf: { fontSize: 28, fontWeight: '400', color: '#94a3b8' },
  learningHint: { fontSize: 13, color: '#64748b', marginTop: 10 },

  // Stats grid (4 cells)
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  statCard: {
    width: (width - 40 - 10 - 36) / 2,  // 2 cols, accounting for padding + gap
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statEmoji: { fontSize: 22, marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '700', color: '#1e293b' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
  statSub: { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  statTapHint: { fontSize: 10, color: '#94a3b8', marginTop: 6, fontWeight: '500' },

  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    maxHeight: '78%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#1e293b' },
  modalClose: { fontSize: 15, fontWeight: '600', color: '#6366f1' },
  modalHint: { fontSize: 11, color: '#94a3b8', lineHeight: 16, marginBottom: 12 },
  modalSubtitle: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 12 },
  modalEmpty: { fontSize: 14, color: '#64748b', lineHeight: 21, paddingVertical: 12 },
  modalList: { flexGrow: 0 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  detailLeft: { flex: 1, paddingRight: 12 },
  detailAppName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  detailPkg: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  detailRight: { alignItems: 'flex-end' },
  detailPrimary: { fontSize: 15, fontWeight: '700', color: '#334155' },
  detailSecondary: { fontSize: 12, color: '#94a3b8', marginTop: 2 },

  // Risk card
  riskCard: {
    marginTop: 20,
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  riskTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  riskEmoji: { fontSize: 36 },
  riskTextBlock: { flex: 1 },
  riskLabel: { fontSize: 20, fontWeight: '800' },
  riskMsg: { fontSize: 13, color: '#475569', marginTop: 2, lineHeight: 18 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  scoreLabel: { fontSize: 13, color: '#64748b' },
  scoreNum: { fontSize: 13, fontWeight: '700' },
  riskExplain: { fontSize: 11, color: '#94a3b8', marginTop: 10, lineHeight: 16 },
  riskDayType: { fontSize: 11, color: '#6366f1', marginTop: 8, fontWeight: '600' },

  // Progress bar
  barTrack: { height: 8, backgroundColor: '#e2e8f0', borderRadius: 8, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 8 },

  // Compare rows
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  compareEmoji: { fontSize: 18, marginRight: 10 },
  compareLabel: { flex: 1, fontSize: 14, color: '#334155', fontWeight: '500' },
  compareValues: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compareToday: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  compareArrow: { fontSize: 16, fontWeight: '700' },
  compareAvg: { fontSize: 12, color: '#94a3b8' },
  compareChevron: { fontSize: 22, color: '#cbd5e1', fontWeight: '300', marginLeft: 4 },

  // Insights
  insightRow: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 6,
    backgroundColor: '#fafafa',
    borderRadius: 6,
  },
  insightText: { fontSize: 13, color: '#334155', lineHeight: 20 },
  deviationNote: { fontSize: 11, color: '#94a3b8', marginTop: 10, lineHeight: 16 },

  locScroll: { maxHeight: 420 },
  locIntro: { fontSize: 14, color: '#475569', lineHeight: 22, marginBottom: 14 },
  locBold: { fontWeight: '700', color: '#1e293b' },
  locPlaceBlock: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  locPlaceTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
  locPlaceLine: { fontSize: 13, color: '#334155', lineHeight: 20 },
  locStatBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  locStatLine: { fontSize: 13, color: '#334155', lineHeight: 20, marginBottom: 8 },

  callModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  callModalCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
  },
  callModalTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  callModalSubtitle: { fontSize: 14, color: '#475569', marginTop: 8, lineHeight: 20 },
  callBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  callDeclineBtn: {
    flex: 1,
    backgroundColor: '#fee2e2',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  callDeclineText: { color: '#b91c1c', fontWeight: '800' },
  callAcceptBtn: {
    flex: 1,
    backgroundColor: '#dcfce7',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  callAcceptText: { color: '#166534', fontWeight: '800' },
});

export default UserDashboard;