import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import {
  addCandidate,
  attachAnswer,
  attachOffer,
  listenToCall,
  listenToCandidates,
  markMissedIfExpired,
  setCallStatus,
} from '../calls/CallSignalingService';
import {
  addIceCandidate,
  createPeerConnection,
  getLocalStream,
  setCameraEnabled,
  setLocalDescription,
  setMuted,
  setRemoteDescription,
  startInCallAudio,
  stopInCallAudio,
  stopStream,
  switchCamera,
} from '../calls/WebRTCService';

export default function CallScreen({ navigation, route }) {
  const callId = route?.params?.callId;
  const role = route?.params?.role; // 'caller' | 'callee'
  const mode = route?.params?.mode || 'voice'; // 'voice' | 'video'

  const [call, setCall] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [localStream, setLocalStreamState] = useState(null);
  const [remoteStream, setRemoteStreamState] = useState(null);
  const [muted, setMutedState] = useState(false);
  const [camOn, setCamOn] = useState(mode === 'video');

  const pcRef = useRef(null);
  const joinedRef = useRef(false);
  const teardownRef = useRef(false);

  const isVideo = mode === 'video';
  const title = useMemo(() => (isVideo ? 'Video call' : 'Voice call'), [isVideo]);

  useEffect(() => {
    if (!callId || (role !== 'caller' && role !== 'callee')) {
      Alert.alert('Error', 'Invalid call session.');
      navigation.goBack();
      return;
    }

    let unsubCall = null;
    let unsubCandidates = null;

    const start = async () => {
      try {
        setStatus(role === 'caller' ? 'ringing' : 'connecting');
        unsubCall = listenToCall(
          callId,
          (c) => {
            setCall(c);
            if (c.status === 'declined') setStatus('declined');
            if (c.status === 'missed') setStatus('missed');
            if (c.status === 'ended') setStatus('ended');
            if (c.status === 'accepted') setStatus('connected');
          },
          (e) => console.log('Call doc listen error', e),
        );

        unsubCandidates = listenToCandidates(
          callId,
          role,
          async (cand) => {
            if (!pcRef.current) return;
            try {
              await addIceCandidate(pcRef.current, cand);
            } catch (e) {
              console.log('Add ICE error', e);
            }
          },
          (e) => console.log('Candidate listen error', e),
        );

        // If caller, periodically mark missed after timeout
        if (role === 'caller') {
          setTimeout(() => markMissedIfExpired(callId).catch(() => {}), 50 * 1000);
        }

        await joinIfPossible();
      } catch (e) {
        console.log('Call start error', e);
        Alert.alert('Error', 'Could not start call.');
        navigation.goBack();
      }
    };

    start();

    return () => {
      if (unsubCall) unsubCall();
      if (unsubCandidates) unsubCandidates();
      cleanup().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  const joinIfPossible = async () => {
    if (joinedRef.current) return;
    joinedRef.current = true;

    const pc = createPeerConnection({
      onIceCandidate: async (cand) => {
        try {
          await addCandidate(callId, role, cand);
        } catch (e) {
          console.log('Add candidate error', e);
        }
      },
      onRemoteStream: (s) => setRemoteStreamState(s),
    });
    pcRef.current = pc;

    const stream = await getLocalStream(mode);
    setLocalStreamState(stream);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    await startInCallAudio({ video: isVideo });

    if (role === 'caller') {
      // Create offer now
      const offerDesc = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: isVideo });
      const local = await setLocalDescription(pc, offerDesc);
      await attachOffer(callId, local);
    } else {
      // Callee waits for offer, then answers
      const tryAnswer = async () => {
        const c = call;
        if (!c?.offer) return false;
        await setRemoteDescription(pc, c.offer);
        const answerDesc = await pc.createAnswer();
        const local = await setLocalDescription(pc, answerDesc);
        await attachAnswer(callId, local);
        return true;
      };

      // If offer isn't in state yet, we'll respond when `call` updates
      if (!(await tryAnswer())) {
        // no-op; effect below will handle once offer arrives
      }
    }
  };

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || role !== 'callee') return;
    if (!call?.offer) return;
    if (call?.answer) return;
    (async () => {
      try {
        await setRemoteDescription(pc, call.offer);
        const answerDesc = await pc.createAnswer();
        const local = await setLocalDescription(pc, answerDesc);
        await attachAnswer(callId, local);
      } catch (e) {
        console.log('Answer flow error', e);
      }
    })();
  }, [call?.offer, call?.answer, callId, role]);

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || role !== 'caller') return;
    if (!call?.answer) return;
    (async () => {
      try {
        await setRemoteDescription(pc, call.answer);
      } catch (e) {
        console.log('Set remote answer error', e);
      }
    })();
  }, [call?.answer, callId, role]);

  const cleanup = async () => {
    if (teardownRef.current) return;
    teardownRef.current = true;
    try {
      if (pcRef.current) {
        try {
          pcRef.current.ontrack = null;
          pcRef.current.onicecandidate = null;
          pcRef.current.close();
        } catch (e) {}
        pcRef.current = null;
      }
      if (localStream) stopStream(localStream);
      if (remoteStream) stopStream(remoteStream);
      await stopInCallAudio();
    } catch (e) {}
  };

  const hangup = async () => {
    try {
      await setCallStatus(callId, 'ended');
    } catch (e) {}
    await cleanup();
    navigation.goBack();
  };

  const toggleMute = () => {
    const next = !muted;
    setMutedState(next);
    setMuted(localStream, next);
  };

  const toggleCamera = () => {
    if (!isVideo) return;
    const next = !camOn;
    setCamOn(next);
    setCameraEnabled(localStream, next);
  };

  const flipCamera = async () => {
    if (!isVideo) return;
    await switchCamera(localStream);
  };

  const peerName =
    role === 'caller'
      ? call?.calleeName || 'User'
      : call?.callerName || 'Professional';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{peerName}</Text>
        <Text style={styles.badge}>
          {status === 'ringing' ? 'Ringing…' : status === 'connecting' ? 'Connecting…' : status === 'connected' ? 'Connected' : status}
        </Text>
      </View>

      {isVideo ? (
        <View style={styles.videoWrap}>
          {remoteStream ? (
            <RTCView
              style={styles.remoteVideo}
              streamURL={remoteStream.toURL()}
              objectFit="cover"
            />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Text style={styles.videoPlaceholderText}>Waiting for video…</Text>
            </View>
          )}

          {localStream ? (
            <RTCView
              style={styles.localVideo}
              streamURL={localStream.toURL()}
              objectFit="cover"
              mirror={Platform.OS === 'ios'}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.voiceWrap}>
          <Text style={styles.voiceAvatar}>{peerName?.charAt(0)?.toUpperCase() || 'U'}</Text>
          <Text style={styles.voiceHint}>Audio call in progress</Text>
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity style={[styles.ctrlBtn, muted && styles.ctrlBtnActive]} onPress={toggleMute}>
          <Text style={[styles.ctrlText, muted && styles.ctrlTextActive]}>{muted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>

        {isVideo ? (
          <>
            <TouchableOpacity style={[styles.ctrlBtn, !camOn && styles.ctrlBtnActive]} onPress={toggleCamera}>
              <Text style={[styles.ctrlText, !camOn && styles.ctrlTextActive]}>{camOn ? 'Camera off' : 'Camera on'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlBtn} onPress={flipCamera}>
              <Text style={styles.ctrlText}>Flip</Text>
            </TouchableOpacity>
          </>
        ) : null}

        <TouchableOpacity style={styles.hangupBtn} onPress={hangup}>
          <Text style={styles.hangupText}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  header: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  sub: { color: '#cbd5e1', marginTop: 4, fontSize: 14 },
  badge: { color: '#93c5fd', marginTop: 6, fontSize: 12, fontWeight: '700' },
  videoWrap: { flex: 1, margin: 14, borderRadius: 18, overflow: 'hidden', backgroundColor: '#0f172a' },
  remoteVideo: { flex: 1 },
  localVideo: { position: 'absolute', right: 10, top: 10, width: 120, height: 160, borderRadius: 14, overflow: 'hidden' },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  videoPlaceholderText: { color: '#94a3b8', fontSize: 14 },
  voiceWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  voiceAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#1f2937',
    color: '#fff',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 44,
    fontWeight: '800',
  },
  voiceHint: { color: '#94a3b8', marginTop: 14, fontSize: 13 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 16, paddingBottom: 24 },
  ctrlBtn: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1f2937',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  ctrlBtnActive: { backgroundColor: '#111827', borderColor: '#60a5fa' },
  ctrlText: { color: '#e2e8f0', fontWeight: '700', fontSize: 12 },
  ctrlTextActive: { color: '#93c5fd' },
  hangupBtn: {
    marginLeft: 'auto',
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  hangupText: { color: '#fff', fontWeight: '900', fontSize: 12 },
});

