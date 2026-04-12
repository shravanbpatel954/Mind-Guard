import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { sendCalmBotGuardianAlert } from '../alerts/AlertManager';
import { startLiveLocationSharing } from '../monitoring/LiveLocationSharing';
import {
  buildCrisisFollowup,
  buildReply,
  classify,
  nextBotState,
} from '../bot/CalmBotEngine';

// ─── CONSTANTS ────────────────────────────────────────────────
const QUICK_REPLIES = [
  { id: 'okay',     label: "I'm okay",          emoji: '😊' },
  { id: 'notgreat', label: "Not feeling great",  emoji: '😔' },
  { id: 'help',     label: "I need help",        emoji: '🆘' },
];

// ─── COMPONENT ───────────────────────────────────────────────
export default function ChatScreen({ navigation, route }) {
  const riskLevel = route?.params?.riskLevel || 'HIGH';

  const uid = auth().currentUser?.uid;

  const [messages, setMessages]           = useState([]);
  const [input, setInput]                 = useState('');
  const [loading, setLoading]             = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const [botSuspended, setBotSuspended]   = useState(false);
  const botStateRef = useRef('normal'); // normal | supportive | crisis_check
  const scrollRef = useRef(null);
  /** Firestore can emit multiple empty snapshots; seed the greeting only once. */
  const greetingSeededRef = useRef(false);

  const saveMessage = useCallback(async (role, content, authorId = 'user') => {
    if (!uid) return;
    await firestore().collection('chat_sessions').doc(uid).collection('messages').add({
      role,
      content,
      authorId,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });

    await firestore().collection('chat_sessions').doc(uid).set({
      lastMessageAt: firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;

    greetingSeededRef.current = false;

    const sessionRef = firestore().collection('chat_sessions').doc(uid);
    sessionRef.set({
      userId: uid,
      // If a guardian previously took over chat, ensure CalmBot can reply again
      // when the user opens their own chat.
      botSuspended: false,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const unsubSession = sessionRef.onSnapshot((snapDoc) => {
      if (snapDoc.exists) {
        setBotSuspended(snapDoc.data().botSuspended || false);
      }
    });

    const unsubMessages = sessionRef
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot((snap) => {
        if (!snap) return;
        const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMessages(msgs);

        if (msgs.length === 0) {
          if (greetingSeededRef.current) return;
          greetingSeededRef.current = true;
          const greeting =
            riskLevel === 'HIGH'
              ? "Hey, I noticed your patterns today looked a little different from usual 🌿\n\nI'm CalmBot — I'm here to check in, not to judge. You don't have to share anything you're not comfortable with.\n\nHow are you feeling right now?"
              : "Hey! 👋 I'm CalmBot, your wellness companion.\n\nI'm here whenever you want to talk. How are you doing today?";
          saveMessage('assistant', greeting, 'bot').catch((e) => console.log('CalmBot greeting save error:', e));
        } else {
          greetingSeededRef.current = false;
          if (msgs[msgs.length - 1].role === 'assistant') {
            setLoading(false);
          }
        }
      });

    return () => {
      unsubSession();
      unsubMessages();
    };
  }, [uid, riskLevel, saveMessage]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
  }, [messages, loading]);

  const escalateSession = async (kind, userPreview = '') => {
    if (!uid || !kind) return;
    await firestore().collection('chat_sessions').doc(uid).set({
      status: 'guardian_notified',
      botSuspended: false, // Ensure bot continues to interact with user
      escalatedAt: firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    try {
      const info = await sendCalmBotGuardianAlert({ kind, userMessagePreview: userPreview });
      if (info?.alertId) {
        startLiveLocationSharing(info.alertId, info.expiresAtMs);
      }
    } catch (e) {
      console.log('Guardian alert failed', e);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    setShowQuickReplies(false);
    setInput('');
    setLoading(true);

    await saveMessage('user', text.trim(), uid);

    const prevState = botStateRef.current;
    const classification = classify(text);
    const nextState = nextBotState(prevState, classification);
    botStateRef.current = nextState;

    const needsEscalation = classification.intent === 'self_harm' || classification.intent === 'help';
    if (needsEscalation) {
      const kind = classification.intent === 'self_harm' ? 'SELF_HARM' : 'HELP';
      await escalateSession(kind, text.trim());
    }

    setTimeout(async () => {
      if (botSuspended) {
        setLoading(false);
      } else {
        let reply = buildReply({ text, classification, state: nextState });

        // If we're in crisis_check and user just answered, provide follow-up.
        if (prevState === 'crisis_check') {
          const follow = buildCrisisFollowup(text);
          reply = follow.message;
          if (follow.escalateToGuardian) {
            await escalateSession('CRISIS_CONFIRMED', text.trim());
          }
          botStateRef.current = follow.severity === 'high' ? 'crisis_check' : 'supportive';
        }
        await saveMessage('assistant', reply, 'bot');
      }
    }, 1000 + Math.random() * 500);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.botAvatar}>
          <Text style={styles.botAvatarText}>🤖</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>CalmBot</Text>
          <Text style={styles.headerSub}>Your wellness companion</Text>
        </View>
      </View>

      {/* ── Messages ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}>

        {messages.map(msg => (
          <View
            key={msg.id}
            style={[
              styles.bubble,
              msg.role === 'user' ? styles.userBubble : styles.botBubble,
            ]}>
            <Text style={[
              styles.bubbleText,
              msg.role === 'user' ? styles.userText : styles.botText,
            ]}>
              {msg.content}
            </Text>
          </View>
        ))}

        {/* Typing indicator */}
        {loading && (
          <View style={[styles.bubble, styles.botBubble, styles.typingBubble]}>
            <ActivityIndicator size="small" color="#6366f1" />
            <Text style={styles.typingText}>CalmBot is typing...</Text>
          </View>
        )}

        {/* Quick replies */}
        {showQuickReplies && !loading && (
          <View style={styles.quickReplies}>
            {QUICK_REPLIES.map(qr => (
              <TouchableOpacity
                key={qr.id}
                style={styles.quickReplyBtn}
                onPress={() => sendMessage(qr.label)}>
                <Text style={styles.quickReplyText}>{qr.emoji}  {qr.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Input ── */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor="#94a3b8"
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
          onSubmitEditing={() => sendMessage(input)}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!input.trim() || loading) && styles.sendBtnDisabled,
          ]}
          onPress={() => sendMessage(input)}
          disabled={!input.trim() || loading}>
          <Text style={styles.sendBtnText}>↑</Text>
        </TouchableOpacity>
      </View>

    </KeyboardAvoidingView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  backBtn: { padding: 8, marginRight: 4 },
  backArrow: { fontSize: 22, color: '#6366f1' },
  botAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  botAvatarText: { fontSize: 20 },
  headerInfo: { flex: 1 },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  headerSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  messages: { flex: 1 },
  messagesContent: {
    padding: 16,
    paddingBottom: 4,
  },
  bubble: {
    maxWidth: '82%',
    padding: 12,
    borderRadius: 18,
    marginBottom: 10,
  },
  botBubble: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  userBubble: {
    backgroundColor: '#6366f1',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  botText:  { color: '#1e293b' },
  userText: { color: '#fff' },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  typingText: {
    fontSize: 13,
    color: '#94a3b8',
    marginLeft: 8,
  },
  quickReplies: {
    marginTop: 4,
    marginBottom: 8,
    gap: 8,
  },
  quickReplyBtn: {
    backgroundColor: '#eef2ff',
    borderWidth: 1.5,
    borderColor: '#6366f1',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
  },
  quickReplyText: {
    color: '#4f46e5',
    fontWeight: '600',
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1e293b',
    maxHeight: 100,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  sendBtn: {
    backgroundColor: '#6366f1',
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
});