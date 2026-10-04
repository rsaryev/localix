import { ExternalLink, MonitorOff, MonitorPause, MonitorX, Power, RotateCw } from 'lucide-react'
import type { ComponentType } from 'react'
import { formatTimeAgo } from '@localixai/plugin-sdk/ui/utilities'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { Button } from '@localixai/kit/button'
import { PaneStateOverlay } from '@localixai/kit/pane-state-overlay'
import { StateNotice } from '@localixai/kit/state-notice'
import { ProblemLine } from '@/shared/ui/problem-report'
import { PreviewDormantSurface } from './PreviewDormantSurface'
import type { PreviewFrame } from '../model/previewLastFrame'
import type { PreviewOverlayKind } from '../model/previewOverlayMachine'
import type { OwnedProblemReport } from '@/shared/ui/problem-report'

export type { PreviewOverlayKind } from '../model/previewOverlayMachine'

/**
 * The single, centered overlay shown over the preview iframe for every
 * not-running state — so a dead/blocked/blank preview always shows a clear,
 * minimal restart affordance instead of a white screen. One component, one
 * `kind` discriminator:
 *  - `stopped`     — the server is down (liveness ping failed). Offers Restart
 *                    (a remembered dev command or an auto-served file we re-serve)
 *                    + Reload.
 *  - `unreachable` — the server answers but the iframe never loaded (nav/load
 *                    failure). Offers Reload + Open in browser.
 *  - `blocked`     — the site refuses embedding (X-Frame-Options / a bot shield).
 *                    Offers Open in browser + Try embedded (the strip-proxy).
 *
 * Every kind paints {@link PreviewDormantSurface} first: the dead iframe keeps its white
 * fill, and a scrim over white is a flat grey slab. The surface replaces it with the
 * page's last frame (blurred, pushed back) or the app's own ground, and the notice sits
 * on that, in the shape the "No preview open" state uses — a monitor glyph, a title, an
 * action — so every empty preview pane in the app reads as one family. Nothing else is
 * spelled out on the pane: the command a wake would run waits on the action's hover.
 */
const HEADLINE: Record<PreviewOverlayKind, string> = {
  stopped: 'Preview is sleeping',
  unreachable: 'Preview didn’t load',
  blocked: 'This site can’t be embedded',
}

const ICON: Record<
  PreviewOverlayKind,
  ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>
> = {
  stopped: MonitorPause,
  unreachable: MonitorX,
  blocked: MonitorOff,
}

export function PreviewStatusOverlay({
  kind,
  starting = false,
  startProblem,
  canStart = false,
  startCommand,
  url,
  injectUrl,
  lastFrame,
  frameMounted = false,
  onStart,
  onReload,
  onEngage,
}: {
  kind: PreviewOverlayKind
  /** Server-relaunch in progress — spinner label + disabled primary. */
  starting?: boolean
  /** A relaunch attempt failed — reported under the headline, and in the Event Center. */
  startProblem?: OwnedProblemReport | null
  /** We can revive the server in place (remembered command or auto-served file). */
  canStart?: boolean
  startCommand?: string
  url: string
  injectUrl?: string
  /** The page as it last painted, shown behind the notice when we have one. */
  lastFrame?: PreviewFrame | null
  /** A loaded iframe is still mounted under the overlay and must be covered, not tinted. */
  frameMounted?: boolean
  onStart?: () => void
  onReload: () => void
  onEngage?: () => void
}) {
  // The host owns external navigation and its confirmation policy across all UI surfaces.
  const openInBrowserClick = () => platformCapabilities().external.open(url)
  const canRestart = canStart && onStart != null
  const Icon = ICON[kind]
  // A site that refuses embedding never painted here, so anything cached under its url is
  // from some earlier, differently-loaded document — show the themed void instead.
  const ghost = kind === 'blocked' ? null : lastFrame
  // Veil only what is actually behind. With the frame unmounted and no ghost, the pane's own
  // ground is showing, and a scrim over it is just a second, slightly different material —
  // which is what made the preview stand out as a bright slab in the light theme.
  const material = frameMounted || ghost ? 'subtle' : 'plain'
  // The title states the state and the buttons state the recovery, so a sentence between
  // them is decoration — three lines of it was the whole pane. What remains is the one thing
  // neither says: whether what you are looking at behind the notice is a live page or a
  // photograph of a dead one. A failure replaces even that, since ProblemLine IS the report.
  const body = startProblem ? (
    <ProblemLine {...startProblem} className="items-center" />
  ) : ghost ? (
    <span className="text-2xs">Last frame · {formatTimeAgo(ghost.capturedAt)}</span>
  ) : undefined

  // The command is the answer to "what will this button do", which is a question you only
  // ask with the pointer already on the button — so it lives on hover (in mono, unwrapped)
  // rather than in a sentence that pushed the notice to three lines.
  const wakeButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={starting}
      aria-busy={starting}
      onClick={canRestart ? onStart : onReload}
    >
      {canRestart ? (
        <Power data-icon="inline-start" aria-hidden />
      ) : (
        <RotateCw data-icon="inline-start" aria-hidden />
      )}
      {starting ? 'Waking…' : canRestart ? 'Wake preview' : 'Try again'}
    </Button>
  )
  const wakeAction =
    canRestart && startCommand ? (
      <ActionTooltip
        disabled={starting}
        accessibleLabel={`Runs ${startCommand}`}
        label={<span className="font-mono text-2xs">{startCommand}</span>}
      >
        {wakeButton}
      </ActionTooltip>
    ) : (
      wakeButton
    )

  if (kind === 'stopped') {
    return (
      <>
        <PreviewDormantSurface frame={ghost} occlude={frameMounted} />
        <PaneStateOverlay material={material} className="pointer-events-none">
          <StateNotice
            className="pointer-events-auto max-w-sm flex-none"
            icon={starting ? undefined : Icon}
            ariaLive={starting ? 'polite' : undefined}
            role={starting ? 'status' : undefined}
            title={starting ? 'Waking the preview…' : HEADLINE.stopped}
            body={body}
            actionsLabel="Preview recovery actions"
            actions={wakeAction}
          />
        </PaneStateOverlay>
      </>
    )
  }
  const reload = (
    <Button type="button" variant="mono" size="sm" onClick={onReload}>
      <RotateCw data-icon="inline-start" aria-hidden />
      Reload
    </Button>
  )
  const openInBrowser = (
    <Button type="button" variant="outline" size="sm" onClick={openInBrowserClick}>
      <ExternalLink data-icon="inline-start" aria-hidden /> Open in browser
    </Button>
  )

  const actions =
    kind === 'unreachable' ? (
      <>
        {reload}
        {openInBrowser}
      </>
    ) : (
      <>
        <Button type="button" variant="mono" size="sm" onClick={openInBrowserClick}>
          <ExternalLink data-icon="inline-start" aria-hidden /> Open in browser
        </Button>
        {injectUrl && onEngage && (
          <Button type="button" variant="outline" size="sm" onClick={onEngage}>
            Try embedded view
          </Button>
        )}
      </>
    )

  return (
    <>
      <PreviewDormantSurface frame={ghost} occlude={frameMounted} />
      <PaneStateOverlay material={material}>
        <StateNotice
          className="flex-none"
          icon={starting ? undefined : Icon}
          ariaLive={starting ? 'polite' : undefined}
          role={starting ? 'status' : undefined}
          title={starting ? 'Waking the preview…' : HEADLINE[kind]}
          body={body}
          actionsLabel="Preview recovery actions"
          actions={actions}
        />
      </PaneStateOverlay>
    </>
  )
}
