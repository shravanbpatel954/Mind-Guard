import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export async function getLocalStream(mode) {
  const isVideo = mode === 'video';
  const constraints = {
    audio: true,
    video: isVideo
      ? {
          facingMode: 'user',
          width: 640,
          height: 360,
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

export async function startInCallAudio({ video }) {
  try {
    InCallManager.start({ media: video ? 'video' : 'audio' });
    InCallManager.setForceSpeakerphoneOn(video ? true : false);
  } catch (e) {}
}

export async function stopInCallAudio() {
  try {
    InCallManager.stop();
  } catch (e) {}
}

export async function setRemoteDescription(pc, sdp) {
  if (!sdp) return;
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

export async function setLocalDescription(pc, desc) {
  await pc.setLocalDescription(desc);
  return pc.localDescription;
}

export async function addIceCandidate(pc, cand) {
  if (!cand) return;
  await pc.addIceCandidate(new RTCIceCandidate(cand));
}

export function setMuted(stream, muted) {
  if (!stream) return;
  stream.getAudioTracks().forEach((t) => {
    t.enabled = !muted;
  });
}

export function setCameraEnabled(stream, enabled) {
  if (!stream) return;
  stream.getVideoTracks().forEach((t) => {
    t.enabled = !!enabled;
  });
}

export async function switchCamera(stream) {
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track) return;
  // react-native-webrtc supports _switchCamera on video track (platform-specific)
  if (typeof track._switchCamera === 'function') track._switchCamera();
}

export function stopStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {}
}

