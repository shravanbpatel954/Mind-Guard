import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkTokens, lightTokens, ThemeMode } from './tokens';

const STORAGE_KEY = 'mindguard_theme_mode_v1';

export const ThemeContext = createContext({
  mode: ThemeMode.system,
  isDark: false,
  tokens: lightTokens,
  setMode: async () => {},
});

function computeIsDark(mode) {
  if (mode === ThemeMode.dark) return true;
  if (mode === ThemeMode.light) return false;
  const sys = Appearance.getColorScheme();
  return sys === 'dark';
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(ThemeMode.system);
  const [sysScheme, setSysScheme] = useState(Appearance.getColorScheme());

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSysScheme(colorScheme));
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === ThemeMode.light || saved === ThemeMode.dark || saved === ThemeMode.system) {
          setModeState(saved);
        }
      } catch (e) {}
    })();
  }, []);

  const setMode = useCallback(async (next) => {
    const v = next === ThemeMode.light || next === ThemeMode.dark ? next : ThemeMode.system;
    setModeState(v);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, v);
    } catch (e) {}
  }, []);

  const isDark = useMemo(() => {
    return computeIsDark(mode === ThemeMode.system ? (sysScheme === 'dark' ? ThemeMode.dark : ThemeMode.light) : mode);
  }, [mode, sysScheme]);

  const tokens = isDark ? darkTokens : lightTokens;

  const value = useMemo(() => ({ mode, isDark, tokens, setMode }), [mode, isDark, tokens, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

