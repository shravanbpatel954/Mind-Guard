import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { recordLocationSnapshot } from './LocationMonitor';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 2 * 60 * 1000;

let currentSession = null;
let timerId = null;

function clearTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

async function pushLocationSample() {
  if (!currentSession) return;

  const now = Date.now();
  if (now >= currentSession.expiresAtMs) {
    try {
      await firestore()
        .collection('alerts')
        .doc(currentSession.alertId)
        .set(
          {
            liveLocationActive: false,
          },
          { merge: true },
        );
    } catch (e) {
      console.log('LiveLocation: deactivate error', e);
    }
    currentSession = null;
    clearTimer();
    return;
  }

  const uid = auth().currentUser?.uid;
  if (!uid) {
    currentSession = null;
    clearTimer();
    return;
  }

  try {
    const snapshot = await recordLocationSnapshot();
    if (!snapshot) return;

    const alertRef = firestore().collection('alerts').doc(currentSession.alertId);

    await alertRef.collection('liveLocations').add({
      userId: uid,
      lat: snapshot.lat,
      lon: snapshot.lon,
      sourceTs: snapshot.ts,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });

    await alertRef.set(
      {
        liveLocationActive: true,
        liveLocationExpiresAt: new Date(currentSession.expiresAtMs),
      },
      { merge: true },
    );
  } catch (e) {
    console.log('LiveLocation: push error', e);
  }
}

export function startLiveLocationSharing(alertId, expiresAtMs) {
  if (!alertId) return;

  const now = Date.now();
  const end = Math.max(expiresAtMs || now + TWELVE_HOURS_MS, now + 5 * 60 * 1000);

  currentSession = { alertId, expiresAtMs: end };

  clearTimer();
  pushLocationSample();
  timerId = setInterval(pushLocationSample, SAMPLE_INTERVAL_MS);
}

export function stopLiveLocationSharing() {
  currentSession = null;
  clearTimer();
}

