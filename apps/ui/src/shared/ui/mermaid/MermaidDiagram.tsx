import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Check, Code2, Copy, Maximize2, Workflow } from 'lucide-react'
import { useCopied } from '@localixai/plugin-sdk/ui/interactions'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useTheme, type ResolvedTheme } from '@/shared/theme/useTheme'
import { IconButton } from '@localixai/kit/icon-button'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { CodeBlock } from '@/shared/ui/code-block'
import { mermaidRenderer, type MermaidRenderer } from './renderMermaid'
import { resolveMermaidLook, type MermaidLook } from './mermaidLook'
import DiagramViewer from './DiagramViewer'
import { ContributedActions } from '../ContributedActions'
import { diagramBounds } from './diagramGeometry'

type DiagramState = { source: string; svg: string } | { source: string; error: string } | null

/**
 * The box every state of a diagram shares, so drawing it in never moves the text around it. No
 * outline: a diagram sits in the reply as an image does, and a frame around each one read as a
 * stack of panels between the paragraphs.
 */
const FRAME = 'lx-diagram group relative my-3.5'

/**
 * The place a diagram will appear, shown while its fence is still being written and while its
 * first layout runs. It replaces the raw source on purpose: a half-written graph definition read
 * as broken output, and it swapped into a picture of a different height a moment later.
 */
export function DiagramPending() {
  return (
    <div className={cn(FRAME, 'lx-diagram-pending')} role="status" aria-label="Drawing diagram">
      <Workflow aria-hidden className="size-4" strokeWidth={1.5} />
      <span>Drawing diagram…</span>
    </div>
  )
}

// One resolution per theme for the whole transcript: every diagram in it shares the palette, and
// re-reading the tokens per mounted row would repeat the probe work on every scroll pass.
let lastLook: { theme: ResolvedTheme; look: MermaidLook } | null = null

function useMermaidLook(): MermaidLook | null {
  const { resolvedTheme } = useTheme()
  // Tokens are read from the live document; a server render has none, and waits as pending.
  return useMemo(() => {
    if (typeof document === 'undefined') return null
    if (lastLook?.theme !== resolvedTheme) {
      lastLook = { theme: resolvedTheme, look: resolveMermaidLook(resolvedTheme) }
    }
    return lastLook.look
  }, [resolvedTheme])
}

/**
 * A complete ```mermaid fence, drawn as a diagram in the transcript's own colours.
 *
 * Complete means its closing fence has arrived — not that the whole reply has: the streaming
 * renderer mounts this for every closed fence and keeps only the one still growing as
 * {@link DiagramPending}. A source that does not parse stays readable code with the parser's
 * first line under it.
 */
export function MermaidDiagram({
  source,
  renderer = mermaidRenderer,
  embedded = false,
}: {
  source: string
  renderer?: MermaidRenderer
  /** A board owns gestures and editing; draw only the live diagram content there. */
  embedded?: boolean
}) {
  const look = useMermaidLook()
  const [state, setState] = useState<DiagramState>(() => {
    const svg = look ? renderer.peek(source, look) : undefined
    return svg === undefined ? null : { source, svg }
  })
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const enlarge = (event: MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget
    setExpanded(true)
  }
  const { copied, copy } = useCopied(1800)

  useEffect(() => {
    if (!look) return
    const cached = renderer.peek(source, look)
    if (cached !== undefined) {
      setState({ source, svg: cached })
      return
    }
    const controller = new AbortController()
    renderer.render(source, look, controller.signal).then(
      (svg) => !controller.signal.aborted && setState({ source, svg }),
      (error: unknown) =>
        !controller.signal.aborted &&
        setState({ source, error: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      controller.abort()
    }
  }, [renderer, source, look])

  // A source that does not parse is shown as what it is — code — through the transcript's one
  // code block, highlighted like any other fence, with the parser's first line under it.
  // A changed fence may still be drawing. Never export the previous picture with the new source.
  if (!state || state.source !== source) return <DiagramPending />
  if ('error' in state) {
    return (
      <div>
        <CodeBlock code={source} language="mermaid" />
        <p className="lx-diagram-note" role="status">
          Diagram could not be drawn: {state.error.split('\n')[0]}
        </p>
      </div>
    )
  }

  if (embedded)
    return (
      <div
        className="lx-diagram-embedded size-full [&>svg]:h-full [&>svg]:w-full [&>svg]:max-w-none!"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  const { width, height } = diagramBounds(state.svg)
  const target = {
    kind: 'visualization' as const,
    format: 'mermaid',
    source,
    svg: state.svg,
    width,
    height,
    title: source.match(/^\s*title\s+(.+)$/mu)?.[1]?.trim(),
  }

  // The source view IS the transcript's standard code block (header, language, copy, highlight),
  // not a second rendering of code; the way back is one more action in that block's own toolbar,
  // where a reader already looks for its controls.
  if (showSource) {
    return (
      <CodeBlock
        code={source}
        language="mermaid"
        actions={
          <IconButton
            size="sm"
            onClick={() => setShowSource(false)}
            aria-label="Show diagram"
            tooltip="Show diagram"
          >
            <Workflow className="size-3.5" />
          </IconButton>
        }
      />
    )
  }

  return (
    <figure className={FRAME}>
      <button
        type="button"
        className="lx-diagram-canvas scrollbar-thin w-full cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
        aria-label="Enlarge diagram"
        aria-haspopup="dialog"
        onClick={enlarge}
        // The SVG comes from Mermaid with `securityLevel: 'strict'` (see renderMermaid.ts).
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
      {/* `lx-media-actions` is the transcript's hover-action hook: a coarse pointer has no
          hover, and app/index.css shows these anyway there (the same row images use). */}
      <div
        className={cn(
          FLOATING_SURFACE,
          'lx-media-actions pointer-events-none absolute right-2 top-2 flex items-center gap-0.5 p-0.5 opacity-0 transition-opacity duration-(--dur-fast) group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
        )}
      >
        <IconButton
          size="sm"
          onClick={enlarge}
          aria-label="Enlarge diagram"
          tooltip="Enlarge diagram"
        >
          <Maximize2 className="size-3.5" />
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => setShowSource(true)}
          aria-label="Show source"
          tooltip="Show source"
        >
          <Code2 className="size-3.5" />
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => void copy(source)}
          aria-label={copied ? 'Copied' : 'Copy source'}
          tooltip={copied ? 'Copied' : 'Copy source'}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </IconButton>
        <ContributedActions target={target} />
      </div>
      {expanded && (
        <DiagramViewer
          svg={state.svg}
          actions={<ContributedActions target={target} />}
          onClose={() => setExpanded(false)}
          returnFocus={() => opener.current?.focus()}
        />
      )}
    </figure>
  )
}
