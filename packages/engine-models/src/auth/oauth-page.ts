import { LOCALIX_LOGO_SVG } from './localix-logo'

function renderWindLines(count = 24): string {
  return Array.from({ length: count }, (_, i) => {
    const random = (seed: number) =>
      (((Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) % 1) + 1) % 1
    const duration = 1.4 + random(1) * 1.8
    const y = (random(2) - 0.5) * 200
    const width = 120 + random(3) * 200
    const delay = -random(4) * duration
    const opacity = 0.14 + random(5) * 0.28
    const thickness = 1.2 + random(6) * 2
    return `<i style="--y:${y.toFixed(1)}px;--w:${width.toFixed(1)}px;--delay:${delay.toFixed(2)}s;--duration:${duration.toFixed(2)}s;--opacity:${opacity.toFixed(2)};--wind-opacity:${opacity.toFixed(2)};--thickness:${thickness.toFixed(1)}px"></i>`
  }).join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function renderPage(options: {
  title: string
  heading: string
  message: string
  details?: string
}): string {
  const title = escapeHtml(options.title)
  const heading = escapeHtml(options.heading)
  const message = escapeHtml(options.message)
  const details = options.details ? escapeHtml(options.details) : undefined
  const windLines = renderWindLines()

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --text: #fafafa;
      --text-dim: #a1a1aa;
      --page-bg: #09090b;
      --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--font-sans);
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .bird-stage {
      position: relative;
      width: 176px;
      height: 176px;
      display: grid;
      place-items: center;
      margin: 0 auto 20px;
      animation: bird-intro .7s cubic-bezier(.2,.8,.2,1) both;
    }
    .wind {
      position: absolute;
      inset: 0;
      overflow: visible;
      pointer-events: none;
    }
    .wind i {
      position: absolute;
      top: calc(50% + var(--y));
      right: -40%;
      width: var(--w);
      height: var(--thickness);
      border-radius: 999px;
      background: linear-gradient(90deg, transparent 5%, rgba(225,228,240,var(--opacity)) 50%, transparent 95%);
      animation: wind-sweep var(--duration) var(--delay) linear infinite;
    }
    .brand-mark {
      position: relative;
      z-index: 1;
      width: 80px;
      height: 80px;
      display: block;
      filter: drop-shadow(0 10px 26px rgba(153, 181, 255, .16));
      animation: bird-drift 6s ease-in-out infinite;
    }
    .brand-mark svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      color: var(--text);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: var(--text-dim);
      font-size: 15px;
    }
    .details {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
    @keyframes bird-intro {
      from { opacity: 0; transform: scale(.95); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes bird-drift {
      0%, 50%, 100% { transform: translate3d(0, 0, 0) scale(1); }
      25% { transform: translate3d(0, -6px, 0) scale(1.01); }
      75% { transform: translate3d(0, 4px, 0) scale(.99); }
    }
    @keyframes wind-sweep {
      0% { opacity: 0; transform: translate3d(0, 0, 0); }
      18%, 72% { opacity: var(--wind-opacity, .2); }
      100% { opacity: 0; transform: translate3d(-600px, 0, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .bird-stage, .brand-mark, .wind i { animation: none; }
      .wind i { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <div class="bird-stage" aria-label="Localix"><div class="wind">${windLines}</div><span class="brand-mark">${LOCALIX_LOGO_SVG}</span></div>
    <h1>${heading}</h1>
    <p>${message}</p>
    ${details ? `<div class="details">${details}</div>` : ''}
  </main>
</body>
</html>`
}

export function oauthSuccessHtml(message: string): string {
  return renderPage({
    title: 'Authentication successful',
    heading: 'Authentication successful',
    message,
  })
}

export function oauthErrorHtml(message: string, details?: string): string {
  return renderPage({
    title: 'Authentication failed',
    heading: 'Authentication failed',
    message,
    details,
  })
}
