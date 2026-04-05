import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import OnboardingScreen from '../screens/OnboardingScreen';
import ChatScreen from '../screens/ChatScreen';
import UserDashboard from '../screens/UserDashboard';
import GuardianDashboard from '../screens/GuardianDashboard';
import ProfessionalDashboard from '../screens/ProfessionalDashboard';
import SettingsScreen from '../screens/SettingsScreen';
import AdminDashboard from '../screens/AdminDashboard';

const Stack = createStackNavigator();

const MAX_PROFILE_WAIT_MS = 8000;
const RETRY_INTERVAL_MS = 250;

/**
 * MindGuard requires a Firestore `users/{uid}` row for a valid session (role + identity).
 * Retries briefly so sign-up (auth before Firestore write) still works.
 * If no profile appears, treat as invalid session and sign out (orphan Auth account).
 */
async function fetchUserProfileWithRetry(uid) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < MAX_PROFILE_WAIT_MS) {
    try {
      const doc = await firestore().collection('users').doc(uid).get();
      if (doc.exists) {
        const data = doc.data();
        const r = data?.role;
        const role = r === 'guardian' || r === 'professional' ? r : 'user';
        return { role, data };
      }
    } catch (e) {
      console.log('Profile fetch attempt error:', e);
    }
    attempt += 1;
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }
  return null;
}

function AuthStack() {
  return (
    <Stack.Navigator initialRouteName="Onboarding">
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AdminDashboard" component={AdminDashboard} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function getHomeScreenForRole(role) {
  if (role === 'guardian') return 'GuardianDashboard';
  if (role === 'professional') return 'ProfessionalDashboard';
  return 'UserDashboard';
}

function AppStack({ initialRouteName }) {
  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false }}>
      <Stack.Screen name="UserDashboard" component={UserDashboard} />
      <Stack.Screen name="GuardianDashboard" component={GuardianDashboard} />
      <Stack.Screen name="ProfessionalDashboard" component={ProfessionalDashboard} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}

const AppNavigator = () => {
  const [authState, setAuthState] = useState({ ready: false, user: null, role: 'user' });

  useEffect(() => {
    let mounted = true;

    const unsubscribe = auth().onAuthStateChanged(async (firebaseUser) => {
      if (!firebaseUser) {
        if (mounted) {
          setAuthState({ ready: true, user: null, role: 'user' });
        }
        return;
      }

      const profile = await fetchUserProfileWithRetry(firebaseUser.uid);

      if (!mounted) return;

      if (!profile) {
        try {
          await auth().signOut();
        } catch (e) {
          console.log('Sign out (no profile):', e);
        }
        setAuthState({ ready: true, user: null, role: 'user' });
        return;
      }

      setAuthState({
        ready: true,
        user: firebaseUser,
        role: profile.role,
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!authState.ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const homeScreen = getHomeScreenForRole(authState.role);

  return (
    <NavigationContainer key={authState.user ? authState.user.uid : 'auth'}>
      {authState.user ? (
        <AppStack key={authState.user.uid} initialRouteName={homeScreen} />
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
});

export default AppNavigator;
