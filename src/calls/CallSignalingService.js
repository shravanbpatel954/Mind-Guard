import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

const CALL_TIMEOUT_MS = 45 * 1000;

export function nowMs() {
  return Date.now();
}

export function buildCallDoc({
  callerId,
  callerName,
  calleeId,
  calleeName,
  mode,
}) {
  const createdAtMs = nowMs();
  const expiresAtMs = createdAtMs + CALL_TIMEOUT_MS;

  return {
    callerId,
    callerName: callerName || 'Professional',
    calleeId,
    calleeName: calleeName || 'User',
    mode, // 'voice' | 'video'
    status: 'pending', // pending | accepted | declined | missed | ended
    createdAtMs,
    expiresAtMs,
    createdAt: firestore.FieldValue.serverTimestamp(),
    lastHeartbeatAt: firestore.FieldValue.serverTimestamp(),
  };
}

export async function createCallRequest({ calleeId, calleeName, mode }) {
  const callerId = auth().currentUser?.uid;
  if (!callerId) throw new Error('Not logged in.');

  const callerDoc = await firestore().collection('users').doc(callerId).get();
  const callerName = callerDoc.data()?.name || 'Professional';

  const callDoc = buildCallDoc({
    callerId,
    callerName,
    calleeId,
    calleeName,
    mode,
  });

  const ref = await firestore().collection('call_sessions').add(callDoc);
  return { callId: ref.id, callDoc };
}

export function callDocRef(callId) {
  return firestore().collection('call_sessions').doc(callId);
}

export async function setCallStatus(callId, status, extra = {}) {
  const ref = callDocRef(callId);
  const patch = {
    status,
    lastHeartbeatAt: firestore.FieldValue.serverTimestamp(),
    ...extra,
  };
  if (status === 'accepted') patch.acceptedAt = firestore.FieldValue.serverTimestamp();
  if (status === 'declined') patch.declinedAt = firestore.FieldValue.serverTimestamp();
  if (status === 'ended') patch.endedAt = firestore.FieldValue.serverTimestamp();
  if (status === 'missed') patch.missedAt = firestore.FieldValue.serverTimestamp();
  await ref.set(patch, { merge: true });
}

/** Plain { type, sdp } for Firestore (avoids non-serializable class instances). */
export function serializeSessionDescription(desc) {
  if (!desc) return null;
  const type = desc.type;
  const sdp = desc.sdp;
  if (!type || sdp == null) return null;
  return { type, sdp };
}

export async function attachOffer(callId, offer) {
  const plain = serializeSessionDescription(offer);
  if (!plain) return;
  await callDocRef(callId).set(
    {
      offer: plain,
      offerCreatedAt: firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function attachAnswer(callId, answer) {
  const plain = serializeSessionDescription(answer);
  if (!plain) return;
  await callDocRef(callId).set(
    {
      answer: plain,
      answerCreatedAt: firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export function callerCandidatesRef(callId) {
  return callDocRef(callId).collection('callerCandidates');
}

export function calleeCandidatesRef(callId) {
  return callDocRef(callId).collection('calleeCandidates');
}

function serializeIceCandidate(candidate) {
  if (!candidate) return null;
  try {
    if (typeof candidate.toJSON === 'function') return candidate.toJSON();
  } catch (e) {
    /* ignore */
  }
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
  };
}

export async function addCandidate(callId, side, candidate) {
  const col = side === 'caller' ? callerCandidatesRef(callId) : calleeCandidatesRef(callId);
  const plain = serializeIceCandidate(candidate);
  if (!plain || plain.candidate == null) return;
  await col.add({
    candidate: plain,
    clientTs: Date.now(),
    createdAt: firestore.FieldValue.serverTimestamp(),
  });
}

export function listenToCall(callId, onChange, onError) {
  return callDocRef(callId).onSnapshot(
    (snap) => {
      if (!snap.exists) return;
      onChange({ id: snap.id, ...snap.data() });
    },
    onError,
  );
}

export function listenToCandidates(callId, side, onCandidate, onError) {
  const col = side === 'caller' ? calleeCandidatesRef(callId) : callerCandidatesRef(callId);
  let initial = true;
  return col
    .orderBy('clientTs', 'asc')
    .onSnapshot(
      (snap) => {
        if (initial) {
          initial = false;
          snap.docs.forEach((doc) => {
            const data = doc.data();
            if (data?.candidate) onCandidate(data.candidate);
          });
          return;
        }
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const data = change.doc.data();
          if (data?.candidate) onCandidate(data.candidate);
        });
      },
      onError,
    );
}

export async function markMissedIfExpired(callId) {
  const ref = callDocRef(callId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const d = snap.data();
  if (!d) return;
  if (d.status !== 'pending') return;
  const expiresAtMs = d.expiresAtMs || 0;
  if (expiresAtMs && nowMs() > expiresAtMs) {
    await setCallStatus(callId, 'missed');
  }
}

