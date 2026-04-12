import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  applyCallSpeakerRoute,
  createPeerConnection,
  getLocalStream,
  setLocalDescription,
  setMuted,
  setOutgoingVideoEnabled,
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
  /** WhatsApp-like: video defaults to speaker; voice to earpiece. */
  const [speakerOn, setSpeakerOn] = useState(() => mode === 'video');

  const pcRef = useRef(null);
  const joinedRef = useRef(false);
  const teardownRef = useRef(false);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteIceGateRef = useRef(false);
  const icePendingRef = useRef([]);
  const calleeAnswerSentRef = useRef(false);
  const callerRemoteAnswerAppliedRef = useRef(false);
  const leavingRef = useRef(false);

  const isVideo = mode === 'video';
  const title = useMemo(() => (isVideo ? 'Video call' : 'Voice call'), [isVideo]);

  const flushIceQueue = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !remoteIceGateRef.current) return;
    const pending = [...icePendingRef.current];
    icePendingRef.current = [];
    for (const cand of pending) {
      try {
        await addIceCandidate(pc, cand);
      } catch (e) {
        console.log('ICE flush error', e);
      }
    }
  }, []);

  const enqueueOrAddIce = useCallback(
    async (cand) => {
      const pc = pcRef.current;
      if (!pc) {
        icePendingRef.current.push(cand);
        return;
      }
      if (!remoteIceGateRef.current) {
        icePendingRef.current.push(cand);
        return;
      }
      try {
        await addIceCandidate(pc, cand);
      } catch (e) {
        icePendingRef.current.push(cand);
      }
    },
    [],
  );

  const cleanup = useCallback(async () => {
    if (teardownRef.current) return;
    teardownRef.current = true;
    remoteIceGateRef.current = false;
    icePendingRef.current = [];
    try {
      if (pcRef.current) {
        try {
          pcRef.current.ontrack = null;
          pcRef.current.onicecandidate = null;
          pcRef.current.close();
        } catch (e) {}
        pcRef.current = null;
      }
      if (localStreamRef.current) stopStream(localStreamRef.current);
      if (remoteStreamRef.current) stopStream(remoteStreamRef.current);
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      setLocalStreamState(null);
      setRemoteStreamState(null);
      await stopInCallAudio();
    } catch (e) {}
  }, []);

  const leaveCall = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    await cleanup();
    try {
      navigation.goBack();
    } catch (e) {}
  }, [cleanup, navigation]);

  useEffect(() => {
    if (!callId || (role !== 'caller' && role !== 'callee')) {
      Alert.alert('Error', 'Invalid call session.');
      navigation.goBack();
      return;
    }

    let unsubCall = null;
    let unsubCandidates = null;

    const joinIfPossible = async () => {
      if (joinedRef.current) return;
      joinedRef.current = true;
      remoteIceGateRef.current = false;

      const pc = createPeerConnection({
        onIceCandidate: async (cand) => {
          try {
            await addCandidate(callId, role, cand);
          } catch (e) {
            console.log('Add candidate error', e);
          }
        },
        onRemoteStream: (s) => {
          remoteStreamRef.current = s;
          setRemoteStreamState(s);
        },
      });
      pcRef.current = pc;

      const stream = await getLocalStream(mode);
      localStreamRef.current = stream;
      setLocalStreamState(stream);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await startInCallAudio({ video: isVideo, speakerOn: mode === 'video' });

      if (role === 'caller') {
        const offerDesc = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: isVideo,
        });
        const local = await setLocalDescription(pc, offerDesc);
        await attachOffer(callId, local);
      }
    };

    const start = async () => {
      try {
        setStatus(role === 'caller' ? 'ringing' : 'connecting');
        unsubCall = listenToCall(
          callId,
          (c) => {
            setCall(c);
            const st = c.status;
            if (st === 'ended' || st === 'declined' || st === 'missed') {
              setStatus(st);
            } else if (st === 'accepted') {
              setStatus('connected');
            } else if (st === 'pending' && role === 'caller') {
              setStatus('ringing');
            } else if (st === 'pending') {
              setStatus('connecting');
            }
          },
          (e) => console.log('Call doc listen error', e),
        );

        unsubCandidates = listenToCandidates(callId, role, (cand) => {
          enqueueOrAddIce(cand).catch(() => {});
        }, (e) => console.log('Candidate listen error', e));

        if (role === 'caller') {
          setTimeout(() => markMissedIfExpired(callId).catch(() => {}), 50 * 1000);
        }

        await joinIfPossible();
      } catch (e) {
        console.log('Call start error', e);
        joinedRef.current = false;
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

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || role !== 'callee') return;
    if (!call?.offer) return;
    if (call?.answer) return;
    if (calleeAnswerSentRef.current) return;

    (async () => {
      try {
        await setRemoteDescription(pc, call.offer);
        remoteIceGateRef.current = true;
        await flushIceQueue();

        const answerDesc = await pc.createAnswer();
        const local = await setLocalDescription(pc, answerDesc);
        calleeAnswerSentRef.current = true;
        await attachAnswer(callId, local);
      } catch (e) {
        console.log('Answer flow error', e);
        calleeAnswerSentRef.current = false;
      }
    })();
  }, [call?.offer, call?.answer, callId, role, flushIceQueue]);

  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || role !== 'caller') return;
    if (!call?.answer) return;
    if (callerRemoteAnswerAppliedRef.current) return;

    (async () => {
      try {
        await setRemoteDescription(pc, call.answer);
        remoteIceGateRef.current = true;
        callerRemoteAnswerAppliedRef.current = true;
        await flushIceQueue();
      } catch (e) {
        console.log('Set remote answer error', e);
        callerRemoteAnswerAppliedRef.current = false;
      }
    })();
  }, [call?.answer, callId, role, flushIceQueue]);

  /** Remote party ended / declined / missed — tear down and leave for both sides. */
  useEffect(() => {
    const st = call?.status;
    if (!st || (st !== 'ended' && st !== 'declined' && st !== 'missed')) return;
    const t = setTimeout(() => {
      leaveCall();
    }, 400);
    return () => clearTimeout(t);
  }, [call?.status, leaveCall]);

  const hangup = async () => {
    try {
      await setCallStatus(callId, 'ended');
    } catch (e) {}
    await leaveCall();
  };

  const toggleMute = () => {
    const next = !muted;
    setMutedState(next);
    setMuted(localStreamRef.current, next);
  };

  const toggleCamera = () => {
    if (!isVideo) return;
    const next = !camOn;
    setCamOn(next);
    setOutgoingVideoEnabled(pcRef.current, localStreamRef.current, next);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    applyCallSpeakerRoute(next);
  };

  const flipCamera = async () => {
    if (!isVideo) return;
    await switchCamera(localStreamRef.current);
  };

  const peerName =
    role === 'caller' ? call?.calleeName || 'User' : call?.callerName || 'Professional';

  const badgeText =
    status === 'ringing'
      ? 'Ringing…'
      : status === 'connecting'
        ? 'Connecting…'
        : status === 'connected'
          ? 'Connected'
          : status === 'ended'
            ? 'Call ended'
            : status === 'declined'
              ? 'Declined'
              : status === 'missed'
                ? 'Missed'
                : status;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{peerName}</Text>
        <Text style={styles.badge}>{badgeText}</Text>
      </View>

      {isVideo ? (
        <View style={styles.videoWrap} collapsable={false}>
          {remoteStream ? (
            <RTCView
              style={styles.remoteVideo}
              streamURL={remoteStream.toURL()}
              objectFit="cover"
              {...(Platform.OS === 'android' ? { zOrder: 0 } : {})}
            />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Text style={styles.videoPlaceholderText}>Waiting for video…</Text>
            </View>
          )}

          <View style={styles.localPip} pointerEvents="box-none">
            {localStream && camOn ? (
              <RTCView
                style={styles.localRtc}
                streamURL={localStream.toURL()}
                objectFit="cover"
                mirror={Platform.OS === 'ios'}
                {...(Platform.OS === 'android' ? { zOrder: 1 } : {})}
              />
            ) : localStream ? (
              <View style={[styles.localRtc, styles.localPipPlaceholder]}>
                <Text style={styles.localPipOff}>Camera off</Text>
              </View>
            ) : (
              <View style={[styles.localRtc, styles.localPipPlaceholder]}>
                <Text style={styles.localPipOff}>Starting…</Text>
              </View>
            )}
          </View>
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

        <TouchableOpacity
          style={[styles.ctrlBtn, speakerOn && styles.ctrlBtnActive]}
          onPress={toggleSpeaker}
          accessibilityLabel={speakerOn ? 'Speaker on' : 'Earpiece'}
        >
          <Text style={[styles.ctrlText, speakerOn && styles.ctrlTextActive]}>
            {speakerOn ? 'Speaker' : 'Earpiece'}
          </Text>
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
  remoteVideo: { flex: 1, width: '100%', height: '100%' },
  localPip: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 120,
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#334155',
    zIndex: 20,
    elevation: 20,
  },
  localRtc: { width: '100%', height: '100%' },
  localPipPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  localPipOff: { color: '#94a3b8', fontWeight: '700', fontSize: 12, textAlign: 'center' },
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
