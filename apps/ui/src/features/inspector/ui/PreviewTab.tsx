import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useVisualFeedback } from './useVisualFeedback'
import { VisualFeedbackLayer } from './VisualFeedbackLayer'
import { PreviewIntro } from './PreviewIntro'
import { PreviewStatusOverlay } from './PreviewOverlays'
import { BrowserToolbar } from './BrowserToolbar'
import { usePreviewCommandRelay } from './usePreviewCommandRelay'
import { usePreviewViewport } from './usePreviewViewport'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { PREVIEW_VIEWPORT_FILL } from '../model/previewViewportPresets'
import { usePreviewLiveness } from './usePreviewLiveness'
import { usePreviewEndpoint } from './usePreviewEndpoint'
import { usePreviewLastFrame } from './usePreviewLastFrame'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'
import {
  initialPreviewOverlayState,
  previewOverlayReducer,
  selectPreviewOverlayKind,
} from '../model/previewOverlayMachine'

const INTRO_SEEN_KEY = 'vf.preview.introSeen'
// The server answers but the iframe never painted a document within this window →
// a nav/load failure (not a slow SPA — the DOCUMENT loads fast). Flip to the overlay
// instead of leaving a white screen.
const PREVIEW_LOAD_TIMEOUT_MS = 10_000

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
  /** Shell command that started this server — relaunched (in the session workspace) when
   *  the server stops, so the stopped overlay offers "Start server" instead of a dead reload. */
  startCommand?: string
  startCwd?: string
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
 * A live iframe whose endpoint is re-resolved after API restarts. Liveness selects
 * the sleeping overlay; recovery reloads the frame. A version bump re-asks both
 * hooks and remounts the page so the agent observes its current output.
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
  startCommand,
  startCwd,
  rootDir,
  frameBlocked,
  onNavigate,
}: PreviewTabProps) {
  // Where the frame points. Declared before liveness so its `refresh` can be the recovery
  // callback; it depends on `status` only through the `stopped` flag fed below.
  const endpointRef = useRef<{ refresh: () => void }>({ refresh: () => {} })
  const {
    status,
    probed,
    starting,
    startProblem,
    startedTerminalId,
    nonce,
    reload,
    startServer,
    stopServer,
  } = usePreviewLiveness({
    active,
    url,
    version,
    sessionId,
    startCommand,
    startCwd,
    onRecover: () => endpointRef.current.refresh(),
  })
  const endpoint = usePreviewEndpoint({
    active,
    url,
    version,
    sessionId,
    rootDir,
    servedFile,
    stopped: status === 'stopped',
  })
  useEffect(() => {
    endpointRef.current = endpoint
  })
  const { injectUrl } = endpoint
  // "Engaging" loads the iframe through the injecting-proxy URL so the probe is present.
  // The proxy now relays HMR websockets too, so it's a transparent superset of the direct
  // view — for a normal dev server we engage by DEFAULT (derived below) whenever a probe
  // proxy is available and the site isn't frame-blocked. That keeps the probe loaded the
  // whole time, so toggling view↔capture is a message-only `set-mode` that never remounts
  // the iframe (no reload, open dialogs/state survive). `explicitEngaged` only tracks the
  // opt-in for frame-blocked sites (Cloudflare-style shields), which stay direct by default
  // and engage on demand via the blocked card / agent control.
  const [overlayState, dispatchOverlay] = useReducer(
    previewOverlayReducer,
    initialPreviewOverlayState,
  )
  const engaged = overlayState.explicitEngaged || (!!injectUrl && !frameBlocked)
  // Load tracking is KEYED by the frame identity (src + remount key) instead of
  // boolean state reset in an effect: a reload/repoint changes the key, so
  // `loaded`/`unreachable` derive to false for the new document with no
  // setState-in-effect cascade. Set in the onLoad handler / the guard timer only.
  // The no-white-screen guard and loaded identity live in the overlay state
  // machine; both are keyed by frame so navigation never needs a reset effect.
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

  // The frame identity: any reload/repoint/proxy-swap/re-resolve yields a new key, deriving
  // the per-frame `loaded`/`unreachable` flags back to false automatically.
  const frameKey = `${effectiveUrl}|${nonce}|${version}|${endpoint.epoch}`
  // The page is live (not a white void) once the iframe fires onLoad OR our probe
  // handshakes — either proves a document actually ran.
  const isLoaded = overlayState.loadedFrame === frameKey || vf.connected
  const unreachable = overlayState.unreachableFrame === frameKey

  // Photograph the live page now and then, so when it dies the pane can show the page it
  // was instead of an empty rectangle (the way a dead terminal keeps its scrollback).
  const lastFrame = usePreviewLastFrame({
    active: active && !backgroundHost,
    url,
    frameKey,
    connected: vf.connected,
    live: status === 'running' && isLoaded,
    captureElement: vf.captureElement,
  })

  // No-white-screen guard: if the server answers (status 'running') but the iframe
  // never loads a document within the timeout — a nav/load failure, not a blank app —
  // flip to the "unreachable" overlay (Reload / Open in browser) instead of white.
  // Never fires for a frame-blocked site (it has its own card).
  // Before the port answers there is no frame to wait on, so the guard would time out a
  // document that was never asked for.
  useEffect(() => {
    if (!active || !probed || !endpoint.ready || status !== 'running' || frameBlocked || isLoaded)
      return
    const t = setTimeout(
      () => dispatchOverlay({ type: 'frame-timeout', frameKey }),
      PREVIEW_LOAD_TIMEOUT_MS,
    )
    return () => clearTimeout(t)
  }, [active, probed, endpoint.ready, status, frameBlocked, isLoaded, frameKey])

  // The iframe exists whenever the server is believed to be up AND the live API has said
  // where the page is served from. It is not gated on the liveness answer (a slow answer
  // would be a blank pane; a dead port repaints from cache, so the ANSWER covers the frame
  // via the opaque dormant surface instead). It IS gated on the address: the only other
  // address is a stored ephemeral port, and mounting that is exactly the white frame over a
  // live app this pane used to show after an API restart.
  //
  // A site that refuses framing is not mounted directly either. The desktop shell's
  // navigation guard fires for every frame, and a non-loopback document in the iframe is
  // handed to the system browser — which is how typing github.com into the address bar
  // popped a browser window behind the "can't be embedded" card. The card owns that state
  // until the person asks for the strip-proxy view (loopback, so it may be framed).
  const showFrame = status === 'running' && endpoint.ready && !(frameBlocked && !engaged)

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
      dispatchOverlay({ type: 'engage' })
    } else {
      // Static preview whose probe hasn't handshaked yet — queue comment mode.
      wantCommentRef.current = true
    }
  }, [vf, injectUrl, engaged])
  const feedback = { on: vf.mode === 'comment', available: vfAvailable, onToggle: onToggleComment }

  // Whether this preview can be relaunched without a shell command (drives the
  // stopped-overlay "Wake preview" affordance). A file we serve is woken by re-resolving
  // its address (the API re-serves it); a dev server needs its `startCommand`.
  const isAutoServed = !!rootDir && !!servedFile
  const wake = startCommand && sessionId ? startServer : endpoint.refresh
  const waking = starting || (status === 'stopped' && isAutoServed && endpoint.resolving)

  // The agent's `browser` tool commands, answered by this tab's probe.
  usePreviewCommandRelay({
    enabled: backgroundHost || active,
    sessionId,
    previewId,
    frameBlocked: Boolean(frameBlocked && !engaged),
    setViewport: (size) =>
      changeViewport(size ? { label: 'Custom', ...size } : PREVIEW_VIEWPORT_FILL),
    vf,
    hasInjectUrl: !!injectUrl,
    engaged,
    engage: () => dispatchOverlay({ type: 'engage' }),
  })

  // The single overlay's state, in precedence order: a down server beats a blocked
  // embed beats a frame that never loaded. `null` = the live iframe shows through.
  const overlayKind = selectPreviewOverlayKind({
    status,
    frameBlocked: Boolean(frameBlocked),
    engaged,
    // An address the live API would not give us is a frame that cannot load: say so, with
    // the API's reason, rather than withholding the frame in silence.
    unreachable: unreachable || (!endpoint.ready && endpoint.problem !== null),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!backgroundHost && (
        <BrowserToolbar
          url={url}
          onReload={reload}
          onNavigate={onNavigate}
          feedback={feedback}
          viewport={{ preset: viewport, onChange: changeViewport }}
          onStopServer={startedTerminalId && status === 'running' ? stopServer : undefined}
        />
      )}

      {/* Body: iframe + optional stopped overlay */}
      <div
        className={cn(
          'relative min-h-0 flex-1',
          // A pinned frame is centered on the panel's surface, and scrolls rather
          // than being squeezed — a preset that reads "1440 × 900" must actually BE
          // 1440 CSS px wide, otherwise the breakpoint it is meant to prove is a lie.
          // pane-ground-allow: the sunken fill is a LETTERBOX, not a pane ground — it exists to
          // recede behind the framed page, and `--surface-sunken` is a black veil under the glass
          // theme (an opaque step down elsewhere), so it darkens whatever the pane's ground is
          // instead of replacing it. Only the pinned shape gets it; fit-to-pane inherits the pane.
          fixedViewport && 'grid place-items-center overflow-auto bg-surface-sunken p-3',
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
              onLoad={() => dispatchOverlay({ type: 'frame-loaded', frameKey })}
              className="h-full w-full border-0 bg-white"
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
        {!backgroundHost && showIntro && status === 'running' && (
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
        {/* ONE centered overlay for every not-running state — so a dead server, a
            blocked embed, or a frame that never loaded all show a clear restart
            affordance instead of a white screen. `stopped` (ping failed) wins; else a
            frame-blocked site offers its open/embed choice; else the no-white-screen
            guard (`unreachable`) offers Reload / Open in browser. */}
        {overlayKind && (
          <PreviewStatusOverlay
            kind={overlayKind}
            starting={waking}
            startProblem={startProblem ?? endpoint.problem}
            // A dev server relaunches in this preview's chat workspace; with no chat it cannot.
            canStart={isAutoServed || (!!startCommand && !!sessionId)}
            startCommand={startCommand}
            url={url}
            injectUrl={injectUrl}
            lastFrame={lastFrame}
            frameMounted={showFrame}
            onStart={wake}
            onReload={reload}
            onEngage={() => dispatchOverlay({ type: 'engage' })}
          />
        )}
      </div>
    </div>
  )
}
