import { EMBEDDED_VISUAL_PREFERENCES_CSS } from '@localixai/kit/embedded-visual-preferences'
import { CLIENT_FRAME_DRAW } from './clientFrameDraw'
import { CLIENT_FRAME_RUNTIME } from './clientFrameRuntime'

/**
 * The document a `Client`'s surface module runs in: a `sandbox="allow-scripts"` frame (an opaque
 * origin: no cookies, storage or DOM of the app) under a policy that loads nothing and connects
 * nowhere. The module's code is plugin code, so it travels as JSON data, never as markup; the
 * runtime inserts it as a script inside the frame. Like every untrusted plugin surface, it reaches
 * the host only by `postMessage`, which the host checks by source.
 */

/** No network, no frames, no forms: inline script and style only. */
export const CLIENT_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join(';')

/** JSON safe inside a `<script>`: no `</script>`, no line separators that end a JS string. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const STYLE = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent;color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);font-size:0.875rem;line-height:1.25rem;-webkit-font-smoothing:antialiased;overflow:hidden}
#root{display:flex;flex-direction:column;gap:4px}
#root.lx-fit-width{width:max-content}
.lx-cell{position:absolute;visibility:hidden;font-family:var(--font-mono,ui-monospace,monospace);white-space:pre}
.lx-box{display:flex}
.lx-border{border:1px solid var(--border);border-radius:var(--radius-md,6px)}
.lx-bold{font-weight:600}.lx-medium{font-weight:500}.lx-italic{font-style:italic}.lx-underline{text-decoration:underline}
.lx-dim{color:var(--text-soft,var(--muted-foreground))}
.lx-mono,.lx-code{font-family:var(--font-mono,ui-monospace,monospace)}
.lx-tabular{font-variant-numeric:tabular-nums}
.lx-truncate{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.lx-code{overflow-x:auto;border-radius:var(--radius-md,6px);background:var(--surface-sunken,var(--muted));padding:8px;font-size:0.75rem;white-space:pre}
.lx-markdown{white-space:pre-wrap}
.lx-link{color:var(--primary);text-decoration:underline;cursor:pointer}
button{font:inherit;cursor:pointer;color:var(--foreground);background:var(--secondary);border:1px solid var(--control-border,var(--border));border-radius:var(--radius-md,6px);padding:2px 10px}
button.lx-plain{background:transparent;border-color:transparent}
button:hover{background:var(--surface-hover,var(--accent))}
.lx-input{display:inline-flex;align-items:center;gap:8px}
.lx-label:empty{display:none}
input,select{font:inherit;color:var(--foreground);background:var(--background);border:1px solid var(--control-border,var(--input));border-radius:var(--radius-md,6px);padding:2px 8px}
input:focus,select:focus,button:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
`

export interface ClientFrameInput {
  /** The surface module, bundled by the API (`client-modules.ts`). */
  code: string
  /** The props it starts with; later ones arrive by message, its state kept. */
  props: unknown
  /** Size the region by what the module draws, along that axis. */
  fit: { width: boolean; height: boolean }
  theme: 'light' | 'dark'
  /** The host's theme variables, as `name: value;` declarations. */
  themeCss: string
}

export function buildClientFrameDoc(input: ClientFrameInput): string {
  const boot = jsonForScript({ code: input.code, props: input.props ?? null })
  return `<!doctype html>
<html data-theme="${input.theme}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CLIENT_FRAME_CSP}">
<style id="lx-theme">:root{${input.themeCss.replace(/</g, '')}}</style>
<style>${STYLE}
:root{color-scheme:${input.theme}}
${EMBEDDED_VISUAL_PREFERENCES_CSS}
</style>
</head>
<body>
<div id="root"${input.fit.width ? ' class="lx-fit-width"' : ''}></div>
<script>window.__lxClient = ${boot};</script>
<script>(function () {
'use strict';
${CLIENT_FRAME_DRAW}
${CLIENT_FRAME_RUNTIME}
})();</script>
</body>
</html>`
}
