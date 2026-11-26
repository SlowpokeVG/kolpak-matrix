import { assignVars, globalStyle } from '@vanilla-extract/css';
import { config } from 'folds';

// Simple mode over the Kolpak theme: folds' own rounded corners back (the Kolpak theme zeroes
// them) and a larger type scale for reading on a phone, 16px body. The class sits on <html>,
// the theme's on <body>; the two-class selector outranks the theme's variable classes.
const SELECTOR = 'html.kolpak-simple body.kolpak-theme';

globalStyle(SELECTOR, {
  vars: {
    ...assignVars(config.radii, {
      R0: '0',
      R300: '0.25rem',
      R400: '0.5rem',
      R500: '0.75rem',
      Round: '50%',
      Pill: '9999px',
    }),
    ...assignVars(config.fontSize, {
      D400: '2.8125rem',
      H1: '2.1875rem',
      H2: '1.5625rem',
      H3: '1.25rem',
      H4: '1.125rem',
      H5: '1.0625rem',
      H6: '1rem',
      T500: '1.0625rem',
      T400: '1rem',
      T300: '0.875rem',
      T200: '0.75rem',
      B500: '1.0625rem',
      B400: '0.9375rem',
      B300: '0.875rem',
      L400: '0.875rem',
      O400: '0.75rem',
      C400: '0.6875rem',
    }),
  },
});
