import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Root safety net: a thrown render error shows a readable message instead of a
 *  blank white page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[landing] render error:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-xl px-5 py-24">
        <h1 className="font-heading text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-text-soft">The page failed to render. Details below:</p>
        <pre className="mt-4 overflow-auto rounded-lg border border-border-subtle bg-surface-raised p-4 text-sm text-status-error">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-4 rounded-lg border border-control-border px-4 py-2 text-sm hover:bg-surface-hover"
        >
          Reload
        </button>
      </div>
    )
  }
}
