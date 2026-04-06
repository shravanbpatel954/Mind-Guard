import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, Linking,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { sendHelpRequestAlert } from '../alerts/AlertManager';
import { startLiveLocationSharing } from '../monitoring/LiveLocationSharing';

// ─── RESPONSE ENGINE ─────────────────────────────────────────
const RESPONSES = {
  okay: [
    "That's good to hear! 😊 Sometimes our patterns change for totally normal reasons — a busy day, staying up late, or just an off day.\n\nIs there anything on your mind lately?",
    "Glad you're doing okay! 🌿 Even on good days it helps to check in with yourself.\n\nWhat's been keeping you busy today?",
  ],
  notgreat: [
    "Thank you for being honest with me. 💙 It takes courage to say that.\n\nWould you like to try a quick breathing exercise? It only takes 2 minutes and genuinely helps.",
    "I hear you. Not every day feels good and that's completely okay. 🌧️\n\nCan you tell me a little more about what's been going on?",
  ],
  help: [
    "I'm really glad you reached out. 💙 You don't have to go through this alone.\n\nI've shown the helpline below — please consider calling them. They're kind, understanding people.",
    "Thank you for trusting me with this. 🤝 That matters so much.\n\nPlease use the helpline below — talking to someone really helps. I can also notify your guardian if you'd like.",
  ],
  breathing: [
    "Let's do the 4-7-8 breathing technique together 🌬️\n\n→ Breathe IN for 4 seconds\n→ HOLD for 7 seconds\n→ Breathe OUT slowly for 8 seconds\n\nRepeat 3 times. How do you feel after?",
  ],
  walk: [
    "A 10-minute walk outside can genuinely shift your mood. 🚶\n\nNo destination needed — just fresh air and movement. Even stepping outside your door counts.",
  ],
  water: [
    "Something small but real — drink a full glass of water right now. 💧\n\nDehydration quietly affects mood more than most people realize. Then tell me how you're feeling.",
  ],
  friend: [
    "Is there someone you trust — a friend, sibling, or family member — you could call or message right now? 📱\n\nSometimes just hearing a familiar voice helps more than anything else.",
  ],
  better: [
    "I'm really glad to hear that. 🌟 Small steps matter.\n\nKeep being kind to yourself today. You can always come back and talk whenever you need.",
    "That's wonderful. 💚 You showed up for yourself today and that counts.\n\nTake it one hour at a time. I'm here whenever you need.",
  ],
  hindi: [
    "Haan, main thoda Hindi/Hinglish samajh aur bol sakta hoon! Aap mujhse jaise chahein baat kar sakte hain. Aap kaisa feel kar rahe hain abhi?",
    "Ji haan! 💙 Main Hinglish mein bhi baat kar sakta hoon. Aaj aapka din kaisa ja raha hai?"
  ],
  hinglish_distress: [
    "Main samajh sakta hoon ki yeh waqt aasan nahi hai. 💙 Aap akele nahi hain. Kya aap mujhe aur batana chahenge?",
    "Kabhi kabhi sab kuch bahut bhaari lagta hai. 🌧️ Ek lamba saans lijiye. Agar aapko theek lage, toh kya aap kisi dost ko call karna chahenge?"
  ],
  default: [
    "I'm here with you. 💙 Sometimes just talking helps.\n\nWhat's on your mind?",
    "Thank you for sharing that with me. 🌿 You're not alone in this.\n\nWould you like to try a breathing exercise or just keep talking?",
    "That makes sense. Life can feel heavy sometimes. 🌧️\n\nOne small thing — drink a glass of water and take 3 slow breaths. Then tell me how you're feeling.",
    "I hear you. 💙 You reached out today and that matters more than you know.\n\nIs there someone in your life you trust that you could call right now?",
    "You don't have to have everything figured out. 🌿\n\nJust being here and checking in with yourself is enough for now. What would feel helpful to you right now?",
  ],
};

const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const getResponse = (text) => {
  const t = text.toLowerCase().trim();

  // Language questions
  if (t.includes('hindi') || t.includes('urdu') || t.includes('hinglish') || t.includes('bata skte') || t.includes('bol skte'))
    return getRandom(RESPONSES.hindi);

  // Flexible greetings
  if (t.match(/^(hi|hey|hello|hii+|namaste|kaise ho)(\s|$)/i) || t.includes('hello') || t.includes('hii'))
    return "Hi there! I'm here for you. 😊 How are you feeling today? (Main yahan aapke liye hoon, aaj aap kaisa feel kar rahe hain?)";

  // Distress matches
  if (t.includes("i'm okay") || t.includes('im okay') || t === 'okay' || t === 'fine' || t.includes('doing good') || t.includes('doing well') || t === "i'm okay")
    return getRandom(RESPONSES.okay);
  
  if (t.includes('not feeling') || t.includes('not great') || t.includes('not good') || t.includes('feeling bad') || t.includes('sad') || t.includes('tired') || t.includes('low') || t.includes('down') || t.includes('depress') || t.includes('lonely') || t.includes('hopeless') || t.includes('overwhelm') || t.includes('stress') || t.includes('cry') || t.includes('anxious') || t.includes('empty'))
    return getRandom(RESPONSES.notgreat);
    
  if (t.includes('need help') || t.includes('crisis') || t.includes('hurt') || t.includes('suicide') || t.includes('suicidal') || t.includes('end my life') || t.includes('kill'))
    return getRandom(RESPONSES.help);

  // New Hinglish Distress handler
  if (t.includes('kuch acha') || t.includes('udas') || t.includes('akelapan') || t.includes('akela') || t.includes('rona') || t.includes('mann nahi') || t.includes('zindagi bekar') || t.includes('thak') || t.includes('bura lag raha') || t.includes('haar gaya') || t.includes('tension') || t.includes('pareshan') || t.includes('dard') || t.includes('dimag kharab') || t.includes('koi nahi'))
    return getRandom(RESPONSES.hinglish_distress);

  // Coping matching
  if (t.includes('breath') || t.includes('yes') || t.includes('sure') || t.includes('okay let') || t.includes('try it'))
    return RESPONSES.breathing[0];
  if (t.includes('walk') || t.includes('outside') || t.includes('go out'))
    return RESPONSES.walk[0];
  if (t.includes('water') || t.includes('drink'))
    return RESPONSES.water[0];
  if (t.includes('friend') || t.includes('call someone') || t.includes('talk to'))
    return RESPONSES.friend[0];
  if (t.includes('better') || t.includes('helped') || t.includes('thank') || t.includes('thanks') || t.includes('shukriya'))
    return getRandom(RESPONSES.better);

  return getRandom(RESPONSES.default);
};

// ─── CONSTANTS ────────────────────────────────────────────────
const QUICK_REPLIES = [
  { id: 'okay',     label: "I'm okay",          emoji: '😊' },
  { id: 'notgreat', label: "Not feeling great",  emoji: '😔' },
  { id: 'help',     label: "I need help",        emoji: '🆘' },
];

const HELPLINE = { name: 'iCall', number: '9152987821' };

// ─── COMPONENT ───────────────────────────────────────────────
export default function ChatScreen({ navigation, route }) {
  const riskLevel = route?.params?.riskLevel || 'HIGH';

  const uid = auth().currentUser?.uid;

  const [messages, setMessages]           = useState([]);
  const [input, setInput]                 = useState('');
  const [loading, setLoading]             = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const [showHelpline, setShowHelpline]   = useState(false);
  const [botSuspended, setBotSuspended]   = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!uid) return;

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

    const unsubMessages = sessionRef.collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot(snap => {
        if (!snap) return;
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setMessages(msgs);
        
        if (msgs.length === 0) {
          const greeting = riskLevel === 'HIGH'
            ? "Hey, I noticed your patterns today looked a little different from usual 🌿\n\nI'm CalmBot — I'm here to check in, not to judge. You don't have to share anything you're not comfortable with.\n\nHow are you feeling right now?"
            : "Hey! 👋 I'm CalmBot, your wellness companion.\n\nI'm here whenever you want to talk. How are you doing today?";
          saveMessage('assistant', greeting, 'bot');
        } else {
           if (msgs[msgs.length - 1].role === 'assistant') {
             setLoading(false);
           }
        }
      });

    return () => {
      unsubSession();
      unsubMessages();
    };
  }, [uid, riskLevel]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
  }, [messages, loading]);

  const saveMessage = async (role, content, authorId = 'user') => {
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
  };

  const escalateSession = async () => {
    if (!uid) return;
    await firestore().collection('chat_sessions').doc(uid).set({
      status: 'guardian_notified',
      botSuspended: false, // Ensure bot continues to interact with user
      escalatedAt: firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    sendHelpRequestAlert()
      .then(info => {
        if (info?.alertId) {
          startLiveLocationSharing(info.alertId, info.expiresAtMs);
        }
      })
      .catch(e => console.log('Guardian alert failed', e));
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    setShowQuickReplies(false);
    setInput('');
    setLoading(true);

    await saveMessage('user', text.trim(), uid);

    const t = text.toLowerCase();
    
    // Detect crisis language (English & Hinglish)
    const crisisPhrases = [
      'need help', 'crisis', 'hurt', 'suicide', 'suicidal', 'end my life', 'kill', 'die',
      'marne ka mann', 'khatam karna', 'jeene ki iccha nahi', 'jeene ka mann nahi'
    ];
    const isCrisis = crisisPhrases.some(phrase => t.includes(phrase));

    // Detect suspicious/depressive behaviors (English & Hinglish)
    const suspiciousPhrases = [
      // English
      'depression', 'sad', 'lonely', 'hopeless', 'anxious', 'scared', 'worthless',
      'so tired', 'exhausted', "can't get out of bed", 'no energy', 'empty', 'numb', 
      'pointless', "what's the point", 'my fault', 'burden', 'useless', 'failure',
      'hate myself', 'better off alone', 'nobody understands', 'overwhelmed',
      'crying', 'feel terrible', 'feel awful', 'give up', 'done with everything',
      'no one cares', 'stressed', 'panic',
      // Hinglish
      'kuch acha nhi lg rha', 'kuch acha nahi lag raha', 'udas', 'udaas', 
      'akela', 'akelapan', 'rona aa raha', 'mann nahi', 'man nahi',
      'bura lag raha', 'zindagi bekar', 'thak gaya', 'thak gayi', 'haar gaya',
      'sab bekar', 'koi faida nahi', 'andar se khokhla', 'pareshan', 'tension',
      'dard', 'ghabarahat', 'koi fikar nahi', 'mera koi nahi',
      'rona aa rha', 'bahut rona', 'mann udas hai', 'akele rehna hai',
      'kya farq padta hai', 'koi pyar nahi karta', 'sab chod diya',
      'kuch samajh nahi aa raha', 'dimag kharab'
    ];
    const isSuspicious = suspiciousPhrases.some(phrase => t.includes(phrase));

    const needsEscalation = isSuspicious || isCrisis;

    if (isCrisis) {
      setShowHelpline(true);
    }

    if (needsEscalation) {
      await escalateSession();
    }

    setTimeout(async () => {
      if (botSuspended) {
        setLoading(false);
      } else {
        const reply = getResponse(text);
        await saveMessage('assistant', reply, 'bot');
      }
    }, 1000 + Math.random() * 500);
  };

  const notifyGuardian = async () => {
    try {
      if (!auth().currentUser?.uid) {
        Alert.alert('Error', 'Not logged in.');
        return;
      }
      const info = await sendHelpRequestAlert();
      if (info?.alertId) {
        startLiveLocationSharing(info.alertId, info.expiresAtMs);
      }
      Alert.alert(
        '✅ Guardian Notified',
        'Your guardian has been notified that you reached out for support.'
      );
    } catch (e) {
      Alert.alert('Error', 'Could not notify guardian. Please try again.');
    }
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

        {/* Helpline card */}
        {showHelpline && (
          <View style={styles.helplineCard}>
            <Text style={styles.helplineTitle}>🆘 Immediate support available</Text>
            <Text style={styles.helplineDesc}>
              Trained counsellors are available right now. You don't have to explain everything — just call.
            </Text>
            <View style={styles.helplineRow}>
              <Text style={styles.helplineName}>{HELPLINE.name}</Text>
              <Text style={styles.helplineNumber}>{HELPLINE.number}</Text>
            </View>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => Linking.openURL(`tel:${HELPLINE.number}`)}>
              <Text style={styles.callBtnText}>📞 Call Now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.guardianBtn}
              onPress={notifyGuardian}>
              <Text style={styles.guardianBtnText}>🛡️ Notify my guardian</Text>
            </TouchableOpacity>
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
  helplineCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  helplineTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ef4444',
    marginBottom: 6,
  },
  helplineDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
    marginBottom: 12,
  },
  helplineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  helplineName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  helplineNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6366f1',
  },
  callBtn: {
    backgroundColor: '#ef4444',
    padding: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  callBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  guardianBtn: {
    backgroundColor: '#eef2ff',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#6366f1',
  },
  guardianBtnText: {
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