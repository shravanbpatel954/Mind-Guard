import React, { useState } from 'react';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';

GoogleSignin.configure({
  webClientId: '577940346171-i3k4jlr8cvsqlih2d4k57f1pvlosmh56.apps.googleusercontent.com',
});

const OnboardingScreen = ({ navigation }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [loading, setLoading] = useState(false);

  const saveUserToFirestore = async (uid, userData) => {
    await firestore()
      .collection('users')
      .doc(uid)
      .set(userData, { merge: true });
  };

  const getUserFromFirestore = async (uid) => {
    const doc = await firestore().collection('users').doc(uid).get();
    return doc.exists ? doc.data() : null;
  };

  const getErrorMessage = (code) => {
    switch (code) {
      case 'auth/invalid-email': return 'Please enter a valid email address.';
      case 'auth/user-disabled': return 'This account has been disabled.';
      case 'auth/user-not-found': return 'No account found. Please sign up first.';
      case 'auth/wrong-password': return 'Incorrect password. Please try again.';
      case 'auth/weak-password': return 'Password must be at least 6 characters.';
      case 'auth/network-request-failed': return 'No internet. Please check your connection.';
      case 'auth/invalid-credential': return 'Incorrect email or password. Please try again.';
      case 'auth/email-already-in-use': return 'This email is already registered. Please login.';
      default: return 'Something went wrong. Please try again.';
    }
  };

  const handleEmailLogin = async () => {
    const credential = await auth().signInWithEmailAndPassword(
      email.trim(),
      password
    );
    const userData = await getUserFromFirestore(credential.user.uid);
    if (!userData) {
      await auth().signOut();
      Alert.alert('Not Found', 'No account found. Please sign up first.');
      return;
    }
    // Navigation is handled automatically by AppNavigator
  };

  const handleEmailSignup = async () => {
    const userCredential = await auth().createUserWithEmailAndPassword(
      email.trim(),
      password
    );
    await saveUserToFirestore(userCredential.user.uid, {
      name: name.trim(),
      email: userCredential.user.email,
      role: role,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    // Navigation is handled automatically by AppNavigator
  };

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Info', 'Please enter email and password.');
      return;
    }
    
    // Admin backdoor
    if ((email.trim() === 'MindguardAdmin' && password === 'admin123') || (email.trim() === 'Admin' && password === 'Admin')) {
      navigation.replace('AdminDashboard');
      return;
    }

    if (!isLogin && !name.trim()) {
      Alert.alert('Missing Info', 'Please enter your full name.');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        await handleEmailLogin();
      } else {
        await handleEmailSignup();
      }
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        Alert.alert(
          'Already Registered',
          'This email is already registered. Please login.',
          [{ text: 'OK', onPress: () => setIsLogin(true) }]
        );
      } else {
        Alert.alert('Error', getErrorMessage(error.code));
      }
    } finally {
      setLoading(false);
    }
  };

 
  const handleGoogleAuth = async () => {
    if (!isLogin && !role) {
      Alert.alert('Select Role', 'Please select your role first.');
      return;
    }
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo?.data?.idToken;
      if (!idToken) {
        throw new Error('Google sign-in did not return an ID token. Try updating Google Play services.');
      }
      const googleCredential = auth.GoogleAuthProvider.credential(idToken);
      await auth().signInWithCredential(googleCredential);
  
      const currentUser = auth().currentUser;
      const uid = currentUser.uid;
      const gEmail = currentUser.email || '';
      const displayName = currentUser.displayName || '';
  
      const existingUser = await getUserFromFirestore(uid);
  
      if (isLogin) {
        // LOGIN TAB → account must already exist
        if (!existingUser || !existingUser.role) {
          await auth().signOut();
          Alert.alert('Not Found', 'No account found with this Google account. Please sign up first.');
          return;
        }
        // Navigation is handled automatically by AppNavigator
      } else {
        // SIGNUP TAB → account must NOT exist
        if (existingUser && existingUser.role) {
          await auth().signOut();
          Alert.alert('Already Registered', 'This Google account is already registered. Please login.',
            [{ text: 'OK', onPress: () => setIsLogin(true) }]
          );
          return;
        }
        await saveUserToFirestore(uid, {
          name: displayName || name.trim() || gEmail.split('@')[0] || 'User',
          email: gEmail,
          role: role,
          createdAt: firestore.FieldValue.serverTimestamp(),
        });
        // Navigation is handled automatically by AppNavigator
      }
    } catch (error) {
      if (error.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign In Failed', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const roleOptions = [
    { id: 'user', label: 'User', icon: '🧠', desc: 'Monitor my own wellness' },
    { id: 'guardian', label: 'Guardian', icon: '🛡️', desc: 'Monitor a loved one' },
    { id: 'professional', label: 'Professional', icon: '👨‍⚕️', desc: 'Provide professional support' },
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>

      <View style={styles.header}>
        <Text style={styles.logo}>🧠</Text>
        <Text style={styles.title}>MindGuard</Text>
        <Text style={styles.subtitle}>Your silent mental wellness companion</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, isLogin && styles.tabActive]}
            onPress={() => setIsLogin(true)}>
            <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>
              Login
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, !isLogin && styles.tabActive]}
            onPress={() => setIsLogin(false)}>
            <Text style={[styles.tabText, !isLogin && styles.tabTextActive]}>
              Sign Up
            </Text>
          </TouchableOpacity>
        </View>

        {!isLogin && (
          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor="#94a3b8"
              value={name}
              onChangeText={setName}
            />
          </View>
        )}

        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#94a3b8"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        {!isLogin && (
          <View style={styles.roleSection}>
            <Text style={styles.roleLabel}>I am a:</Text>
            {roleOptions.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={[
                  styles.roleButton,
                  role === r.id && styles.roleButtonActive,
                ]}
                onPress={() => setRole(r.id)}>
                <Text style={styles.roleIcon}>{r.icon}</Text>
                <View style={styles.roleInfo}>
                  <Text style={[styles.roleText, role === r.id && styles.roleTextActive]}>
                    {r.label}
                  </Text>
                  <Text style={[styles.roleDesc, role === r.id && styles.roleDescActive]}>
                    {r.desc}
                  </Text>
                </View>
                <View style={[styles.radioOuter, role === r.id && styles.radioOuterActive]}>
                  {role === r.id && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            ))}
            {role === 'professional' && (
              <Text style={styles.disclaimer}>
                ⚠️ Professional accounts require manual verification.
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>
                {isLogin ? 'Login' : 'Create Account'}
              </Text>
          }
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.googleButton, loading && styles.buttonDisabled]}
          onPress={handleGoogleAuth}
          disabled={loading}>
          <Text style={styles.googleIcon}>G</Text>
          <Text style={styles.googleButtonText}>
            {isLogin ? 'Sign in with Google' : 'Sign up with Google'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchContainer}
          onPress={() => setIsLogin(!isLogin)}>
          <Text style={styles.switchText}>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <Text style={styles.switchTextBold}>
              {isLogin ? 'Sign Up' : 'Login'}
            </Text>
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
  },
  header: { alignItems: 'center', marginBottom: 28 },
  logo: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#1e293b', letterSpacing: 0.5 },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12,
  },
  tabActive: {
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tabText: { color: '#94a3b8', fontWeight: '500', fontSize: 15 },
  tabTextActive: { color: '#1e293b', fontWeight: 'bold' },
  inputWrapper: { marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#1e293b',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  roleSection: { marginBottom: 20 },
  roleLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 10 },
  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    marginBottom: 8,
    backgroundColor: '#f8fafc',
  },
  roleButtonActive: { borderColor: '#6366f1', backgroundColor: '#eef2ff' },
  roleIcon: { fontSize: 22, marginRight: 12 },
  roleInfo: { flex: 1 },
  roleText: { color: '#334155', fontWeight: '600', fontSize: 15 },
  roleTextActive: { color: '#4f46e5' },
  roleDesc: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  roleDescActive: { color: '#818cf8' },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterActive: { borderColor: '#6366f1' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#6366f1' },
  button: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.3 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dividerText: { color: '#94a3b8', paddingHorizontal: 12, fontSize: 13 },
  googleButton: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  googleIcon: { fontSize: 18, fontWeight: 'bold', color: '#4285F4', marginRight: 10 },
  googleButtonText: { color: '#334155', fontSize: 15, fontWeight: '600' },
  switchContainer: { alignItems: 'center', marginTop: 20 },
  switchText: { color: '#64748b', fontSize: 14 },
  switchTextBold: { color: '#6366f1', fontWeight: 'bold' },
  disclaimer: { fontSize: 12, color: '#ef4444', marginTop: 4, marginBottom: 4, lineHeight: 18 },
});

export default OnboardingScreen;