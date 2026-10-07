import { useEffect, useState } from 'react'
import { mermaidRenderer } from './renderMermaid'
import { resolveMermaidLook } from './mermaidLook'

/** A portable diagram without workspace actions, sessions or application state. */
export function MarkdownDiagram({ source }: { source: string }) {
  const [state, setState] = useState<{ source: string; svg?: string; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const look = resolveMermaidLook(theme)
    void mermaidRenderer.render(source, look, controller.signal).then(
      (svg) => {
        if (!controller.signal.aborted) setState({ source, svg })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ source, error: error instanceof Error ? error.message : 'Invalid diagram' })
        }
      },
    )
    return () => controller.abort()
  }, [source])

  if (state?.source === source && state.svg) {
    return (
      <figure aria-label="Diagram" className="lx-diagram">
        <div className="lx-diagram-canvas" dangerouslySetInnerHTML={{ __html: state.svg }} />
      </figure>
    )
  }
  return (
    <figure className="lx-diagram">
      <pre>
        <code>{source}</code>
      </pre>
      <figcaption className="lx-diagram-note" role="status">
        {state?.source === source && state.error
          ? `Diagram could not be drawn: ${state.error.split('\n')[0]}`
          : 'Drawing diagram…'}
      </figcaption>
    </figure>
  )
}
