// The sandboxed srcDoc for a plugin-declared inspector panel — a pure string build
// split out of PluginPanelTab so the containment contract (CSP + sandbox shape) is
// unit-testable without a DOM. The component reads the live host theme CSS
// (collectThemeCss) and passes it in; everything here is deterministic.

import { EMBEDDED_VISUAL_PREFERENCES_CSS } from '@localixai/kit/embedded-visual-preferences'
import { pluginUiApiBootstrap } from './pluginUiApiBootstrap'

/**
 * The library CDNs a panel may load scripts and styles from (Chart.js, D3, three.js, mermaid).
 * Nothing else is reachable: `connect-src 'none'` below blocks fetch/XHR/WebSocket outright.
 * A `srcdoc` frame INHERITS the desktop shell's policy and the two intersect, so
 * `apps/desktop-tauri/src-tauri/tauri.conf.json` must stay a superset of this list — dropping a
 * host there silently removes it here.
 */
export const PANEL_CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.jsdelivr.net',
  'unpkg.com',
] as const

const PANEL_CDN_SOURCES = PANEL_CDN_HOSTS.map((h) => `https://${h}`).join(' ')

/** Enforced CSP for panel documents: opaque origin, no network, no host reach. */
export const PANEL_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${PANEL_CDN_SOURCES} blob:`,
  `style-src 'unsafe-inline' ${PANEL_CDN_SOURCES}`,
  'img-src data: blob: https:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  'worker-src blob:',
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join(';')

/** A fresh bridge nonce for one panel document (see `createPanelBridgeHost`'s `getNonce`). */
export function mintPanelNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Build the full sandboxed panel document. `theme` is 'light' | 'dark'; `themeCss`
 * is the host's forwarded CSS custom properties (collected from the live DOM by the
 * caller). The plugin `html` is injected verbatim — containment is the iframe
 * sandbox + the CSP above, NOT escaping. `nonce` binds the bridge to this document.
 */
export function buildPanelSrcDoc(
  html: string,
  theme: string,
  themeCss: string,
  nonce: string,
): string {
  return `<!doctype html>
<html data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PANEL_CSP}">
<style>
:root {
  ${themeCss}
  color-scheme: ${theme};
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--background);color:var(--foreground);font-family:var(--font-sans, system-ui, sans-serif);font-size:0.875rem;line-height:1.5;-webkit-font-smoothing:antialiased}
code,pre,kbd,samp{font-family:var(--font-mono, ui-monospace, monospace)}
a{color:var(--primary)}
button{font-family:inherit;font-size:inherit;cursor:pointer}
::selection{background:color-mix(in oklch, var(--foreground, currentColor) 24%, transparent)}
*{scrollbar-width:thin;scrollbar-color:var(--scroll-thumb, rgba(128,128,128,.28)) transparent}
*::-webkit-scrollbar{width:10px;height:10px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:var(--scroll-thumb, rgba(128,128,128,.18));border-radius:8px;border:2px solid transparent;background-clip:padding-box}
*::-webkit-scrollbar-thumb:hover{background:var(--scroll-thumb-hover, rgba(128,128,128,.35));background-clip:padding-box}
/* OS preferences must be declared inside the sandboxed document. */
${EMBEDDED_VISUAL_PREFERENCES_CSS}
</style>
<script>${pluginUiApiBootstrap(nonce)}</script>
</head>
<body>
${html}
</body>
</html>`
}
