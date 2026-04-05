import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  TextInput,
  Share,
  Modal,
  PermissionsAndroid,
  Animated,
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

let APP_VERSION = '0.0.1';
try {
  APP_VERSION = require('../../package.json').version;
} catch {
  /* ignore */
}

const ROLE_LABELS = {
  user: 'User — monitor your own wellness',
  guardian: 'Guardian — watch over someone',
  professional: 'Professional — support clients',
};

const PAIR_CODE_LENGTH = 6;
const PAIR_PREFIX = 'MINDGUARD_PAIR:';
const PAIR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const buildPairPayload = (code) => `${PAIR_PREFIX}${code}`;

const randomPairCode = () => {
  let out = '';
  for (let i = 0; i < PAIR_CODE_LENGTH; i += 1) {
    out += PAIR_CHARS.charAt(Math.floor(Math.random() * PAIR_CHARS.length));
  }
  return out;
};

const normalizePairCodeInput = (raw) => {
  const up = String(raw || '').trim().toUpperCase();
  if (!up) return '';
  if (up.startsWith(PAIR_PREFIX)) {
    return up.slice(PAIR_PREFIX.length).replace(/[^A-Z0-9]/g, '').slice(0, PAIR_CODE_LENGTH);
  }
  const compact = up.replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/[A-Z0-9]{6}/);
  return match ? match[0] : compact.slice(0, PAIR_CODE_LENGTH);
};

/**
 * Animated QR Scanner Overlay
 */
function ScannerOverlay() {
  const [lineAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(lineAnim, {
          toValue: 200,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(lineAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [lineAnim]);

  return (
    <View style={styles.overlayWrap}>
      <View style={styles.scannerBox}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
        <Animated.View style={[styles.laser, { transform: [{ translateY: lineAnim }] }]} />
      </View>
      <Text style={styles.overlayText}>Align QR code within frame</Text>
    </View>
  );
}

/**
 * Pairing QR without react-native-svg (avoids RNSVGLinearGradient / native link issues).
 * Uses qrcode core BitMatrix + RN Views — same scan payload as before.
 */
function PairingQrSection({ pairingCode, styles }) {
  const matrix = useMemo(() => {
    if (!pairingCode) return null;
    try {
      const QRCodeCore = require('qrcode/lib/core/qrcode');
      return QRCodeCore.create(buildPairPayload(pairingCode), { errorCorrectionLevel: 'M' }).modules;
    } catch (e) {
      console.log('QR matrix error:', e);
      return null;
    }
  }, [pairingCode]);

  if (!pairingCode) return null;

  const n = matrix?.size ?? 0;
  const displaySize = 260;
  const cell = n > 0 ? Math.floor(displaySize / n) : 0;
  const total = n > 0 ? cell * n : 0;

  return (
    <View style={styles.qrWrap}>
      <View style={styles.qrCard}>
        {matrix && n > 0 ? (
          <View style={[styles.qrMatrix, { width: total, height: total }]}>
            {Array.from({ length: n }, (_, row) => (
              <View key={row} style={{ flexDirection: 'row', height: cell }}>
                {Array.from({ length: n }, (_, col) => (
                  <View
                    key={`${row}-${col}`}
                    style={{
                      width: cell,
                      height: cell,
                      backgroundColor: matrix.get(row, col) ? '#0f172a' : '#ffffff',
                    }}
                  />
                ))}
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.qrFallbackText}>Could not build QR. Use the code or text below.</Text>
        )}
      </View>
      <Text style={styles.qrBadge}>Scan to connect</Text>
      <Text style={styles.qrHint}>
        Guardian opens the camera or a QR app, scans this code, then pastes the text here or enters the
        6-character code.
      </Text>
      <View style={styles.qrFallback}>
        <Text style={styles.qrFallbackTitle}>Encoded text (if scan is not available)</Text>
        <Text style={styles.qrFallbackText} selectable>
          {buildPairPayload(pairingCode)}
        </Text>
      </View>
    </View>
  );
}

export default function SettingsScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [pairingCode, setPairingCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairInput, setPairInput] = useState('');
  const [connectBusy, setConnectBusy] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [linkedUsersCount, setLinkedUsersCount] = useState(0);
  const [linkedUsers, setLinkedUsers] = useState([]);
  const [linkedUsersBusy, setLinkedUsersBusy] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const device = useCameraDevice('back');
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0].value) {
        setPairInput(codes[0].value);
        setScannerVisible(false);
      }
    },
  });

  const loadProfile = useCallback(async () => {
    try {
      const u = auth().currentUser;
      if (!u) return;
      setEmail(u.email || '');
      const doc = await firestore().collection('users').doc(u.uid).get();
      if (doc.exists) {
        const d = doc.data();
        setName(d?.name || '');
        const r = d?.role;
        if (r === 'guardian' || r === 'professional' || r === 'user') setRole(r);
        else setRole('user');
        setPairingCode(d?.pairingCode || '');
      } else {
        setName(u.displayName || '');
      }
    } catch (e) {
      console.log('Settings profile load:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
    const unsub = navigation.addListener('focus', loadProfile);
    return unsub;
  }, [navigation, loadProfile]);

  const loadGuardianLinkedUsersCount = useCallback(async () => {
    const guardianUid = auth().currentUser?.uid;
    if (!guardianUid) return;
    setLinkedUsersBusy(true);
    try {
      const snap = await firestore()
        .collection('guardian_links')
        .where('guardianId', '==', guardianUid)
        .where('status', '==', 'active')
        .get();
      setLinkedUsersCount(snap.size || 0);
      const users = [];
      for (const d of snap.docs) {
        const link = d.data();
        const userDoc = await firestore().collection('users').doc(link.userId).get();
        if (userDoc.exists) {
          users.push({
            linkId: d.id,
            userId: link.userId,
            name: userDoc.data()?.name || 'User',
            email: userDoc.data()?.email || '',
          });
        }
      }
      setLinkedUsers(users);
    } catch (e) {
      console.log('Linked users count error:', e);
      setLinkedUsersCount(0);
      setLinkedUsers([]);
    } finally {
      setLinkedUsersBusy(false);
    }
  }, []);

  useEffect(() => {
    if (role !== 'guardian') return;
    loadGuardianLinkedUsersCount();
  }, [role, loadGuardianLinkedUsersCount]);

  const openSystemSettings = () => {
    Linking.openSettings().catch(() => {});
  };

  const generatePairingCode = async () => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;
    setPairingBusy(true);
    try {
      const usersRef = firestore().collection('users').doc(uid);
      let finalCode = '';

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomPairCode();
        const codeRef = firestore().collection('pair_codes').doc(code);
        // Create the code doc only when slot is empty or expired.
        // This keeps collision risk tiny without custom backend functions.
        const created = await firestore().runTransaction(async (tx) => {
          const snap = await tx.get(codeRef);
          if (snap.exists) {
            const data = snap.data() || {};
            if (data.status === 'active' && data.userId !== uid) {
              return false;
            }
          }
          tx.set(
            codeRef,
            {
              code,
              userId: uid,
              createdAt: firestore.FieldValue.serverTimestamp(),
              status: 'active',
              useCount: 0,
            },
            { merge: true }
          );
          return true;
        });

        if (created) {
          finalCode = code;
          break;
        }
      }

      if (!finalCode) {
        Alert.alert('Try again', 'Could not create a unique pairing code. Please retry.');
        return;
      }

      await usersRef.set(
        {
          pairingCode: finalCode,
          pairingCodeExpiresAt: null,
        },
        { merge: true }
      );

      setPairingCode(finalCode);
    } catch (e) {
      console.log('Generate pair code error:', e);
      Alert.alert('Error', 'Could not generate pairing code right now.');
    } finally {
      setPairingBusy(false);
    }
  };

  const sharePairingCode = async () => {
    if (!pairingCode) {
      Alert.alert('No code yet', 'Generate a pairing code first.');
      return;
    }
    try {
      const payload = buildPairPayload(pairingCode);
      await Share.share({
        message: `MindGuard guardian pairing code: ${pairingCode}\nQR text: ${payload}`,
      });
    } catch (e) {
      console.log('Share pair code error:', e);
    }
  };

  const revokePairingCode = async () => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;
    if (!pairingCode) {
      Alert.alert('No active code', 'Generate a pairing code first.');
      return;
    }

    setRevokeBusy(true);
    try {
      await firestore().runTransaction(async (tx) => {
        const pairRef = firestore().collection('pair_codes').doc(pairingCode);
        const pairSnap = await tx.get(pairRef);
        if (!pairSnap.exists) return;
        const data = pairSnap.data() || {};
        // Only the owner should revoke their active code.
        if (data.userId && data.userId !== uid) {
          throw new Error('NOT_OWNER');
        }
        tx.set(pairRef, { status: 'revoked', revokedAt: firestore.FieldValue.serverTimestamp() }, { merge: true });
        const userRef = firestore().collection('users').doc(uid);
        tx.set(userRef, { pairingCode: '', pairingCodeExpiresAt: null }, { merge: true });
      });

      setPairingCode('');
      Alert.alert('Revoked', 'This pairing code is no longer valid.');
    } catch (e) {
      console.log('Revoke code error:', e);
      if (String(e?.message || '') === 'NOT_OWNER') {
        Alert.alert('Not allowed', 'You cannot revoke another user’s pairing code.');
      } else {
        Alert.alert('Error', 'Could not revoke pairing code right now.');
      }
    } finally {
      setRevokeBusy(false);
    }
  };

  const connectToUserFromRawInput = async (rawInput) => {
    const guardianUid = auth().currentUser?.uid;
    if (!guardianUid) return;
    const code = normalizePairCodeInput(rawInput);
    if (code.length !== PAIR_CODE_LENGTH) {
      Alert.alert('Invalid code', 'Enter a valid 6-character pairing code (or QR text).');
      return;
    }
    setConnectBusy(true);
    try {
      const pairRef = firestore().collection('pair_codes').doc(code);
      const linkResult = await firestore().runTransaction(async (tx) => {
        const pairSnap = await tx.get(pairRef);
        if (!pairSnap.exists) {
          throw new Error('PAIR_NOT_FOUND');
        }
        const pairData = pairSnap.data() || {};
        const targetUserId = pairData.userId;
        if (!targetUserId || pairData.status !== 'active') {
          throw new Error('PAIR_EXPIRED');
        }
        if (targetUserId === guardianUid) {
          throw new Error('PAIR_SELF');
        }

        const linkId = `${targetUserId}_${guardianUid}`;
        const linkRef = firestore().collection('guardian_links').doc(linkId);
        tx.set(
          linkRef,
          {
            userId: targetUserId,
            guardianId: guardianUid,
            status: 'active',
            linkedAt: firestore.FieldValue.serverTimestamp(),
            pairCodeUsed: code,
          },
          { merge: true }
        );

        tx.set(
          pairRef,
          {
            lastUsedAt: firestore.FieldValue.serverTimestamp(),
            useCount: firestore.FieldValue.increment(1),
          },
          { merge: true }
        );

        return { targetUserId };
      });

      const userDoc = await firestore().collection('users').doc(linkResult.targetUserId).get();
      const userName = userDoc.exists ? userDoc.data()?.name || 'User' : 'User';
      setPairInput('');
      await loadGuardianLinkedUsersCount();
      Alert.alert('Connected', `You are now monitoring ${userName}.`);
    } catch (e) {
      console.log('Connect by pair code error:', e);
      if (e.message === 'PAIR_NOT_FOUND') {
        Alert.alert('Code not found', 'This pairing code does not exist.');
      } else if (e.message === 'PAIR_EXPIRED') {
        Alert.alert('Code expired', 'This pairing code is no longer valid.');
      } else if (e.message === 'PAIR_SELF') {
        Alert.alert('Invalid code', 'You cannot connect to yourself.');
      } else {
        Alert.alert('Error', 'Could not connect right now. Please try again.');
      }
    } finally {
      setConnectBusy(false);
    }
  };

  const connectToUser = async () => {
    await connectToUserFromRawInput(pairInput);
  };

  const handleOpenScanner = async () => {
    try {
      const permission = await Camera.requestCameraPermission();
      if (permission === 'granted') {
        setScannerVisible(true);
      } else {
        Alert.alert('Permission Denied', 'Cannot access camera to scan QR.');
      }
    } catch (err) {
      console.warn(err);
    }
  };

  const disconnectLinkedUser = async (linkId, displayName) => {
    try {
      await firestore().collection('guardian_links').doc(linkId).set(
        {
          status: 'inactive',
          unlinkedAt: firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await loadGuardianLinkedUsersCount();
      Alert.alert('Disconnected', `${displayName} is no longer monitored.`);
    } catch (e) {
      console.log('Disconnect link error:', e);
      Alert.alert('Error', 'Could not disconnect this user right now.');
    }
  };

  const confirmLogout = () => {
    Alert.alert(
      'Log out',
      'You will need to sign in again to use MindGuard.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try {
              await auth().signOut();
            } catch (e) {
              Alert.alert('Error', 'Could not log out.');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
      <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} hitSlop={12}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.pageTitle}>Settings</Text>
      <Text style={styles.pageSub}>Account, privacy, and app preferences</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Profile</Text>
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(name || email || '?').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName}>{name || 'MindGuard user'}</Text>
            <Text style={styles.profileEmail}>{email || '—'}</Text>
            <Text style={styles.profileRole}>{ROLE_LABELS[role] || ROLE_LABELS.user}</Text>
          </View>
        </View>
        <Text style={styles.hint}>
          To change your display name, contact support or update it when your account flow supports editing.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Privacy & data</Text>
        <Text style={styles.body}>
          Usage and behaviour data are analysed on your device. Only summaries and alerts you choose to share
          (for example with a guardian) are stored in the cloud for MindGuard features.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Permissions</Text>
        <Text style={styles.body}>
          Usage access and location can be changed in Android system settings for MindGuard.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={openSystemSettings}>
          <Text style={styles.primaryBtnText}>Open app settings</Text>
        </TouchableOpacity>
      </View>

      {role === 'user' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Connect a guardian</Text>
          <Text style={styles.body}>
            Share the QR or short code with your guardian — same pairing link either way. Stays active until you
            revoke it.
          </Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>Pairing code</Text>
            <Text style={styles.codeValue}>{pairingCode || '------'}</Text>
            <Text style={styles.codeExpiry}>Status: {pairingCode ? 'Active' : 'Not generated'}</Text>
          </View>
          {pairingCode ? <PairingQrSection pairingCode={pairingCode} styles={styles} /> : null}
          <View style={styles.rowButtons}>
            <TouchableOpacity
              style={[styles.secondaryBtn, pairingBusy && styles.disabledBtn]}
              onPress={generatePairingCode}
              disabled={pairingBusy}>
              <Text style={styles.secondaryBtnText}>
                {pairingBusy ? 'Generating...' : pairingCode ? 'Regenerate code' : 'Generate code'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtnSmall, (!pairingCode || pairingBusy) && styles.disabledBtn]}
              onPress={sharePairingCode}
              disabled={!pairingCode || pairingBusy}>
              <Text style={styles.primaryBtnText}>Share</Text>
            </TouchableOpacity>
          </View>

          {pairingCode ? (
            <TouchableOpacity
              style={[styles.revokeBtn, revokeBusy && styles.disabledBtn]}
              onPress={revokePairingCode}
              disabled={revokeBusy}>
              <Text style={styles.revokeBtnText}>{revokeBusy ? 'Revoking...' : 'Revoke code'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {role === 'guardian' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Add monitored user</Text>
          <Text style={styles.body}>
            Scan the user&apos;s QR with your camera (then paste the result), or type the 6-character code / full
            pairing text to connect and receive risk alerts.
          </Text>

          <Text style={styles.linkCount}>
            {linkedUsersBusy ? 'Checking links...' : `Connected users: ${linkedUsersCount ?? 0}`}
          </Text>

          <TextInput
            value={pairInput}
            onChangeText={setPairInput}
            style={styles.input}
            placeholder="Example: AB3K9Q or MINDGUARD_PAIR:AB3K9Q"
            placeholderTextColor="#94a3b8"
            autoCapitalize="characters"
          />
          <View style={styles.rowButtons}>
            <TouchableOpacity
              style={[styles.secondaryBtn, connectBusy && styles.disabledBtn]}
              onPress={handleOpenScanner}
              disabled={connectBusy}>
              <Text style={styles.secondaryBtnText}>Scan QR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, connectBusy && styles.disabledBtn, { flex: 1, marginTop: 0 }]}
              onPress={connectToUser}
              disabled={connectBusy}>
              <Text style={styles.primaryBtnText}>{connectBusy ? 'Connecting...' : 'Connect code'}</Text>
            </TouchableOpacity>
          </View>

          {linkedUsers.length > 0 && (
            <View style={styles.linkedList}>
              {linkedUsers.map((u) => (
                <View key={u.linkId} style={styles.linkedRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.linkedName}>{u.name}</Text>
                    <Text style={styles.linkedEmail}>{u.email || '—'}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.disconnectBtn}
                    onPress={() =>
                      Alert.alert('Disconnect user', `Stop monitoring ${u.name}?`, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Disconnect',
                          style: 'destructive',
                          onPress: () => disconnectLinkedUser(u.linkId, u.name),
                        },
                      ])
                    }>
                    <Text style={styles.disconnectBtnText}>Disconnect</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>About</Text>
        <Text style={styles.body}>MindGuard — mental wellness companion on your phone.</Text>
        <Text style={styles.version}>Version {APP_VERSION}</Text>
        <Text style={styles.platform}>{Platform.OS === 'ios' ? 'iOS' : 'Android'}</Text>
      </View>

      {role === 'user' && (
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Developer Tools 🛠️</Text>
        <Text style={styles.body}>Skip the 7-day learning period by injecting fake history directly into your local database.</Text>
        <TouchableOpacity 
          style={[styles.primaryBtnSmall, { marginTop: 12, paddingVertical: 12, width: '100%', backgroundColor: '#8b5cf6' }]} 
          onPress={async () => {
            const { injectFakeBaseline } = require('../storage/LocalDB');
            const success = await injectFakeBaseline();
            if (success) {
              Alert.alert('Success', '7-day fake history injected! Please tap "Refresh data" on your dashboard to see CalmBot.');
            } else {
              Alert.alert('Error', 'Could not inject fake history.');
            }
          }}>
          <Text style={styles.primaryBtnText}>Inject 7-Day Fake History</Text>
        </TouchableOpacity>
      </View>
      )}

      <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} activeOpacity={0.85}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={scannerVisible} animationType="slide" onRequestClose={() => setScannerVisible(false)}>
        <View style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Scan QR Code</Text>
            <TouchableOpacity onPress={() => setScannerVisible(false)} hitSlop={12}>
              <Text style={styles.scannerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            {device == null ? (
              <ActivityIndicator size="large" color="#6366f1" style={{ flex: 1 }} />
            ) : (
              <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={scannerVisible}
                codeScanner={codeScanner}
              />
            )}
            {device != null && <ScannerOverlay />}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, alignSelf: 'flex-start' },
  backArrow: { fontSize: 22, color: '#6366f1', marginRight: 8 },
  backText: { fontSize: 16, fontWeight: '600', color: '#6366f1' },
  pageTitle: { fontSize: 26, fontWeight: '800', color: '#1e293b' },
  pageSub: { fontSize: 14, color: '#64748b', marginTop: 6, marginBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: '#6366f1' },
  profileText: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  profileEmail: { fontSize: 14, color: '#64748b', marginTop: 4 },
  profileRole: { fontSize: 13, color: '#6366f1', marginTop: 8, fontWeight: '600' },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 14, lineHeight: 18 },
  body: { fontSize: 14, color: '#475569', lineHeight: 22 },
  input: {
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#1e293b',
    fontSize: 14,
  },
  codeBox: {
    marginTop: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 14,
  },
  codeLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' },
  codeValue: { fontSize: 28, fontWeight: '800', color: '#1e293b', marginTop: 4, letterSpacing: 2 },
  codeExpiry: { fontSize: 12, color: '#64748b', marginTop: 8 },
  qrWrap: { marginTop: 14, alignItems: 'center', gap: 10 },
  qrCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 292,
    minWidth: 292,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  qrMatrix: {
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  qrBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6366f1',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  qrFallback: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
  },
  qrFallbackTitle: { fontSize: 12, color: '#64748b', fontWeight: '700', marginBottom: 6 },
  qrFallbackText: { fontSize: 12, color: '#334155' },
  qrHint: { fontSize: 12, color: '#64748b', textAlign: 'center', lineHeight: 18 },
  rowButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#6366f1',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  secondaryBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  primaryBtnSmall: {
    width: 100,
    backgroundColor: '#6366f1',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  disabledBtn: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkCount: { marginTop: 10, fontSize: 12, color: '#64748b', fontWeight: '600' },
  linkedList: { marginTop: 12, gap: 10 },
  linkedRow: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkedName: { color: '#1e293b', fontWeight: '700', fontSize: 14 },
  linkedEmail: { color: '#64748b', fontSize: 12, marginTop: 2 },
  disconnectBtn: {
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fff1f2',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  disconnectBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 12 },
  version: { fontSize: 13, color: '#64748b', marginTop: 10 },
  platform: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  revokeBtn: {
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: '#fca5a5',
    backgroundColor: '#fff1f2',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  revokeBtnText: { color: '#dc2626', fontSize: 14, fontWeight: '800' },
  logoutBtn: {
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  logoutText: { color: '#dc2626', fontSize: 16, fontWeight: '700' },
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
  },
  scannerTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  scannerCloseText: { fontSize: 16, fontWeight: '600', color: '#6366f1' },
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerBox: {
    width: 200,
    height: 200,
    position: 'relative',
  },
  corner: {
    width: 40,
    height: 40,
    position: 'absolute',
    borderColor: '#6366f1',
    borderWidth: 5,
  },
  cornerTL: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0 },
  cornerTR: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0 },
  laser: {
    width: '100%',
    height: 3,
    backgroundColor: '#6366f1',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  },
  overlayText: {
    marginTop: 40,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: 'hidden',
  },
});
