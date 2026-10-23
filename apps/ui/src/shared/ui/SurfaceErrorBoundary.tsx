import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'
import { captureApplicationFailure } from '@/shared/lib/notifications/applicationFailures'
import { ProblemState } from '@/shared/ui/problem-report'

interface Props {
  /** What failed, named for the user — e.g. a work-item kind or a plugin id. */
  surface: string
  /**
   * What the fallback looks like.
   *
   * `card` reports on the surface the user is looking at. `silent` is for one that renders NOTHING
   * when it works — an always-mounted lifecycle component. Painting a report where the layout
   * expected an empty node is its own visual bug, and the Event Center entry plus a working app is
   * the whole signal such a component can honestly give.
   *
   * The split is lobehub's (`components/ErrorBoundary/index.tsx` picks between an `AlertFallback`
   * and a `SilentFallback` per call site) and it applies here for the same reason.
   */
  fallback?: 'card' | 'silent'
  /** Also tell the surface's owner — a plugin tab's crash is what the agent inspecting it needs. */
  onError?: (error: Error) => void
  children: ReactNode
}

interface State {
  /** The raw React error text. Detail, never the line — see `render`. */
  detail: string | null
  /** Event Center row this crash produced, so "Details" lands on it rather than on the journal. */
  entryId?: string
}

/**
 * Contain a render failure to ONE surface.
 *
 * The app had exactly one boundary, at the root, so any component that threw during render
 * replaced the entire workspace with the root error page. That is the correct behaviour for a core
 * crash and the wrong one for a contributed surface: a plugin's tab is not the application, and a
 * bug in it should cost that tab, not the session, the composer and every other pane.
 *
 * Observed rather than imagined: a plugin work-item body built a `localix://` URI from an empty id
 * during render, the builder threw `TypeError`, and the whole app stopped loading — including for
 * work that had nothing to do with that plugin. The tab is restorable, so the failure came back on
 * every start.
 *
 * The asymmetry is worth naming, because it is why this went unnoticed for so long: the BACKEND
 * has isolated plugin failures all along — `resource-refs.ts` wraps every provider call in a
 * timeout, swallows a failure to `[]`, and surfaces a notice, at five call sites, with the reason
 * written down. The frontend had no equivalent. The principle was already agreed; only one half of
 * the host applied it.
 *
 * Deliberately minimal. It reports and stops; it does not retry (a render that threw once on the
 * same props throws again, and a retry loop is worse than a message), and it does not reset on new
 * props — remounting is the caller's decision, made by changing the `key`.
 */
export class SurfaceErrorBoundary extends Component<Props, State> {
  override state: State = { detail: null }

  static getDerivedStateFromError(error: Error): State {
    return { detail: error.message || error.name }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Named, because the surface is the actionable half: "which plugin" is the first question.
    console.error(
      `[SurfaceErrorBoundary] ${this.props.surface} failed to render`,
      error,
      info.componentStack,
    )
    const entryId = captureApplicationFailure(error, {
      surface: this.props.surface,
      kind: 'render',
    })
    if (entryId) this.setState({ entryId })
    this.props.onError?.(error)
  }

  override render(): ReactNode {
    if (this.state.detail === null) return this.props.children
    if (this.props.fallback === 'silent') return null

    // A React error message is written for whoever wrote the component — `Cannot read properties
    // of undefined (reading 'map')` names no surface and suggests no action. The sentence says
    // which surface is gone and what closes it; the exact text is one click away.
    const report: ProblemReport = {
      subject: { label: this.props.surface },
      problems: [
        {
          message: `${this.props.surface} could not render.`,
          hint: 'Close this tab, or disable the plugin that owns it, to stop it reappearing.',
          detail: this.state.detail,
        },
      ],
      consequence: 'blocked',
    }

    return (
      <div data-surface-error={this.props.surface} className="flex h-full min-h-0 flex-col">
        <ProblemState report={report} entryId={this.state.entryId} />
      </div>
    )
  }
}
