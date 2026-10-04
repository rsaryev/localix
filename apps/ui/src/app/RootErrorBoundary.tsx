import { Component, type ErrorInfo, type ReactNode } from 'react'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keep the crash reporter out of the startup chunk; persist the incident after containment. */
export async function reportRootRenderFailure(error: Error): Promise<void> {
  try {
    const { captureApplicationFailure } =
      await import('@/shared/lib/notifications/applicationFailures')
    captureApplicationFailure(error, { surface: 'Application shell', kind: 'render' })
  } catch (reportingError) {
    // The root boundary is the final containment layer. Reporting must never
    // replace its reload UI with another exception.
    console.error('[RootErrorBoundary] failed to persist crash', reportingError)
  }
}

/**
 * App-wide render safety net. Without it, ANY error thrown during render
 * unmounts the whole React tree and leaves a bare black screen — most visibly
 * after a Fast Refresh hot-patch (which a full manual reload was the only way to
 * recover from). Here it instead surfaces a minimal, always-styled fallback with
 * a Reload button. In dev it also shows the error text to speed up debugging.
 *
 * This is defense-in-depth: the primary HMR-stability fix is gating the React
 * Compiler to production builds (see apps/ui/vite.config.ts).
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // last-resort crash log
    console.error('[RootErrorBoundary] uncaught render error', error, info.componentStack)
    void reportRootRenderFailure(error)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: 'var(--color-background, #070707)',
          color: 'var(--color-foreground, #e5e5e5)',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>Something broke</div>
        <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 520 }}>
          The interface hit an unrecoverable error. Reloading usually fixes it.
        </div>
        {import.meta.env.DEV && (
          <pre
            style={{
              maxWidth: 640,
              maxHeight: 200,
              overflow: 'auto',
              fontSize: 11,
              textAlign: 'left',
              opacity: 0.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={() => platformCapabilities().navigation.reload()}
          style={{
            padding: '8px 18px',
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 8,
            border: '1px solid var(--color-control-border, #3a3a3a)',
            background: 'var(--color-surface-hover, #1a1a1a)',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
