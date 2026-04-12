import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

function buildAlertMessage(riskLevel, deviations) {
  if (riskLevel === 'HIGH') {
    return deviations && deviations.length > 0
      ? `Significant pattern changes detected: ${deviations[0]}`
      : 'Significant changes in digital behaviour patterns detected today.';
  }
  return deviations && deviations.length > 0
    ? `Mild pattern changes: ${deviations[0]}`
    : 'Mild changes in behaviour patterns detected today.';
}

/** Notify linked guardians when ML flags MODERATE or HIGH (once per day per level). */
export const sendRiskAlert = async (riskLevel, riskScore, deviations) => {
  try {
    const uid = auth().currentUser?.uid;
    if (!uid) return;

    if (riskLevel === 'NORMAL') return;

    const today = new Date().toISOString().split('T')[0];
    const typeKey = `${riskLevel}_RISK`;

    const existingAlert = await firestore()
      .collection('alerts')
      .where('userId', '==', uid)
      .where('date', '==', today)
      .where('type', '==', typeKey)
      .get();

    if (!existingAlert.empty) {
      console.log('Alert already sent today — skipping');
      return;
    }

    const userDoc = await firestore().collection('users').doc(uid).get();
    const userName = userDoc.data()?.name || 'Unknown';

    const linksSnap = await firestore()
      .collection('guardian_links')
      .where('userId', '==', uid)
      .where('status', '==', 'active')
      .get();

    if (linksSnap.empty) {
      console.log('No guardians linked — alert saved without guardianIds');
    }

    const guardianIds = linksSnap.docs.map((d) => d.data().guardianId).filter(Boolean);

    const createdAt = new Date();
    const expiresAtMs = createdAt.getTime() + 12 * 60 * 60 * 1000;

    const docRef = await firestore().collection('alerts').add({
      userId: uid,
      userName,
      guardianIds,
      type: typeKey,
      riskLevel,
      riskScore,
      deviations: deviations || [],
      date: today,
      message: buildAlertMessage(riskLevel, deviations),
      timestamp: firestore.FieldValue.serverTimestamp(),
      read: false,
      liveLocationActive: false,
      liveLocationExpiresAt: new Date(expiresAtMs),
    });

    console.log(`Alert sent: ${typeKey}`);
    return { alertId: docRef.id, expiresAtMs };
  } catch (error) {
    console.log('Alert send error:', error);
    return null;
  }
};

/** User tapped for help in CalmBot — urgent alert to guardians. */
export const sendHelpRequestAlert = async () => {
  return sendCalmBotGuardianAlert({
    kind: 'HELP',
    userMessagePreview: 'User tapped “I need help” or equivalent in CalmBot.',
  });
};

/**
 * Immediate guardian notification from CalmBot crisis signals.
 * Not deduped by day — each serious signal creates a new alert so linked guardians
 * see it in real time over their existing Firestore listener.
 *
 * @param {'SELF_HARM'|'HELP'|'CRISIS_CONFIRMED'} kind
 */
export const sendCalmBotGuardianAlert = async ({ kind, userMessagePreview = '' }) => {
  try {
    const uid = auth().currentUser?.uid;
    if (!uid) return null;

    const typeMap = {
      SELF_HARM: 'CALMBOT_SELF_HARM',
      HELP: 'USER_REQUESTED_HELP',
      CRISIS_CONFIRMED: 'CALMBOT_CRISIS_CONFIRMED',
    };
    const type = typeMap[kind];
    if (!type) return null;

    const userDoc = await firestore().collection('users').doc(uid).get();
    const userName = userDoc.data()?.name || 'Unknown';

    const linksSnap = await firestore()
      .collection('guardian_links')
      .where('userId', '==', uid)
      .where('status', '==', 'active')
      .get();

    const guardianIds = linksSnap.docs.map((d) => d.data().guardianId).filter(Boolean);

    let message = '';
    if (kind === 'SELF_HARM') {
      message = 'CalmBot detected self-harm related language in chat.';
    } else if (kind === 'HELP') {
      message = 'The user asked for urgent help in CalmBot.';
    } else if (kind === 'CRISIS_CONFIRMED') {
      message =
        'The user indicated possible immediate danger during a CalmBot safety check-in. Please reach out now.';
    }
    const preview = String(userMessagePreview || '').trim();
    if (preview) {
      message = `${message} Context (trimmed): “${preview.slice(0, 160)}${preview.length > 160 ? '…' : ''}”`;
    }

    const createdAt = new Date();
    const expiresAtMs = createdAt.getTime() + 12 * 60 * 60 * 1000;

    const docRef = await firestore().collection('alerts').add({
      userId: uid,
      userName,
      guardianIds,
      type,
      riskLevel: 'HIGH',
      riskScore: 100,
      deviations: [],
      date: new Date().toISOString().split('T')[0],
      message,
      timestamp: firestore.FieldValue.serverTimestamp(),
      read: false,
      liveLocationActive: false,
      liveLocationExpiresAt: new Date(expiresAtMs),
      calmbotKind: kind,
    });

    console.log(`CalmBot guardian alert sent: ${type}`);
    return { alertId: docRef.id, expiresAtMs };
  } catch (error) {
    console.log('CalmBot guardian alert error:', error);
    throw error;
  }
};
