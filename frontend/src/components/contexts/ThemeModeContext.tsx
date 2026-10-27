import React, { useMemo } from 'react';
import type { FC, PropsWithChildren } from 'react';
import type { ThemeDropDownValue } from 'components/NavBar/NavBar';
import {
  amoledTheme,
  darkTheme,
  emberTheme,
  glassTheme,
  harborTheme,
  midnightTheme,
  theme,
  ThemeType,
} from 'theme/theme';

interface ThemeModeContextProps {
  isDarkMode: boolean;
  activeTheme: ThemeType;
  themeMode: ThemeDropDownValue;
  setThemeMode: (value: string | number) => void;
}

export const ThemeModeContext = React.createContext<ThemeModeContextProps>({
  isDarkMode: false,
  activeTheme: theme,
  themeMode: 'auto_theme',
  setThemeMode: () => {},
});

const THEME_MODES: readonly ThemeDropDownValue[] = [
  'auto_theme',
  'light_theme',
  'dark_theme',
  'midnight_theme',
  'harbor_theme',
  'ember_theme',
  'amoled_theme',
  'glass_theme',
];

const isThemeMode = (value: unknown): value is ThemeDropDownValue =>
  THEME_MODES.includes(value as ThemeDropDownValue);

const getStoredThemeMode = (): ThemeDropDownValue => {
  try {
    const mode = localStorage.getItem('mode');
    return isThemeMode(mode) ? mode : 'auto_theme';
  } catch {
    return 'auto_theme';
  }
};

const getDarkSchemeQuery = (): MediaQueryList | undefined =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;

const usePrefersDarkScheme = () => {
  const [prefersDark, setPrefersDark] = React.useState(
    () => !!getDarkSchemeQuery()?.matches
  );

  React.useEffect(() => {
    const query = getDarkSchemeQuery();
    if (!query) return undefined;

    const handleChange = (event: { matches: boolean }) =>
      setPrefersDark(event.matches);
    setPrefersDark(!!query.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener?.('change', handleChange);
    }
    // Safari < 14 only supports the legacy listener API.
    query.addListener?.(handleChange);
    return () => query.removeListener?.(handleChange);
  }, []);

  return prefersDark;
};

export const ThemeModeProvider: FC<PropsWithChildren<unknown>> = ({
  children,
}) => {
  const [themeMode, setThemeModeState] =
    React.useState<ThemeDropDownValue>(getStoredThemeMode);
  const prefersDark = usePrefersDarkScheme();

  const isDarkMode = React.useMemo(() => {
    if (themeMode === 'auto_theme') {
      return prefersDark;
    }
    return (
      themeMode === 'dark_theme' ||
      themeMode === 'midnight_theme' ||
      themeMode === 'amoled_theme'
    );
  }, [prefersDark, themeMode]);

  const activeTheme = React.useMemo(() => {
    switch (themeMode) {
      case 'dark_theme':
        return darkTheme;
      case 'midnight_theme':
        return midnightTheme;
      case 'harbor_theme':
        return harborTheme;
      case 'ember_theme':
        return emberTheme;
      case 'amoled_theme':
        return amoledTheme;
      case 'glass_theme':
        return glassTheme;
      case 'light_theme':
        return theme;
      case 'auto_theme':
      default:
        return isDarkMode ? darkTheme : theme;
    }
  }, [isDarkMode, themeMode]);

  const setThemeMode = React.useCallback(
    (value: string | number) => {
      setThemeModeState(value as ThemeDropDownValue);
      localStorage.setItem('mode', value as string);
    },
    [setThemeModeState]
  );

  const contextValue = useMemo(
    () => ({
      isDarkMode,
      activeTheme,
      themeMode,
      setThemeMode,
    }),
    [activeTheme, isDarkMode, themeMode, setThemeMode]
  );

  return (
    <ThemeModeContext.Provider value={contextValue}>
      {children}
    </ThemeModeContext.Provider>
  );
};
