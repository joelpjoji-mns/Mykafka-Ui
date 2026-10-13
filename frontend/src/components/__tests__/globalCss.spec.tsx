import React from 'react';
import { renderToString } from 'react-dom/server';
import { ServerStyleSheet, ThemeProvider } from 'styled-components';
import GlobalCss from 'components/globalCss';
import { amoledTheme, darkTheme, midnightTheme, theme } from 'theme/theme';

describe('Global theme text', () => {
  it.each([
    ['Light', theme],
    ['Dark', darkTheme],
    ['Midnight', midnightTheme],
    ['AMOLED', amoledTheme],
  ])('uses the %s theme color for unstyled text', (_name, activeTheme) => {
    const sheet = new ServerStyleSheet();
    try {
      renderToString(
        sheet.collectStyles(
          <ThemeProvider theme={activeTheme}>
            <GlobalCss />
          </ThemeProvider>
        )
      );
      expect(sheet.getStyleTags()).toContain(
        `color:${activeTheme.default.color.normal};`
      );
    } finally {
      sheet.seal();
    }
  });
});
