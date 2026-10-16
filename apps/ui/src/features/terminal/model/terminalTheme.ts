import type { ITheme } from '@xterm/xterm'
import type { ISearchOptions } from '@xterm/addon-search'

// Theme + palette helpers for the xterm terminal pane. Kept out of the pane
// component so the ~500-line lifecycle effect there reads as pure plumbing:
// these are the DOM-reading colour utilities that translate the app's live CSS
// tokens (and the active light/dark theme) into the concrete rgb values xterm
// captured at open. Re-read whenever `data-theme` flips on <html>.

// Resolve ANY CSS color string (incl. oklch tokens) to concrete [r,g,b,a] by
// letting the browser paint it — xterm can't parse oklch, and getComputedStyle
// may hand back the oklch() verbatim. A 1×1 canvas normalizes it reliably.
const probe = typeof document !== 'undefined' ? document.createElement('canvas') : null
const probeCtx = probe ? probe.getContext('2d', { willReadFrequently: true }) : null
function toRgba(color: string, alpha = 1): string {
  if (!probeCtx) return color
  probeCtx.clearRect(0, 0, 1, 1)
  probeCtx.fillStyle = '#000'
  probeCtx.fillStyle = color // invalid strings are ignored → stays #000
  probeCtx.fillRect(0, 0, 1, 1)
  const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Read a design token (`--background`, …) off <html>; '' when unset. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Theme-aware ANSI palettes (GitHub light/dark). xterm's built-in palette is
// tuned for dark backgrounds — its yellows/greens/whites wash out on a light
// terminal, which is why colored command output (ls, git, an HTML dump) was hard
// to read in the light theme. Each palette stays legible on its own background.
const DARK_ANSI = {
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
}
const LIGHT_ANSI = {
  black: '#24292e',
  red: '#d73a49',
  green: '#28a745',
  yellow: '#b08800',
  blue: '#0366d6',
  magenta: '#6f42c1',
  cyan: '#1b7c83',
  white: '#6a737d',
  brightBlack: '#959da5',
  brightRed: '#cb2431',
  brightGreen: '#22863a',
  brightYellow: '#b08800',
  brightBlue: '#005cc5',
  brightMagenta: '#5a32a3',
  brightCyan: '#1b7c83',
  brightWhite: '#24292e',
}
/** Derive an xterm theme from the app's CSS tokens so it tracks the active
 *  light/dark theme (re-read whenever `data-theme` flips on <html>). */
export function readTheme(): ITheme {
  const foreground = toRgba(token('--foreground') || '#e5e5e5')
  // The terminal paints NO ground of its own: its pane already painted `--background`, and under
  // the macOS glass theme that token carries alpha, so a second coat here compounded the two into
  // an opaque black slab (xterm additionally flattens any alpha unless `allowTransparency` is on —
  // see terminalInstance.ts). The cursor still needs a real color to knock text out against, which
  // is what `--background-solid` provides on every theme.
  const background = 'rgba(0, 0, 0, 0)'
  const solid = toRgba(token('--background-solid') || token('--background') || '#0a0a0a')
  // xterm's own palette is tuned for dark grounds: its yellows, greens and whites wash out on a
  // light one, which is what made coloured command output hard to read there.
  const isLight = document.documentElement.dataset.theme === 'light'
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: solid,
    selectionBackground: toRgba(token('--foreground') || '#888', 0.24),
    ...(isLight ? LIGHT_ANSI : DARK_ANSI),
  }
}

// Search-match highlight decorations. xterm requires a solid #RRGGBB, so we pick
// a mid-amber that stays legible under either theme's text color (light text on
// a dark bg / dark text on a light bg). The active match is brighter.
export function searchDecorations(): ISearchOptions['decorations'] {
  const isLight = document.documentElement.dataset.theme === 'light'
  return isLight
    ? {
        matchBackground: '#ffe08a',
        activeMatchBackground: '#ffb624',
        matchOverviewRuler: '#d29922',
        activeMatchColorOverviewRuler: '#e3771a',
      }
    : {
        matchBackground: '#5a4a00',
        activeMatchBackground: '#a37400',
        matchOverviewRuler: '#d29922',
        activeMatchColorOverviewRuler: '#e3b341',
      }
}
