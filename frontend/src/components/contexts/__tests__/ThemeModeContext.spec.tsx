import React, { useContext } from 'react';
import { act, render, screen } from '@testing-library/react';
import {
  ThemeModeContext,
  ThemeModeProvider,
} from 'components/contexts/ThemeModeContext';

type ChangeListener = (event: { matches: boolean }) => void;

const ThemeConsumer = () => {
  const { isDarkMode, themeMode } = useContext(ThemeModeContext);
  return (
    <span data-testid="theme">
      {themeMode}:{isDarkMode ? 'dark' : 'light'}
    </span>
  );
};

const renderProvider = () =>
  render(
    <ThemeModeProvider>
      <ThemeConsumer />
    </ThemeModeProvider>
  );

describe('ThemeModeProvider', () => {
  const originalMatchMedia = window.matchMedia;
  let listeners: ChangeListener[];

  const mockMatchMedia = (
    matches: boolean,
    api: 'modern' | 'legacy' = 'modern'
  ) => {
    listeners = [];
    const addListener = (listener: ChangeListener) => listeners.push(listener);
    const removeListener = (listener: ChangeListener) => {
      listeners = listeners.filter((item) => item !== listener);
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn(() =>
        api === 'modern'
          ? {
              matches,
              addEventListener: (_: string, listener: ChangeListener) =>
                addListener(listener),
              removeEventListener: (_: string, listener: ChangeListener) =>
                removeListener(listener),
            }
          : { matches, addListener, removeListener }
      ),
    });
  };

  const emitSchemeChange = (matches: boolean) =>
    act(() => listeners.forEach((listener) => listener({ matches })));

  beforeEach(() => localStorage.clear());

  afterAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('follows OS color scheme changes in auto mode', () => {
    mockMatchMedia(false);
    const { unmount } = renderProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent('auto_theme:light');

    emitSchemeChange(true);
    expect(screen.getByTestId('theme')).toHaveTextContent('auto_theme:dark');

    unmount();
    expect(listeners).toHaveLength(0);
  });

  it('supports the legacy media query listener API', () => {
    mockMatchMedia(true, 'legacy');
    renderProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent('auto_theme:dark');

    emitSchemeChange(false);
    expect(screen.getByTestId('theme')).toHaveTextContent('auto_theme:light');
  });

  it('restores a stored theme on the first render and ignores OS changes', () => {
    mockMatchMedia(false);
    localStorage.setItem('mode', 'midnight_theme');
    renderProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent(
      'midnight_theme:dark'
    );

    emitSchemeChange(false);
    expect(screen.getByTestId('theme')).toHaveTextContent(
      'midnight_theme:dark'
    );
  });

  it('falls back to auto mode for unknown stored values', () => {
    mockMatchMedia(false);
    localStorage.setItem('mode', 'unknown');
    renderProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent('auto_theme:light');
  });

  it('works without matchMedia support', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    renderProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent('auto_theme:light');
  });
});
