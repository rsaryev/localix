import { useCallback, useEffect, useRef, useState } from 'react'
import { useVisualFeedback } from './useVisualFeedback'
import { VisualFeedbackLayer } from './VisualFeedbackLayer'
import { PreviewIntro } from './PreviewIntro'
import { PreviewBlockedOverlay } from './PreviewOverlays'
import { BrowserToolbar } from './BrowserToolbar'
import { usePreviewCommandRelay } from './usePreviewCommandRelay'
import { usePreviewViewport } from './usePreviewViewport'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { PREVIEW_VIEWPORT_FILL } from '../model/previewViewportPresets'
import { usePreviewEndpoint } from './usePreviewEndpoint'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

const INTRO_SEEN_KEY = 'vf.preview.introSeen'

interface PreviewTabProps {
  previewId?: string
  viewport?: { width: number; height: number } | null
  backgroundHost?: boolean
  /** False while this keep-alive preview body is mounted but not visible. */
  active?: boolean
  url: string
  /** Bumped by the backend when the model re-opens the same preview — forces a reload. */
  version: number
  /** The chat session this preview belongs to — comments are scoped + sent to it. */
  sessionId?: string | null
  /** Entry file the API auto-serves (e.g. "index.html") — visual-feedback source anchor. */
  servedFile?: string
  /** Auto-served static file: the directory we serve. Lets the panel re-serve it (re-bind
   *  the in-process static server) when the API restarted and the ephemeral port died. */
  rootDir?: string
  /** Site refuses iframing (X-Frame-Options / frame-ancestors) — direct view is blank, so the
   *  pane shows its open-in-browser card and offers the strip-proxy view on demand. */
  frameBlocked?: boolean
  /** Load a typed address; absent while no conversation can resolve a dev preview. */
  onNavigate?: (url: string) => void
}

/**
 * An iframe showing whatever the URL returns. Its endpoint is re-resolved after API restarts,
 * and a version bump remounts the page so the agent observes its current output. Whether the
 * page's server is up is not this pane's question: a dead server shows the browser's own error.
 */
export function PreviewTab({
  previewId,
  viewport: initialViewport,
  backgroundHost = false,
  active = true,
  url,
  version,
  sessionId = null,
  servedFile,
  rootDir,
  frameBlocked,
  onNavigate,
}: PreviewTabProps) {
  // Local reload counter — distinct from `version`; remounts the iframe via its key.
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const endpoint = usePreviewEndpoint({ active, url, version, sessionId, rootDir, servedFile })
  const { injectUrl } = endpoint
  // "Engaging" loads the iframe through the injecting-proxy URL so the probe is present.
  // The proxy now relays HMR websockets too, so it's a transparent superset of the direct
  // view — for a normal dev server we engage by DEFAULT (derived below) whenever a probe
  // proxy is available and the site isn't frame-blocked. That keeps the probe loaded the
  // whole time, so toggling view↔capture is a message-only `set-mode` that never remounts
  // the iframe (no reload, open dialogs/state survive). `explicitEngaged` only tracks the
  // opt-in for frame-blocked sites (Cloudflare-style shields), which stay direct by default
  // and engage on demand via the blocked card / agent control.
  const [explicitEngaged, setExplicitEngaged] = useState(false)
  const engage = useCallback(() => setExplicitEngaged(true), [])
  const engaged = explicitEngaged || (!!injectUrl && !frameBlocked)
  // One-time intro on the very first preview a user ever opens (persisted).
  const [showIntro, setShowIntro] = useState(() => !loadString(INTRO_SEEN_KEY))
  const wantCommentRef = useRef(false)

  const dismissIntro = useCallback(() => {
    setShowIntro(false)
    saveString(INTRO_SEEN_KEY, '1')
  }, [])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const vf = useVisualFeedback(iframeRef)

  const { viewport, fixedViewport, changeViewport } = usePreviewViewport({
    sessionId,
    previewId,
    initialViewport,
    backgroundHost,
    active,
  })

  // The src the iframe actually loads. Static auto-served previews already carry the
  // probe inline. For an external dev server we load the strip-PROXY (injectUrl) whenever
  // `engaged` (by default for non-blocked sites, see above) — it injects the probe AND
  // relays HMR. We don't auto-load it for frame-blocked production sites: the proxy strips
  // X-Frame-Options but can't get past a bot-shield (Cloudflare 403) or frame-busting JS,
  // so those stay direct until the user opts in via the can't-embed card.
  const effectiveUrl = engaged && injectUrl ? injectUrl : url
  // The picker is reachable if the probe is connected OR we can engage the proxy.
  const vfAvailable = vf.connected || !!injectUrl

  // The iframe loads a new document whenever its src or key changes (reload, proxy
  // swap, version bump). Reset the bridge connection at that commit — BEFORE the new
  // probe's `ready` postMessage can arrive — so `connected` tracks reality and a page
  // without a probe (a direct external dev server) correctly reads as disconnected.
  // Doing this here (not on iframe `onLoad`) avoids a race: the probe posts `ready` on
  // its DOMContentLoaded, which precedes the parent's iframe `load` event.
  const { notifyReload } = vf
  useEffect(() => {
    notifyReload()
  }, [effectiveUrl, nonce, version, endpoint.epoch, notifyReload])

  // The iframe exists once the live API has said where the page is served from: the only
  // other address is a stored ephemeral port, and mounting that is the white frame over a
  // live app this pane used to show after an API restart. When the API cannot answer, the
  // frame loads the url as given and shows whatever it returns.
  //
  // A site that refuses framing is not mounted directly either. The desktop shell's
  // navigation guard fires for every frame, and a non-loopback document in the iframe is
  // handed to the system browser — which is how typing github.com into the address bar
  // popped a browser window behind the "can't be embedded" card. The card owns that state
  // until the person asks for the strip-proxy view (loopback, so it may be framed).
  const blocked = Boolean(frameBlocked && !engaged)
  const showFrame = (endpoint.ready || endpoint.problem !== null) && !blocked

  // After engaging the proxy, enter comment mode as soon as the probe handshakes.
  useEffect(() => {
    if (vf.connected && wantCommentRef.current) {
      wantCommentRef.current = false
      vf.setMode('comment')
    }
  }, [vf.connected, vf])

  const onToggleComment = useCallback(() => {
    if (vf.connected) {
      // Pure message toggle — the probe stays loaded (we never swap the iframe back
      // to the direct view), so capturing on/off never reloads the page.
      vf.setMode(vf.mode === 'comment' ? 'off' : 'comment')
    } else if (injectUrl && !engaged) {
      // Swap to the injected proxy; comment mode turns on once it connects.
      wantCommentRef.current = true
      engage()
    } else {
      // Static preview whose probe hasn't handshaked yet — queue comment mode.
      wantCommentRef.current = true
    }
  }, [vf, injectUrl, engaged, engage])
  const feedback = { on: vf.mode === 'comment', available: vfAvailable, onToggle: onToggleComment }

  // The agent's `browser` tool commands, answered by this tab's probe.
  usePreviewCommandRelay({
    enabled: backgroundHost || active,
    sessionId,
    previewId,
    frameBlocked: blocked,
    setViewport: (size) =>
      changeViewport(size ? { label: 'Custom', ...size } : PREVIEW_VIEWPORT_FILL, {
        byAgent: true,
      }),
    currentViewport: fixedViewport ? { width: viewport.width!, height: viewport.height! } : null,
    vf,
    hasInjectUrl: !!injectUrl,
    engaged,
    engage,
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!backgroundHost && (
        <BrowserToolbar
          url={url}
          onReload={reload}
          onNavigate={onNavigate}
          feedback={feedback}
          viewport={{ preset: viewport, onChange: changeViewport }}
        />
      )}

      {/* Body: iframe, or the can't-embed card for a site that refuses framing */}
      <div
        className={cn(
          'relative min-h-0 min-w-0 flex-1',
          // A pinned frame is centered on the panel's surface, and scrolls rather
          // than being squeezed — a preset that reads "1440 × 900" must actually BE
          // 1440 CSS px wide, otherwise the breakpoint it is meant to prove is a lie.
          // pane-ground-allow: the sunken fill is a LETTERBOX, not a pane ground — it exists to
          // recede behind the framed page, and `--surface-sunken` is a black veil under the glass
          // theme (an opaque step down elsewhere), so it darkens whatever the pane's ground is
          // instead of replacing it. Only the pinned shape gets it; fit-to-pane inherits the pane.
          fixedViewport && 'grid place-items-center overflow-auto bg-surface-sunken p-3',
          !fixedViewport && 'overflow-hidden',
        )}
      >
        {/* The frame box. Both the iframe AND the Visual Feedback overlay live in it,
            so the probe's viewport-space rects keep mapping 1:1 onto the overlay
            whatever the frame size is — the overlay is positioned against the FRAME,
            never against the panel. */}
        <div
          className={cn(
            'relative',
            fixedViewport
              ? 'shrink-0 overflow-hidden rounded-lg ring-1 ring-border/60 shadow-(--shadow-soft)'
              : 'h-full w-full',
          )}
          style={fixedViewport ? { width: viewport.width!, height: viewport.height! } : undefined}
        >
          {showFrame && (
            <iframe
              ref={iframeRef}
              key={`${version}:${nonce}:${endpoint.epoch}`}
              src={effectiveUrl}
              title={url}
              className="block h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
          )}
          <VisualFeedbackLayer
            active={active && !backgroundHost}
            bridge={vf}
            sessionId={sessionId}
            url={url}
            servedFile={servedFile}
          />
        </div>
        {!backgroundHost && showIntro && (
          <PreviewIntro
            active={active}
            vfAvailable={vfAvailable}
            onBrowse={dismissIntro}
            onComment={() => {
              onToggleComment()
              dismissIntro()
            }}
          />
        )}
        {blocked && <PreviewBlockedOverlay url={url} injectUrl={injectUrl} onEngage={engage} />}
      </div>
    </div>
  )
}
