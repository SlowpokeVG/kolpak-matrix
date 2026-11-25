// Kolpak theme entry point: bundled fonts and the theme stylesheet.
// Imported once from src/index.tsx, after Sable's own themes.css so it wins the cascade.
import '@fontsource/anton/400.css';
import '@fontsource-variable/oswald';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import '@fontsource/rubik-spray-paint/400.css';
import '@fontsource/permanent-marker/400.css';
import './kolpak-theme.css';

export { kolpakFontSize, kolpakRadii } from './kolpakTheme.css';

export const KOLPAK_THEME_ID = 'kolpak-theme';
