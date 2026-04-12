import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  SafeAreaView,
  TextInput,
  Linking,
  Vibration,
  Platform,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import DashboardHeader from '../components/DashboardHeader';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

const LIVE_MAP_DEFAULT_REGION = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 30,
  longitudeDelta: 30,
};

function GhostChatModal({ targetUserId, targetUserName, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    const unsub = firestore().collection('chat_sessions').doc(targetUserId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot(snap => {
        if (!snap) return;
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      });
    return () => unsub();
  }, [targetUserId]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    await firestore().collection('chat_sessions').doc(targetUserId).collection('messages').add({
      role: 'assistant', // Ghosting as the bot!
      authorId: auth().currentUser?.uid || 'guardian',
      content: input.trim(),
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    
    await firestore().collection('chat_sessions').doc(targetUserId).set({
      lastMessageAt: firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    
    setInput('');
  };

  const escalateToProf = async () => {
    Alert.alert('Escalate', 'Pass this chat to a professional?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, Escalate', style: 'destructive', onPress: async () => {
          await firestore().collection('chat_sessions').doc(targetUserId).set({
            status: 'pending_professional',
            botSuspended: true,
            escalatedProfAt: firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          Alert.alert('Escalated', 'Professionals have been notified.');
          onClose();
        }
      }
    ]);
  };

  return (
    <Modal visible={true} animationType="slide">
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={{ padding: 10 }}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Ghost Chat: {targetUserName}</Text>
          <TouchableOpacity onPress={escalateToProf} style={{ padding: 10 }}>
            <Text style={styles.escalateText}>Escalate</Text>
          </TouchableOpacity>
        </View>

        <ScrollView ref={scrollRef} style={styles.chatScroll} contentContainerStyle={{ padding: 16 }}>
          {messages.map(msg => (
            <View key={msg.id} style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.botBubble]}>
              <Text style={[styles.bubbleText, msg.role === 'user' ? styles.userText : styles.botText]}>
                {msg.content}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.chatInput}
            value={input}
            onChangeText={setInput}
            placeholder="Type as CalmBot..."
            placeholderTextColor="#94a3b8"
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function LiveLocationModal({ alert, visible, onClose }) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const unsubRef = useRef(null);

  useEffect(() => {
    if (!visible || !alert?.id) return;

    setLoading(true);
    const ref = firestore()
      .collection('alerts')
      .doc(alert.id)
      .collection('liveLocations')
      .orderBy('createdAt', 'desc')
      .limit(100);

    const unsub = ref.onSnapshot(
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPoints(rows);
        setLoading(false);
      },
      (err) => {
        console.log('LiveLocation listener error', err);
        setLoading(false);
      },
    );

    unsubRef.current = unsub;
    return () => {
      if (unsubRef.current) unsubRef.current();
      unsubRef.current = null;
    };
  }, [visible, alert?.id]);

  const coordsAsc = useMemo(
    () =>
      [...points]
        .reverse()
        .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p) => ({ latitude: p.lat, longitude: p.lon })),
    [points],
  );

  const lastCoord = coordsAsc.length > 0 ? coordsAsc[coordsAsc.length - 1] : null;

  const [mapRegion, setMapRegion] = useState(LIVE_MAP_DEFAULT_REGION);

  useEffect(() => {
    if (!visible) return;
    if (lastCoord) {
      setMapRegion({
        latitude: lastCoord.latitude,
        longitude: lastCoord.longitude,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      });
    } else {
      setMapRegion(LIVE_MAP_DEFAULT_REGION);
    }
  }, [visible, lastCoord]);

  if (!visible || !alert) return null;

  const formatTs = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const expiresAt =
    alert.liveLocationExpiresAt && alert.liveLocationExpiresAt.toDate
      ? alert.liveLocationExpiresAt.toDate()
      : alert.liveLocationExpiresAt
      ? new Date(alert.liveLocationExpiresAt)
      : null;

  const now = new Date();
  const isExpired = expiresAt && now > expiresAt;

  const openInMaps = async () => {
    if (!lastCoord) return;
    const url = `https://www.google.com/maps?q=${lastCoord.latitude},${lastCoord.longitude}`;
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.log('Open maps error', e);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.liveModalRoot}>
        <View style={styles.liveModalCard}>
          <View style={styles.liveModalHeader}>
            <Text style={styles.liveModalTitle}>Live location (last 12 hours)</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.liveModalClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.liveModalUser}>
            👤 {alert.userName || 'Unknown user'}
          </Text>
          {expiresAt && (
            <Text style={styles.liveModalMeta}>
              Window until {expiresAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}{' '}
              ({expiresAt.toLocaleDateString()})
            </Text>
          )}
          {isExpired && (
            <Text style={styles.liveModalWarning}>
              This 12-hour live location window has ended. Last known point is shown below.
            </Text>
          )}

          {loading ? (
            <View style={styles.liveLoading}>
              <ActivityIndicator size="small" color="#6366f1" />
              <Text style={styles.liveLoadingText}>Loading recent locations…</Text>
            </View>
          ) : points.length === 0 ? (
            <Text style={styles.liveEmpty}>
              No location samples recorded for this alert yet. They appear once MindGuard can read GPS on the user’s phone.
            </Text>
          ) : (
            <>
              <View style={styles.liveMapWrap} collapsable={false}>
                <MapView
                  style={StyleSheet.absoluteFillObject}
                  provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                  initialRegion={mapRegion}
                  region={mapRegion}
                  mapType="standard"
                  rotateEnabled={false}>
                  {coordsAsc.length > 1 && (
                    <Polyline coordinates={coordsAsc} strokeWidth={4} strokeColor="#2563eb" />
                  )}
                  {lastCoord ? <Marker coordinate={lastCoord} title="Live location" /> : null}
                </MapView>
                <View style={styles.liveMapTopRow}>
                  <View style={styles.livePill}>
                    <Text style={styles.livePillText}>
                      {alert.liveLocationActive && !isExpired ? 'LIVE' : 'LAST KNOWN'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={openInMaps} style={styles.liveMapsBtn} disabled={!lastCoord}>
                    <Text style={styles.liveMapsBtnText}>Open in Maps</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.liveLastBox}>
                <Text style={styles.liveLastLabel}>Last known location</Text>
                <Text style={styles.liveLastValue}>
                  {points[0].lat?.toFixed(4)}°, {points[0].lon?.toFixed(4)}°
                </Text>
                <Text style={styles.liveLastMeta}>at {formatTs(points[0].createdAt)}</Text>
              </View>
              <ScrollView style={styles.liveList} showsVerticalScrollIndicator={false}>
                {points.map((p) => (
                  <View key={p.id} style={styles.liveRow}>
                    <Text style={styles.liveRowTime}>{formatTs(p.createdAt)}</Text>
                    <Text style={styles.liveRowCoords}>
                      {p.lat?.toFixed(4)}°, {p.lon?.toFixed(4)}°
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function GuardianDashboard({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [linkedUsers, setLinkedUsers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [guardianName, setGuardianName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [chatSessions, setChatSessions] = useState({});
  const [activeChatUserId, setActiveChatUserId] = useState(null);
  const [activeChatUserName, setActiveChatUserName] = useState('');
  const [liveAlert, setLiveAlert] = useState(null);
  const listenerRef = useRef(null);
  const chatSessionsListenerRefs = useRef([]);
  const alertsPrimedRef = useRef(false);

  const loadProfile = useCallback(async () => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return;
      const doc = await firestore().collection('users').doc(uid).get();
      if (doc.exists) setGuardianName(doc.data()?.name || 'Guardian');
    } catch (e) {
      console.log('Profile error:', e);
    }
  }, []);

  /** Alerts where this guardian is listed — scales past Firestore `in` limit of 10. */
  const startAlertsListener = useCallback((guardianUid) => {
    if (listenerRef.current) listenerRef.current();
    alertsPrimedRef.current = false;

    // Avoid composite-index requirement by not ordering in the query.
    // We'll sort client-side by timestamp.
    const q = firestore()
      .collection('alerts')
      .where('guardianIds', 'array-contains', guardianUid)
      .limit(50);

    listenerRef.current = q.onSnapshot(
      (snap) => {
        const alertList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        alertList.sort((a, b) => {
          const at = a.timestamp?.toMillis ? a.timestamp.toMillis() : a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0;
          const bt = b.timestamp?.toMillis ? b.timestamp.toMillis() : b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0;
          return bt - at;
        });

        const urgentTypes = new Set([
          'USER_REQUESTED_HELP',
          'CALMBOT_SELF_HARM',
          'CALMBOT_CRISIS_CONFIRMED',
          'HIGH_RISK',
          'MODERATE_RISK',
        ]);

        if (alertsPrimedRef.current) {
          snap.docChanges().forEach((ch) => {
            if (ch.type !== 'added' || !ch.doc.exists) return;
            const a = { id: ch.doc.id, ...ch.doc.data() };
            if (a.read) return;
            if (!urgentTypes.has(a.type)) return;
            const headline =
              a.type === 'HIGH_RISK' || a.type === 'MODERATE_RISK'
                ? 'Risk update'
                : 'Urgent · CalmBot';
            try {
              Vibration.vibrate([0, 260, 140, 260]);
            } catch (e) {
              /* ignore */
            }
            Alert.alert(`${headline} — ${a.userName || 'Linked user'}`, a.message || 'Open MindGuard for details.', [
              { text: 'OK' },
            ]);
          });
        } else {
          alertsPrimedRef.current = true;
        }

        setAlerts(alertList);
      },
      (error) => console.log('Alerts listener error:', error)
    );
  }, []);

  const loadLinkedUsers = useCallback(async () => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return;

      const linksSnap = await firestore()
        .collection('guardian_links')
        .where('guardianId', '==', uid)
        .where('status', '==', 'active')
        .get();

      const users = [];
      for (const d of linksSnap.docs) {
        const data = d.data();
        const userDoc = await firestore().collection('users').doc(data.userId).get();
        if (userDoc.exists) {
          users.push({
            id: d.id,
            userId: data.userId,
            name: userDoc.data()?.name || 'Unknown',
            email: userDoc.data()?.email || '',
            linkedAt: data.linkedAt,
          });
        }
      }

      setLinkedUsers(users);
      startAlertsListener(uid);

      // Listen to their chat sessions
      chatSessionsListenerRefs.current.forEach(u => u());
      chatSessionsListenerRefs.current = [];
      
      users.forEach(u => {
        const unsub = firestore().collection('chat_sessions').doc(u.userId).onSnapshot((snapDoc) => {
          if (snapDoc.exists) {
            setChatSessions(prev => ({ ...prev, [u.userId]: snapDoc.data() }));
          }
        });
        chatSessionsListenerRefs.current.push(unsub);
      });

    } catch (e) {
      console.log('Linked users error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [startAlertsListener]);

  useEffect(() => {
    loadProfile();
    loadLinkedUsers();
    return () => {
      if (listenerRef.current) listenerRef.current();
      chatSessionsListenerRefs.current.forEach(unsub => unsub());
    };
  }, [loadProfile, loadLinkedUsers]);

  const markAlertRead = async (alertId) => {
    try {
      await firestore().collection('alerts').doc(alertId).update({ read: true });
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, read: true } : a)));
    } catch (e) {
      console.log('Mark read error:', e);
    }
  };

  const markAllRead = async () => {
    try {
      const unread = alerts.filter((a) => !a.read);
      const batch = firestore().batch();
      unread.forEach((a) => {
        batch.update(firestore().collection('alerts').doc(a.id), { read: true });
      });
      await batch.commit();
      setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
    } catch (e) {
      console.log('Mark all read error:', e);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  const getAlertConfig = (type) => {
    switch (type) {
      case 'HIGH_RISK':
        return {
          emoji: '🔴',
          label: 'High Risk Detected',
          color: '#ef4444',
          bg: '#fef2f2',
          border: '#fecaca',
        };
      case 'MODERATE_RISK':
        return {
          emoji: '🟡',
          label: 'Moderate Risk Detected',
          color: '#d97706',
          bg: '#fffbeb',
          border: '#fde68a',
        };
      case 'USER_REQUESTED_HELP':
        return {
          emoji: '🆘',
          label: 'User Asked for Help',
          color: '#dc2626',
          bg: '#fff1f2',
          border: '#fecdd3',
        };
      case 'CALMBOT_SELF_HARM':
        return {
          emoji: '⚠️',
          label: 'CalmBot · self-harm language',
          color: '#b91c1c',
          bg: '#fef2f2',
          border: '#fecaca',
        };
      case 'CALMBOT_CRISIS_CONFIRMED':
        return {
          emoji: '🚨',
          label: 'CalmBot · immediate danger indicated',
          color: '#991b1b',
          bg: '#fef2f2',
          border: '#fca5a5',
        };
      default:
        return {
          emoji: '📋',
          label: 'Pattern Change',
          color: '#6366f1',
          bg: '#eef2ff',
          border: '#c7d2fe',
        };
    }
  };

  const openAlertDetail = (alert) => {
    const hasLive = alert.liveLocationActive || alert.liveLocationExpiresAt;
    const config = getAlertConfig(alert.type);
    const devLines =
      alert.deviations && alert.deviations.length > 0
        ? `\n\n${alert.deviations.slice(0, 8).map((d) => `• ${d}`).join('\n')}`
        : '';
    const body = `${alert.message || ''}${devLines}`.trim() || 'No extra details.';

    const buttons = [];
    if (hasLive) {
      buttons.push({
        text: 'View live location',
        onPress: () => setLiveAlert(alert),
      });
    }
    buttons.push({
      text: 'Mark as read',
      onPress: () => markAlertRead(alert.id),
    });
    buttons.push({ text: 'Close', style: 'cancel' });

    Alert.alert(config.label, body, buttons);
  };

  const unreadCount = alerts.filter((a) => !a.read).length;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadLinkedUsers();
          }}
          colors={['#6366f1']}
        />
      }>
      <DashboardHeader
        title={`Hello, ${guardianName} 🛡️`}
        subtitle="Guardian dashboard · alerts from linked users"
        onOpenSettings={() => navigation.navigate('Settings')}
      />

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{linkedUsers.length}</Text>
          <Text style={styles.summaryLabel}>
            Linked{'\n'}Users
          </Text>
        </View>
        <View style={[styles.summaryCard, unreadCount > 0 && styles.summaryCardRed]}>
          <Text style={[styles.summaryNum, unreadCount > 0 && { color: '#ef4444' }]}>
            {unreadCount}
          </Text>
          <Text style={[styles.summaryLabel, unreadCount > 0 && { color: '#ef4444' }]}>
            Unread{'\n'}Alerts
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{alerts.length}</Text>
          <Text style={styles.summaryLabel}>
            Total{'\n'}Alerts
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>People You&apos;re Watching Over</Text>

        {linkedUsers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>👥</Text>
            <Text style={styles.emptyTitle}>No linked users yet</Text>
            <Text style={styles.emptyDesc}>
              Ask the person you want to monitor to add you as their guardian from their settings.
              They&apos;ll share a pairing code with you.
            </Text>
          </View>
        ) : (
          linkedUsers.map((user) => {
            const userAlerts = alerts.filter((a) => a.userId === user.userId);
            const userUnread = userAlerts.filter((a) => !a.read).length;
            const lastAlert = userAlerts[0];
            const lastRisk = lastAlert?.riskLevel || 'NORMAL';
            const session = chatSessions[user.userId];

            return (
              <View key={user.id} style={styles.userCard}>
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <View style={styles.userAvatarWrap}>
                    <Text style={styles.userAvatarText}>{user.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{user.name}</Text>
                    <Text style={styles.userEmail}>{user.email}</Text>
                    <Text style={styles.userAlertCount}>
                      {userAlerts.length} alert{userAlerts.length !== 1 ? 's' : ''} total
                      {userUnread > 0 ? ` · ${userUnread} unread` : ''}
                    </Text>
                  </View>
                  <View style={styles.userRisk}>
                    <Text style={styles.userRiskEmoji}>
                      {lastRisk === 'HIGH' ? '🔴' : lastRisk === 'MODERATE' ? '🟡' : '🟢'}
                    </Text>
                    <Text style={[styles.userRiskText, {color: lastRisk === 'HIGH' ? '#ef4444' : lastRisk === 'MODERATE' ? '#d97706' : '#22c55e'}]}>
                      {lastRisk}
                    </Text>
                  </View>
                </View>
                
                {(session?.status === 'guardian_active' || session?.status === 'guardian_notified') && (
                  <TouchableOpacity
                    style={styles.interveneBtn}
                    onPress={async () => {
                      setActiveChatUserId(user.userId);
                      setActiveChatUserName(user.name);
                      
                      // Claim the session and silence CalmBot so Guardian can ghost
                      await firestore().collection('chat_sessions').doc(user.userId).set({
                        status: 'guardian_active',
                        botSuspended: true
                      }, { merge: true });
                    }}>
                    <Text style={styles.interveneBtnText}>🚨 Intervene / Take Over Chat</Text>
                  </TouchableOpacity>
                )}
                {session?.status === 'pending_professional' && (
                  <View style={styles.profPendingWrap}>
                    <Text style={styles.profPendingText}>⏳ Escalated to Professional</Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Alert Feed</Text>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllRead}>
              <Text style={styles.markAllRead}>Mark all read</Text>
            </TouchableOpacity>
          )}
        </View>

        {alerts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>✅</Text>
            <Text style={styles.emptyTitle}>No alerts yet</Text>
            <Text style={styles.emptyDesc}>
              Alerts appear here when MindGuard flags MODERATE/HIGH risk for a linked user, or when they
              request help from CalmBot. You must be listed on their guardian link.
            </Text>
          </View>
        ) : (
          alerts.map((alert) => {
            const config = getAlertConfig(alert.type);
            return (
              <TouchableOpacity
                key={alert.id}
                style={[
                  styles.alertCard,
                  { backgroundColor: config.bg, borderColor: config.border },
                  !alert.read && styles.alertUnread,
                ]}
                onPress={() => openAlertDetail(alert)}
                activeOpacity={0.85}>
                <View style={styles.alertIconWrap}>
                  <Text style={styles.alertIcon}>{config.emoji}</Text>
                </View>
                <View style={styles.alertBody}>
                  <View style={styles.alertTopRow}>
                    <Text style={[styles.alertType, { color: config.color }]}>{config.label}</Text>
                    {!alert.read && <View style={styles.unreadDot} />}
                  </View>
                  <Text style={styles.alertUser}>👤 {alert.userName || 'Unknown user'}</Text>
                  {alert.message ? (
                    <Text style={styles.alertMsg} numberOfLines={2}>
                      {alert.message}
                    </Text>
                  ) : null}
                  {alert.deviations && alert.deviations.length > 0 && (
                    <Text style={styles.alertDeviation} numberOfLines={1}>
                      • {alert.deviations[0]}
                    </Text>
                  )}
                  <View style={styles.alertFooter}>
                    <Text style={styles.alertTime}>{formatTime(alert.timestamp)}</Text>
                    {!alert.read ? <Text style={styles.tapToRead}>Tap for details</Text> : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How This Works</Text>
        <View style={styles.infoCard}>
          {[
            {
              emoji: '📱',
              text: "MindGuard monitors the linked user's digital behaviour on their device — screen time, social apps, location patterns, night usage.",
            },
            {
              emoji: '🧠',
              text: 'An on-device ML model flags when today looks unusual vs their recent baseline (weekday vs weekend aware).',
            },
            {
              emoji: '🔔',
              text: 'MODERATE or HIGH risk creates an alert here in real time (once per level per day). You get a pop-up while the app is open.',
            },
            {
              emoji: '🆘',
              text: 'If CalmBot detects crisis language, a help request, or a “yes” to immediate danger, you get a new urgent alert immediately (no refresh).',
            },
            {
              emoji: '🔒',
              text: 'Raw usage data stays on their phone — only summaries and risk level are stored in alerts.',
            },
          ].map((item, i) => (
            <View key={i} style={[styles.infoRow, i < 4 && styles.infoRowBorder]}>
              <Text style={styles.infoEmoji}>{item.emoji}</Text>
              <Text style={styles.infoText}>{item.text}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
    {activeChatUserId && (
      <GhostChatModal
        targetUserId={activeChatUserId}
        targetUserName={activeChatUserName}
        onClose={() => setActiveChatUserId(null)}
      />
    )}
    {liveAlert && (
      <LiveLocationModal
        alert={liveAlert}
        visible={!!liveAlert}
        onClose={() => setLiveAlert(null)}
      />
    )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { paddingTop: 8 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: { marginTop: 16, color: '#64748b', fontSize: 15 },
  summaryRow: { flexDirection: 'row', padding: 16, gap: 10 },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  summaryCardRed: { backgroundColor: '#fef2f2', borderWidth: 1.5, borderColor: '#fecaca' },
  summaryNum: { fontSize: 28, fontWeight: 'bold', color: '#1e293b' },
  summaryLabel: { fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'center' },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: 'bold', color: '#1e293b', marginBottom: 12 },
  markAllRead: { fontSize: 13, color: '#6366f1', fontWeight: '600' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 8,
    elevation: 1,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: '#1e293b', marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 20 },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  userAvatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  userAvatarText: { fontSize: 20, fontWeight: 'bold', color: '#6366f1' },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
  userEmail: { fontSize: 12, color: '#64748b', marginTop: 2 },
  userAlertCount: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  userRisk: { alignItems: 'center' },
  userRiskEmoji: { fontSize: 18 },
  userRiskText: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  alertCard: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    marginBottom: 10,
    borderWidth: 1,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  alertUnread: { borderLeftWidth: 4, borderLeftColor: '#6366f1' },
  alertIconWrap: { marginRight: 12, justifyContent: 'flex-start' },
  alertIcon: { fontSize: 26 },
  alertBody: { flex: 1 },
  alertTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  alertType: { fontSize: 13, fontWeight: 'bold', flex: 1 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6366f1',
    marginLeft: 8,
  },
  alertUser: { fontSize: 13, color: '#475569', marginBottom: 3 },
  alertMsg: { fontSize: 13, color: '#64748b', lineHeight: 18, marginBottom: 3 },
  alertDeviation: { fontSize: 12, color: '#94a3b8', marginBottom: 4, fontStyle: 'italic' },
  alertFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  alertTime: { fontSize: 11, color: '#94a3b8' },
  tapToRead: { fontSize: 11, color: '#6366f1' },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    elevation: 1,
    marginBottom: 8,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, gap: 12 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  infoEmoji: { fontSize: 18, marginTop: 1 },
  infoText: { flex: 1, fontSize: 13, color: '#475569', lineHeight: 20 },
  interveneBtn: {
    backgroundColor: '#fee2e2',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fca5a5'
  },
  interveneBtnText: { color: '#dc2626', fontWeight: 'bold' },
  profPendingWrap: {
    backgroundColor: '#fffbeb',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fde68a'
  },
  profPendingText: { color: '#d97706', fontWeight: 'bold' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
    paddingTop: 10,
    paddingBottom: 10,
    elevation: 2,
  },
  closeText: { color: '#64748b', fontWeight: '600', fontSize: 16 },
  escalateText: { color: '#ef4444', fontWeight: 'bold', fontSize: 16 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
  chatScroll: { flex: 1, backgroundColor: '#f8fafc' },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 18, marginBottom: 10 },
  botBubble: { backgroundColor: '#fff', alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  userBubble: { backgroundColor: '#6366f1', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  botText: { color: '#1e293b' },
  userText: { color: '#fff' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0', gap: 10 },
  chatInput: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  sendBtn: { backgroundColor: '#6366f1', width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },

  liveModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  liveModalCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    maxHeight: '78%',
  },
  liveModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  liveModalTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  liveModalClose: { fontSize: 14, fontWeight: '600', color: '#6366f1' },
  liveModalUser: { fontSize: 13, color: '#475569', marginBottom: 4 },
  liveModalMeta: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  liveModalWarning: { fontSize: 12, color: '#b91c1c', marginBottom: 8 },
  liveLoading: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  liveLoadingText: { fontSize: 13, color: '#64748b' },
  liveEmpty: { fontSize: 13, color: '#64748b', marginTop: 12, lineHeight: 20 },
  liveLastBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    marginBottom: 8,
  },
  liveLastLabel: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  liveLastValue: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  liveLastMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  liveList: { marginTop: 6 },
  liveMapWrap: {
    height: 260,
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#e2e8f0',
  },
  liveMapTopRow: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  livePill: {
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    opacity: 0.9,
  },
  livePillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  liveMapsBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  liveMapsBtnText: { color: '#2563eb', fontSize: 12, fontWeight: '700' },
  liveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  liveRowTime: { fontSize: 12, color: '#64748b' },
  liveRowCoords: { fontSize: 13, color: '#1e293b' },
});
