import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
  Alert, TextInput, RefreshControl,
  Modal, SafeAreaView, Platform, NativeModules,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import DashboardHeader from '../components/DashboardHeader';
import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';
import { pick, isCancel, types } from '@react-native-documents/picker';
import { createCallRequest } from '../calls/CallSignalingService';

function ProfChatModal({ targetUserId, onClose, onPressVoiceCall, onPressVideoCall }) {
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
      authorId: auth().currentUser?.uid || 'professional',
      content: input.trim(),
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    
    await firestore().collection('chat_sessions').doc(targetUserId).set({
      lastMessageAt: firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    
    setInput('');
  };

  return (
    <Modal visible={true} animationType="slide">
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={{ padding: 10 }}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Emergency Chat Intervention</Text>
          <View style={styles.modalHeaderActions}>
            <TouchableOpacity onPress={onPressVoiceCall} style={styles.iconBtn} accessibilityLabel="Start voice call">
              <Text style={styles.iconBtnText}>📞</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onPressVideoCall} style={styles.iconBtn} accessibilityLabel="Start video call">
              <Text style={styles.iconBtnText}>🎥</Text>
            </TouchableOpacity>
          </View>
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

export default function ProfessionalDashboard({ navigation }) {
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [profile, setProfile]           = useState(null);
  const [requests, setRequests]         = useState([]);
  const [activeClients, setActiveClients] = useState([]);
  const [escalatedChats, setEscalatedChats] = useState([]);
  const [myChats, setMyChats] = useState([]);
  const [activeChatUserId, setActiveChatUserId] = useState(null);
  const [showSetup, setShowSetup]       = useState(false);
  const [placingCall, setPlacingCall] = useState(false);

  // Profile setup fields
  const [specialty, setSpecialty]       = useState('');
  const [qualification, setQualification] = useState('');
  const [experience, setExperience]     = useState('');
  const [bio, setBio]                   = useState('');
  const [docUploaded, setDocUploaded]   = useState(false);
  const [docFile, setDocFile]           = useState(null);
  const [saving, setSaving]             = useState(false);

  const pickDocument = async () => {
    try {
      let uri;
      let name;
      // Android: avoid @react-native-documents/picker (New Arch / native edge cases) — use app-native picker.
      if (Platform.OS === 'android' && NativeModules.CustomFilePicker?.pickPdf) {
        const file = await NativeModules.CustomFilePicker.pickPdf();
        uri = file.uri;
        name = file.name || 'document.pdf';
      } else {
        const res = await pick({ type: [types.pdf] });
        const file = Array.isArray(res) ? res[0] : res;
        uri = file.uri;
        name = file.name || 'document.pdf';
      }
      setDocUploaded(true);
      setDocFile({ uri, name });
    } catch (err) {
      const cancelled =
        err?.code === 'PICK_CANCELLED' ||
        (typeof isCancel === 'function' && isCancel(err));
      if (!cancelled) {
        Alert.alert('Error', 'Failed to pick document: ' + (err?.message || String(err)));
      }
    }
  };

  const getUserNameById = async (uid) => {
    try {
      const snapDoc = await firestore().collection('users').doc(uid).get();
      return snapDoc.data()?.name || 'User';
    } catch (e) {
      return 'User';
    }
  };

  const requestCall = async (client, mode) => {
    if (!client?.userId) {
      Alert.alert('Error', 'Missing user id for client.');
      return;
    }
    if (placingCall) return;
    setPlacingCall(true);
    try {
      const calleeName =
        client.userName ||
        client.name ||
        (await getUserNameById(client.userId));
      const { callId } = await createCallRequest({
        calleeId: client.userId,
        calleeName,
        mode,
      });
      navigation.navigate('Call', { callId, role: 'caller', mode });
    } catch (e) {
      Alert.alert('Error', 'Could not start call. Please try again.');
    } finally {
      setPlacingCall(false);
    }
  };

  const listenerRef = useRef(null);
  const escListenerRef = useRef(null);
  const myChatListenerRef = useRef(null);

  useEffect(() => {
    loadDashboard();
    return () => { 
      if (listenerRef.current) listenerRef.current(); 
      if (escListenerRef.current) escListenerRef.current();
      if (myChatListenerRef.current) myChatListenerRef.current();
    };
  }, []);

  const loadDashboard = async () => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return;

      // Load professional profile
      const doc = await firestore().collection('professionals').doc(uid).get();
      if (doc.exists) {
        setProfile(doc.data());
        setShowSetup(false);
        startRequestsListener(uid);
        startEscalatedChatsListener(uid);
        loadActiveClients(uid);
      } else {
        setShowSetup(true);
      }
    } catch (e) {
      console.log('Dashboard load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const startRequestsListener = (uid) => {
    if (listenerRef.current) listenerRef.current();

    listenerRef.current = firestore()
      .collection('professional_requests')
      .where('professionalId', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('timestamp', 'desc')
      .onSnapshot(snap => {
        const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setRequests(list);
      }, e => console.log('Requests listener error:', e));
  };

  const startEscalatedChatsListener = (uid) => {
    if (escListenerRef.current) escListenerRef.current();
    if (myChatListenerRef.current) myChatListenerRef.current();

    escListenerRef.current = firestore().collection('chat_sessions')
      .where('status', '==', 'pending_professional')
      .onSnapshot(snap => {
        setEscalatedChats(snap.docs.map(d => ({id: d.id, ...d.data()})));
      });

    myChatListenerRef.current = firestore().collection('chat_sessions')
      .where('status', '==', 'professional_active')
      .where('assignedProfessionalId', '==', uid)
      .onSnapshot(snap => {
        setMyChats(snap.docs.map(d => ({id: d.id, ...d.data()})));
      });
  };

  const loadActiveClients = async (uid) => {
    try {
      const snap = await firestore()
        .collection('professional_requests')
        .where('professionalId', '==', uid)
        .where('status', '==', 'accepted')
        .orderBy('timestamp', 'desc')
        .get();

      const clients = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setActiveClients(clients);
    } catch (e) {
      console.log('Active clients error:', e);
    }
  };

  const saveProfile = async () => {
    if (!specialty.trim() || !qualification.trim()) {
      Alert.alert('Missing Info', 'Please enter specialty and qualification.');
      return;
    }
    if (!docUploaded) {
      Alert.alert('Missing Document', 'Please upload your qualification document (PDF).');
      return;
    }

    setSaving(true);
    try {
      const uid = auth().currentUser?.uid;
      const userDoc = await firestore().collection('users').doc(uid).get();
      const name = userDoc.data()?.name || 'Professional';
      const email = userDoc.data()?.email || '';

      let finalDocUrl = 'https://storage.mindguard.app/dummy-upload/doc.pdf';
      if (docFile) {
        const reference = storage().ref(`qualifications/${uid}_${docFile.name}`);
        await reference.putFile(docFile.uri);
        finalDocUrl = await reference.getDownloadURL();
      }

      const profileData = {
        uid,
        name,
        email,
        specialty: specialty.trim(),
        qualification: qualification.trim(),
        experience: experience.trim(),
        bio: bio.trim(),
        verified: false, // manual verification by admin
        available: true,
        qualificationDocUrl: finalDocUrl,
        createdAt: firestore.FieldValue.serverTimestamp(),
      };

      await firestore().collection('professionals').doc(uid).set(profileData);
      setProfile(profileData);
      setShowSetup(false);
      startRequestsListener(uid);

      Alert.alert(
        '✅ Profile Saved',
        'Your professional profile has been submitted for verification. You\'ll be able to receive client requests once verified.'
      );
    } catch (e) {
      Alert.alert('Error', 'Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRequest = async (requestId, userId, userName, action) => {
    try {
      await firestore()
        .collection('professional_requests')
        .doc(requestId)
        .update({ status: action });

      if (action === 'accepted') {
        // Send notification alert to user
        await firestore().collection('alerts').add({
          userId,
          type: 'REQUEST_ACCEPTED',
          message: `${profile?.name || 'A professional'} has accepted your connection request.`,
          timestamp: firestore.FieldValue.serverTimestamp(),
          read: false,
          date: new Date().toISOString().split('T')[0],
        });

        Alert.alert('✅ Accepted', `You are now connected with ${userName}.`);
        loadActiveClients(auth().currentUser?.uid);
      } else {
        Alert.alert('Declined', `Request from ${userName} has been declined.`);
      }
    } catch (e) {
      Alert.alert('Error', 'Could not process request.');
    }
  };

  const claimEscalation = async (userId) => {
    const uid = auth().currentUser?.uid;
    await firestore().collection('chat_sessions').doc(userId).set({
      status: 'professional_active',
      assignedProfessionalId: uid,
      assignedProfName: profile?.name || 'Professional'
    }, { merge: true });
    Alert.alert('Success', 'You have claimed this chat. Please go to Active Interventions to start talking.');
  };

  const toggleAvailability = async () => {
    try {
      const uid = auth().currentUser?.uid;
      const newVal = !profile?.available;
      await firestore()
        .collection('professionals')
        .doc(uid)
        .update({ available: newVal });
      setProfile(prev => ({ ...prev, available: newVal }));
    } catch (e) {
      console.log('Toggle availability error:', e);
    }
  };

  const openSettings = () => navigation.navigate('Settings');

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffHrs = Math.floor((now - date) / 3600000);
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffHrs < 1) return 'Just now';
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // ── Profile Setup Screen ──
  if (showSetup) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.setupContent}
        showsVerticalScrollIndicator={false}>
        <DashboardHeader
          title="Professional profile"
          subtitle="Complete setup to receive client requests"
          onOpenSettings={openSettings}
        />

        <View style={styles.setupHeader}>
          <Text style={styles.setupEmoji}>👨‍⚕️</Text>
          <Text style={styles.setupTitle}>Complete Your Profile</Text>
          <Text style={styles.setupSub}>
            Set up your professional profile so users can find and connect with you.
            Your profile will be verified by our team before going live.
          </Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formLabel}>Specialty *</Text>
          <TextInput
            style={styles.formInput}
            placeholder="e.g. Clinical Psychology, Counselling"
            placeholderTextColor="#94a3b8"
            value={specialty}
            onChangeText={setSpecialty}
          />

          <Text style={styles.formLabel}>Qualification *</Text>
          <TextInput
            style={styles.formInput}
            placeholder="e.g. M.A. Psychology, RCI Licensed"
            placeholderTextColor="#94a3b8"
            value={qualification}
            onChangeText={setQualification}
          />

          <Text style={styles.formLabel}>Years of Experience</Text>
          <TextInput
            style={styles.formInput}
            placeholder="e.g. 5 years"
            placeholderTextColor="#94a3b8"
            value={experience}
            onChangeText={setExperience}
            keyboardType="numeric"
          />

          <Text style={styles.formLabel}>Short Bio</Text>
          <TextInput
            style={[styles.formInput, styles.formTextArea]}
            placeholder="Tell users a little about your approach and areas of focus..."
            placeholderTextColor="#94a3b8"
            value={bio}
            onChangeText={setBio}
            multiline
            maxLength={300}
          />
          <Text style={styles.charCount}>{bio.length}/300</Text>
          
          <Text style={styles.formLabel}>Qualification Document (PDF) *</Text>
          <TouchableOpacity 
            style={[styles.uploadBtn, docUploaded && styles.uploadBtnSuccess]} 
            onPress={pickDocument}>
            <Text style={styles.uploadBtnText}>{docUploaded ? `✅ ${docFile?.name || 'document.pdf'} attached` : '📄 Attach PDF'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.verificationNote}>
          <Text style={styles.verificationIcon}>ℹ️</Text>
          <Text style={styles.verificationText}>
            Professional accounts are manually verified by the MindGuard team before being shown to users. This typically takes 24-48 hours.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={saveProfile}
          disabled={saving}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Submit Profile for Verification</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    );
  }

  // ── Main Dashboard ──
  return (
    <>
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); loadDashboard(); }}
          colors={['#6366f1']}
        />
      }>
      <DashboardHeader
        title="MindGuard"
        subtitle={profile?.specialty ? `Dr. ${profile?.name} · ${profile.specialty}` : `Dr. ${profile?.name}`}
        onOpenSettings={openSettings}
      />

      {/* ── Verification Status ── */}
      <View style={[
        styles.verificationBanner,
        profile?.verified ? styles.verifiedBanner : styles.pendingBanner,
      ]}>
        <Text style={styles.verificationBannerIcon}>
          {profile?.verified ? '✅' : '⏳'}
        </Text>
        <View style={styles.verificationBannerText}>
          <Text style={[
            styles.verificationBannerTitle,
            { color: profile?.verified ? '#166534' : '#92400e' },
          ]}>
            {profile?.verified ? 'Profile Verified' : 'Verification Pending'}
          </Text>
          <Text style={[
            styles.verificationBannerSub,
            { color: profile?.verified ? '#166534' : '#92400e' },
          ]}>
            {profile?.verified
              ? 'Your profile is live and users can find you.'
              : 'Our team is reviewing your profile. This takes 24-48 hours.'}
          </Text>
        </View>
      </View>

      {/* ── Summary ── */}
      <View style={styles.summaryRow}>
        <View style={[
          styles.summaryCard,
          requests.length > 0 && styles.summaryCardHighlight,
        ]}>
          <Text style={[
            styles.summaryNum,
            requests.length > 0 && { color: '#6366f1' },
          ]}>
            {requests.length}
          </Text>
          <Text style={styles.summaryLabel}>Pending{'\n'}Requests</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{activeClients.length + myChats.length}</Text>
          <Text style={styles.summaryLabel}>Active{'\n'}Clients</Text>
        </View>
        <TouchableOpacity
          style={[
            styles.summaryCard,
            profile?.available ? styles.summaryCardGreen : styles.summaryCardGrey,
          ]}
          onPress={toggleAvailability}>
          <Text style={styles.summaryNum}>
            {profile?.available ? '🟢' : '🔴'}
          </Text>
          <Text style={[
            styles.summaryLabel,
            { color: profile?.available ? '#166534' : '#ef4444' },
          ]}>
            {profile?.available ? 'Available' : 'Unavailable'}
          </Text>
          <Text style={styles.summaryTap}>tap to toggle</Text>
        </TouchableOpacity>
      </View>

      {/* ── Escalated Crisis Interventions ── */}
      {(escalatedChats.length > 0 || myChats.length > 0) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            🚨 Emergency Interventions
          </Text>
          
          {escalatedChats.map(chat => (
             <View key={chat.id} style={[styles.requestCard, { borderLeftColor: '#ef4444' }]}>
               <View style={styles.requestTop}>
                 <Text style={{ fontSize: 24, marginRight: 10 }}>🆘</Text>
                 <View style={styles.requestInfo}>
                   <Text style={[styles.requestName, { color: '#ef4444' }]}>Crisis Chat Pending</Text>
                   <Text style={styles.requestTime}>A guardian requested professional help</Text>
                 </View>
               </View>
               <TouchableOpacity
                 style={[styles.acceptBtn, { backgroundColor: '#ef4444' }]}
                 onPress={() => claimEscalation(chat.userId)}>
                 <Text style={styles.acceptBtnText}>Claim User & Intervene</Text>
               </TouchableOpacity>
             </View>
          ))}

          {myChats.map(chat => (
            <View key={chat.id} style={styles.clientCard}>
               <View style={styles.clientAvatar}>
                 <Text style={styles.clientAvatarText}>🗣️</Text>
               </View>
               <View style={styles.clientInfo}>
                 <Text style={styles.clientName}>Active Crisis User</Text>
                 <Text style={styles.clientSince}>Waiting for your responses</Text>
               </View>
               <View style={styles.clientActions}>
                 <TouchableOpacity
                   style={[styles.callBtn, placingCall && { opacity: 0.5 }]}
                   onPress={() => requestCall({ userId: chat.userId }, 'voice')}
                   disabled={placingCall}
                 >
                   <Text style={styles.callBtnText}>📞</Text>
                 </TouchableOpacity>
                 <TouchableOpacity
                   style={[styles.videoBtn, placingCall && { opacity: 0.5 }]}
                   onPress={() => requestCall({ userId: chat.userId }, 'video')}
                   disabled={placingCall}
                 >
                   <Text style={styles.videoBtnText}>🎥</Text>
                 </TouchableOpacity>
               </View>
               <TouchableOpacity
                 style={styles.interveneBtn}
                 onPress={() => setActiveChatUserId(chat.userId)}>
                 <Text style={styles.interveneBtnText}>Open Chat</Text>
               </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ── Pending Requests ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Connection Requests {requests.length > 0 ? `(${requests.length})` : ''}
        </Text>

        {requests.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>No pending requests</Text>
            <Text style={styles.emptyDesc}>
              {profile?.verified
                ? 'When users in distress reach out, their requests will appear here.'
                : 'Requests will appear here once your profile is verified.'}
            </Text>
          </View>
        ) : (
          requests.map(req => (
            <View key={req.id} style={styles.requestCard}>
              <View style={styles.requestTop}>
                <View style={styles.requestAvatar}>
                  <Text style={styles.requestAvatarText}>
                    {(req.userName || 'U').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.requestInfo}>
                  <Text style={styles.requestName}>{req.userName || 'Anonymous'}</Text>
                  <Text style={styles.requestTime}>{formatTime(req.timestamp)}</Text>
                </View>
                <View style={[
                  styles.requestRiskBadge,
                  req.riskLevel === 'HIGH' && styles.riskHigh,
                  req.riskLevel === 'MODERATE' && styles.riskModerate,
                ]}>
                  <Text style={styles.requestRiskText}>
                    {req.riskLevel === 'HIGH' ? '🔴 HIGH' : req.riskLevel === 'MODERATE' ? '🟡 MOD' : '🟢 OK'}
                  </Text>
                </View>
              </View>

              {req.message && (
                <Text style={styles.requestMessage}>"{req.message}"</Text>
              )}

              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={styles.declineBtn}
                  onPress={() => handleRequest(req.id, req.userId, req.userName, 'declined')}>
                  <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.acceptBtn}
                  onPress={() => handleRequest(req.id, req.userId, req.userName, 'accepted')}>
                  <Text style={styles.acceptBtnText}>✓ Accept</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      {/* ── Active Clients ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active Clients</Text>

        {activeClients.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>👥</Text>
            <Text style={styles.emptyTitle}>No active clients yet</Text>
            <Text style={styles.emptyDesc}>
              Accepted connection requests will appear here.
            </Text>
          </View>
        ) : (
          activeClients.map(client => (
            <View key={client.id} style={styles.clientCard}>
              <View style={styles.clientAvatar}>
                <Text style={styles.clientAvatarText}>
                  {(client.userName || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.clientInfo}>
                <Text style={styles.clientName}>{client.userName || 'Anonymous'}</Text>
                <Text style={styles.clientSince}>
                  Connected {formatTime(client.acceptedAt || client.timestamp)}
                </Text>
              </View>
              <View style={styles.clientActions}>
                <TouchableOpacity
                  style={[styles.callBtn, placingCall && { opacity: 0.5 }]}
                  onPress={() => requestCall(client, 'voice')}
                  disabled={placingCall}
                >
                  <Text style={styles.callBtnText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.videoBtn, placingCall && { opacity: 0.5 }]}
                  onPress={() => requestCall(client, 'video')}
                  disabled={placingCall}
                >
                  <Text style={styles.videoBtnText}>Video</Text>
                </TouchableOpacity>
              </View>
              <View style={[
                styles.clientRisk,
                client.riskLevel === 'HIGH' && styles.riskHigh,
                client.riskLevel === 'MODERATE' && styles.riskModerate,
              ]}>
                <Text style={styles.clientRiskText}>
                  {client.riskLevel === 'HIGH' ? '🔴' : client.riskLevel === 'MODERATE' ? '🟡' : '🟢'}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* ── My Profile ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Profile</Text>
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <Text style={styles.profileLabel}>Specialty</Text>
            <Text style={styles.profileValue}>{profile?.specialty || '—'}</Text>
          </View>
          <View style={styles.profileDivider} />
          <View style={styles.profileRow}>
            <Text style={styles.profileLabel}>Qualification</Text>
            <Text style={styles.profileValue}>{profile?.qualification || '—'}</Text>
          </View>
          <View style={styles.profileDivider} />
          <View style={styles.profileRow}>
            <Text style={styles.profileLabel}>Experience</Text>
            <Text style={styles.profileValue}>{profile?.experience || '—'}</Text>
          </View>
          {profile?.bio ? (
            <>
              <View style={styles.profileDivider} />
              <View style={styles.profileBioRow}>
                <Text style={styles.profileLabel}>Bio</Text>
                <Text style={styles.profileBio}>{profile.bio}</Text>
              </View>
            </>
          ) : null}

          <TouchableOpacity
            style={styles.editProfileBtn}
            onPress={() => setShowSetup(true)}>
            <Text style={styles.editProfileText}>✏️ Edit Profile</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
    {activeChatUserId && (
      <ProfChatModal
        targetUserId={activeChatUserId}
        onPressVoiceCall={() => requestCall({ userId: activeChatUserId }, 'voice')}
        onPressVideoCall={() => requestCall({ userId: activeChatUserId }, 'video')}
        onClose={() => setActiveChatUserId(null)}
      />
    )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, color: '#64748b', fontSize: 15 },

  // Setup
  setupContent: { padding: 20 },
  setupHeader: { alignItems: 'center', marginBottom: 24, marginTop: 12 },
  setupEmoji: { fontSize: 56, marginBottom: 12 },
  setupTitle: { fontSize: 22, fontWeight: 'bold', color: '#1e293b', marginBottom: 8 },
  setupSub: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 21 },
  formCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
    marginBottom: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 8,
  },
  formLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6, marginTop: 12 },
  formInput: {
    backgroundColor: '#f8fafc', borderRadius: 12, padding: 13,
    fontSize: 15, color: '#1e293b', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  formTextArea: { height: 90, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 },
  uploadBtn: { padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', alignItems: 'center', marginTop: 8 },
  uploadBtnSuccess: { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  uploadBtnText: { color: '#475569', fontWeight: 'bold' },
  verificationNote: {
    backgroundColor: '#eff6ff', borderRadius: 14, padding: 14,
    flexDirection: 'row', marginBottom: 20, gap: 10,
  },
  verificationIcon: { fontSize: 18 },
  verificationText: { flex: 1, fontSize: 13, color: '#1e40af', lineHeight: 19 },
  saveBtn: {
    backgroundColor: '#6366f1', padding: 16, borderRadius: 14,
    alignItems: 'center', marginBottom: 12,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  verificationBanner: {
    margin: 16, borderRadius: 14, padding: 14,
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
  },
  verifiedBanner: { backgroundColor: '#dcfce7' },
  pendingBanner: { backgroundColor: '#fef9c3' },
  verificationBannerIcon: { fontSize: 22 },
  verificationBannerText: { flex: 1 },
  verificationBannerTitle: { fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  verificationBannerSub: { fontSize: 12, lineHeight: 18 },

  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  summaryCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14,
    alignItems: 'center', elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6,
  },
  summaryCardHighlight: { backgroundColor: '#eef2ff', borderWidth: 1.5, borderColor: '#6366f1' },
  summaryCardGreen: { backgroundColor: '#dcfce7' },
  summaryCardGrey: { backgroundColor: '#f1f5f9' },
  summaryNum: { fontSize: 26, fontWeight: 'bold', color: '#1e293b' },
  summaryLabel: { fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'center' },
  summaryTap: { fontSize: 9, color: '#94a3b8', marginTop: 2 },

  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: 'bold', color: '#1e293b', marginBottom: 12 },

  emptyCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 8, elevation: 1,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: '#1e293b', marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 20 },

  requestCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    marginBottom: 12, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6,
    borderLeftWidth: 4, borderLeftColor: '#6366f1',
  },
  requestTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  requestAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#eef2ff', alignItems: 'center',
    justifyContent: 'center', marginRight: 10,
  },
  requestAvatarText: { fontSize: 18, fontWeight: 'bold', color: '#6366f1' },
  requestInfo: { flex: 1 },
  requestName: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
  requestTime: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  requestRiskBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, backgroundColor: '#f1f5f9',
  },
  riskHigh: { backgroundColor: '#fef2f2' },
  riskModerate: { backgroundColor: '#fffbeb' },
  requestRiskText: { fontSize: 11, fontWeight: 'bold', color: '#475569' },
  requestMessage: {
    fontSize: 13, color: '#64748b', fontStyle: 'italic',
    marginBottom: 12, lineHeight: 19,
  },
  requestActions: { flexDirection: 'row', gap: 10 },
  declineBtn: {
    flex: 1, padding: 11, borderRadius: 10,
    alignItems: 'center', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  declineBtnText: { color: '#64748b', fontWeight: '600', fontSize: 14 },
  acceptBtn: {
    flex: 1, padding: 11, borderRadius: 10,
    alignItems: 'center', backgroundColor: '#6366f1',
  },
  acceptBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  clientCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
    elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6,
  },
  clientAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#f0fdf4', alignItems: 'center',
    justifyContent: 'center', marginRight: 12,
  },
  clientAvatarText: { fontSize: 18, fontWeight: 'bold', color: '#22c55e' },
  clientInfo: { flex: 1 },
  clientName: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
  clientSince: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  clientActions: { flexDirection: 'row', gap: 8, marginRight: 10 },
  callBtn: {
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  callBtnText: { color: '#4338ca', fontWeight: '800', fontSize: 12 },
  videoBtn: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  videoBtnText: { color: '#166534', fontWeight: '800', fontSize: 12 },
  clientRisk: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
  },
  clientRiskText: { fontSize: 16 },

  profileCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 8,
  },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  profileBioRow: { paddingVertical: 10 },
  profileDivider: { height: 1, backgroundColor: '#f1f5f9' },
  profileLabel: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  profileValue: { fontSize: 13, color: '#1e293b', fontWeight: '500', flex: 1, textAlign: 'right' },
  profileBio: { fontSize: 13, color: '#475569', lineHeight: 20, marginTop: 4 },
  editProfileBtn: { marginTop: 14, padding: 11, borderRadius: 10, alignItems: 'center', borderWidth: 1.5, borderColor: '#e2e8f0' },
  editProfileText: { color: '#6366f1', fontWeight: '600', fontSize: 14 },
  
  interveneBtn: { backgroundColor: '#fee2e2', padding: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#fca5a5' },
  interveneBtnText: { color: '#dc2626', fontWeight: 'bold' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#fff', paddingTop: 10, paddingBottom: 10, elevation: 2 },
  closeText: { color: '#64748b', fontWeight: '600', fontSize: 16 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
  modalHeaderActions: { flexDirection: 'row', gap: 10, paddingRight: 10 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#c7d2fe' },
  iconBtnText: { fontSize: 18 },
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
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: 'bold' }
});