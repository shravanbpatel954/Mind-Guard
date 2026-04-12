import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

/**
 * STUN + public TURN (symmetric NAT / mobile carriers often need relay).
 * Replace with your own TURN for production if this relay is unavailable.
 */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export async function getLocalStream(mode) {
  const isVideo = mode === 'video';
  const constraints = {
    audio: true,
    video: isVideo
      ? {
          facingMode: 'user',
          width: 640,
          height: 480,
          frameRate: 24,
        }
      : false,
  };
  return await mediaDevices.getUserMedia(constraints);
}

export function createPeerConnection({ onIceCandidate, onRemoteStream }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (event) => {
    if (event.candidate) onIceCandidate?.(event.candidate);
  };

  pc.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (stream) onRemoteStream?.(stream);
  };

  return pc;
}

/** Route playback: true = speakerphone, false = earpiece (voice-call default). */
export function applyCallSpeakerRoute(speakerOn) {
  const on = !!speakerOn;
  try {
    InCallManager.setForceSpeakerphoneOn(on);
  } catch (e) {
    console.log('setForceSpeakerphoneOn error', e);
  }
  try {
    InCallManager.setSpeakerphoneOn(on);
  } catch (e) {
    /* optional on some builds */
  }
}

export async function startInCallAudio({ video, speakerOn }) {
  try {
    InCallManager.start({ media: video ? 'video' : 'audio' });
    applyCallSpeakerRoute(speakerOn);
  } catch (e) {
    console.log('InCallManager start error', e);
  }
}

export async function stopInCallAudio() {
  try {
    InCallManager.stop();
  } catch (e) {}
}

export async function setRemoteDescription(pc, sdp) {
  if (!sdp || !pc) return;
  const type = sdp.type;
  const sdpStr = sdp.sdp;
  if (!type || !sdpStr) return;
  await pc.setRemoteDescription(new RTCSessionDescription({ type, sdp: sdpStr }));
}

export async function setLocalDescription(pc, desc) {
  await pc.setLocalDescription(desc);
  return pc.localDescription;
}

export async function addIceCandidate(pc, cand) {
  if (!pc || !cand) return;
  const init =
    typeof cand === 'object' && cand.candidate !== undefined
      ? {
          candidate: cand.candidate,
          sdpMid: cand.sdpMid ?? null,
          sdpMLineIndex: cand.sdpMLineIndex ?? 0,
        }
      : null;
  if (!init || init.candidate == null) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(init));
  } catch (e) {
    console.log('addIceCandidate error', e);
    throw e;
  }
}

export function setMuted(stream, muted) {
  if (!stream) return;
  stream.getAudioTracks().forEach((t) => {
    t.enabled = !muted;
  });
}

export function setCameraEnabled(stream, enabled) {
  setOutgoingVideoEnabled(null, stream, enabled);
}

/** Mute outgoing video for the peer (stream + sender tracks). */
export function setOutgoingVideoEnabled(pc, stream, enabled) {
  const on = !!enabled;
  if (stream) {
    stream.getVideoTracks().forEach((t) => {
      t.enabled = on;
    });
  }
  if (pc && typeof pc.getSenders === 'function') {
    pc.getSenders().forEach((sender) => {
      const t = sender.track;
      if (t && t.kind === 'video') {
        t.enabled = on;
      }
    });
  }
}

export async function switchCamera(stream) {
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track) return;
  if (typeof track._switchCamera === 'function') track._switchCamera();
}

export function stopStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {}
}
