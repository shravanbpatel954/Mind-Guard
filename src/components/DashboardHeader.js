import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

/**
 * Top bar with title and settings (gear) — matches common Android app patterns.
 */
export default function DashboardHeader({ title, subtitle, onOpenSettings }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onOpenSettings ? (
        <TouchableOpacity
          onPress={onOpenSettings}
          style={styles.settingsBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Open settings">
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  textCol: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, fontWeight: '800', color: '#1e293b' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 18 },
  settingsBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  settingsIcon: { fontSize: 22 },
});
