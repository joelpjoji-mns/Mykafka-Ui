import {
  amoledTheme,
  darkTheme,
  emberTheme,
  glassTheme,
  harborTheme,
  midnightTheme,
  theme,
} from 'theme/theme';

describe('theme materials', () => {
  it('keeps Glass navigation adaptive while preserving regular content surfaces', () => {
    expect(glassTheme.effects.navigationBackdropFilter).toContain('blur');
    expect(glassTheme.effects.transientBackdropFilter).toContain('blur');
    expect(glassTheme.effects.reducedTransparencyNavigationSurface).toBe(
      '#F6FBF8'
    );
    expect(glassTheme.table).toEqual(theme.table);
    expect(glassTheme.default.backgroundColor).toBe('#F9FCFB');
  });

  it('keeps AMOLED surfaces opaque', () => {
    expect(amoledTheme.effects.navigationBackdropFilter).toBe('none');
    expect(amoledTheme.effects.navigationSurface).toBe('#000000');
    expect(amoledTheme.logo.color).toBe('#FFFFFF');
  });

  it('keeps the MyKafka mark visible in every named theme', () => {
    expect(theme.logo.color).toBe('#171A1C');
    expect(darkTheme.logo.color).toBe('#FDFDFD');
    expect(midnightTheme.logo.color).toBe('#F4C95D');
    expect(harborTheme.logo.color).toBe('#0F4C5C');
    expect(emberTheme.logo.color).toBe('#9C2F1A');
    expect(glassTheme.logo.color).toBe('#0D5C4F');
  });
});
