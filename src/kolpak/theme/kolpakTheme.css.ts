import { createTheme } from '@vanilla-extract/css';
import { config } from 'folds';

// Hard edges everywhere (AI/DESIGN.md §2.5): every folds radius becomes 0.
// Hardcoded radii elsewhere are caught by kolpak-theme.css.
export const kolpakRadii = createTheme(config.radii, {
  R0: '0',
  R300: '0',
  R400: '0',
  R500: '0',
  Round: '0',
  Pill: '0',
});

// Type scale from the mockups (AI/DESIGN.md §2.4): 14px body, 13px secondary, 12px meta,
// 11px badges, with the Anton sizes for titles, section labels and buttons. folds defaults
// are 15/14/12 for text and 12 for labels.
export const kolpakFontSize = createTheme(config.fontSize, {
  D400: '2.8125rem',
  H1: '2.1875rem',
  H2: '1.5625rem',
  H3: '1.25rem', // 20: page and panel titles
  H4: '1.125rem', // 18
  H5: '1rem', // 16: room header
  H6: '0.9375rem', // 15
  T500: '0.9375rem',
  T400: '0.875rem', // 14: base
  T300: '0.8125rem', // 13: secondary
  T200: '0.75rem', // 12: timestamps, meta
  B500: '1.0625rem', // 17
  B400: '0.9375rem', // 15
  B300: '0.8125rem', // 13
  L400: '0.9375rem', // 15: section labels
  O400: '0.75rem',
  C400: '0.6875rem', // 11: badges
});
