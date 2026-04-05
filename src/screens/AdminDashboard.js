import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, SafeAreaView, Linking } from 'react-native';
import firestore from '@react-native-firebase/firestore';

export default function AdminDashboard({ navigation }) {
  const [pendingProfs, setPendingProfs] = useState([]);

  useEffect(() => {
    const unsub = firestore().collection('professionals')
      .where('verified', '==', false)
      .onSnapshot(snap => {
        setPendingProfs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    return () => unsub();
  }, []);

  const handleVerify = async (id, name) => {
    try {
      await firestore().collection('professionals').doc(id).update({ verified: true });
      Alert.alert('Success', `Professional ${name} has been verified.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to verify professional. ' + error.message);
    }
  };

  const logoutAdmin = () => {
    navigation.replace('Onboarding');
  };

  return (
    <SafeAreaView style={styles.container}>
       <View style={styles.header}>
         <Text style={styles.headerTitle}>MindGuard Admin Panel</Text>
         <TouchableOpacity onPress={logoutAdmin}><Text style={styles.logoutBtn}>Logout</Text></TouchableOpacity>
       </View>
       <ScrollView style={styles.content}>
         <Text style={styles.title}>Pending Professional Verifications</Text>
         {pendingProfs.length === 0 ? (
           <Text style={styles.empty}>No pending professionals.</Text>
         ) : (
           pendingProfs.map(prof => (
             <View key={prof.id} style={styles.card}>
               <Text style={styles.name}>{prof.name}</Text>
               <Text>Specialty: {prof.specialty}</Text>
               <Text>Qualification: {prof.qualification}</Text>
               <Text>Experience: {prof.experience || 0} years</Text>
               {prof.qualificationDocUrl && (
                 <TouchableOpacity style={styles.pdfBtn} onPress={() => Linking.openURL(prof.qualificationDocUrl).catch(() => Alert.alert('Error', 'Unable to open PDF'))}>
                   <Text style={styles.pdfText}>📄 View Uploaded PDF</Text>
                 </TouchableOpacity>
               )}
               <TouchableOpacity style={styles.verifyBtn} onPress={() => handleVerify(prof.id, prof.name)}>
                 <Text style={styles.verifyText}>✅ Verify Professional</Text>
               </TouchableOpacity>
             </View>
           ))
         )}
       </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, backgroundColor: '#fff', elevation: 2 },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  logoutBtn: { color: '#ef4444', fontWeight: 'bold' },
  content: { padding: 20 },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 15, color: '#1e293b' },
  empty: { color: '#64748b' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  name: { fontSize: 16, fontWeight: 'bold', marginBottom: 5, color: '#1e293b' },
  verifyBtn: { marginTop: 15, backgroundColor: '#22c55e', padding: 10, borderRadius: 8, alignItems: 'center' },
  verifyText: { color: '#fff', fontWeight: 'bold' },
  pdfBtn: { marginTop: 10, backgroundColor: '#e2e8f0', padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1' },
  pdfText: { color: '#1e293b', fontWeight: 'bold' }
});
