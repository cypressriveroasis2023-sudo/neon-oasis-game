import interUrl from './fonts/inter-latin-wght-normal.woff2?url';
import interTightUrl from './fonts/inter-tight-latin-wght-normal.woff2?url';

const RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const face = (family: string, url: string) =>
  `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:100 900;src:url(${JSON.stringify(url)}) format('woff2');unicode-range:${RANGE}}`;

/**
 * The board's two typefaces, served from COS itself. A font face only takes
 * effect when the page declares it, not a shadow root, so it is added to the
 * page once. The family names are the board's own: nothing else in COS uses
 * them, so nothing else changes typeface.
 */
export function loadBoardFonts(): void {
  if (document.getElementById('cos-board-fonts')) return;
  const style = document.createElement('style');
  style.id = 'cos-board-fonts';
  style.textContent = face('COS Board Inter', interUrl) + face('COS Board Inter Tight', interTightUrl);
  document.head.append(style);
}
