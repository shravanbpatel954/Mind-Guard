import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';

export function useTheme() {
  const ctx = useContext(ThemeContext);
  const colors = ctx.tokens.colors;
  return { ...ctx, colors };
}

