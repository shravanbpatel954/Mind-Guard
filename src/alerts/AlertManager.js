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
  try {
    const uid = auth().currentUser?.uid;
    if (!uid) return;

    const userDoc = await firestore().collection('users').doc(uid).get();
    const userName = userDoc.data()?.name || 'Unknown';

    const linksSnap = await firestore()
      .collection('guardian_links')
      .where('userId', '==', uid)
      .where('status', '==', 'active')
      .get();

    const guardianIds = linksSnap.docs.map((d) => d.data().guardianId).filter(Boolean);

    const createdAt = new Date();
    const expiresAtMs = createdAt.getTime() + 12 * 60 * 60 * 1000;

    const docRef = await firestore().collection('alerts').add({
      userId: uid,
      userName,
      guardianIds,
      type: 'USER_REQUESTED_HELP',
      riskLevel: 'HIGH',
      riskScore: 100,
      deviations: [],
      date: new Date().toISOString().split('T')[0],
      message: 'User manually reached out for help through CalmBot.',
      timestamp: firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    console.log('Help request alert sent');
    return { alertId: docRef.id, expiresAtMs };
  } catch (error) {
    console.log('Help request alert error:', error);
    throw error;
  }
};
