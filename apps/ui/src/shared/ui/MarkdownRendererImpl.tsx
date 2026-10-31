import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { ActionSurfaceProvider, useActionSurface } from '@localixai/mini-app-sdk/ui'
import { ContentActionBlock, ContentLinkActions } from './ContentActionBlock'
import { rehypeContentActions } from './rehypeContentActions'
import { MarkdownImg } from './MarkdownImage'
import {
  loadMathPlugins,
  mathPluginsReady,
  remarkPluginsFor,
  rehypePluginsFor,
} from '@localixai/markdown/markdownPlugins'
import { CodeBlock } from './code-block'
import { closePartialMarkdown, openFenceBody } from '@localixai/markdown/markdown-stream'
import { hasMathSyntax, hasHtmlSyntax } from '@localixai/markdown/syntax'
import { escapeLiteralDollars } from '@localixai/markdown/markdown-dollars'
import { useSmoothedText } from '@/shared/hooks/useSmoothedText'
import { useStreamingThrottle, STREAM_MARKDOWN_REPARSE_MS } from './useStreamingThrottle'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { inlineCodeToPath, inlineCodeLine } from './markdownFileRef'
import { classifyMarkdownLink, markdownUrlTransform } from './markdownLink'
import { MarkdownAgentLink } from './MarkdownAgentLink'
import { MarkdownAppViewLink } from './MarkdownAppViewLink'
import { childrenToText, getLanguage, isCodeBlock } from '@localixai/markdown/markdownHelpers'
import { remarkFileMention, mentionPathFromHref } from './remarkFileMention'
import { FileMentionChip } from './FileMentionChip'
import { ExternalAnchor } from './external-anchor'
import { MarkdownBlockquote } from '@localixai/markdown/MarkdownBlockquote'
import { MermaidDiagram } from './mermaid/MermaidDiagram'
import { GrowingFenceContext, StreamingDiagram } from './mermaid/StreamingDiagram'
import { DIAGRAM_FENCE_LANGUAGE, TREE_FENCE_LANGUAGE } from '@localixai/markdown/dialect'
import { AnswerVariant, AnswerVariants } from '@localixai/markdown/AnswerVariants'
import { FileTree } from './FileTree'
import { MarkdownInput, SourceTasks } from './MarkdownTaskList'

export interface MarkdownRendererProps {
  children: string
  /** Optional streaming hint from the caller. It only toggles the paced/throttled
   * rendering path; the final markdown output stays the same either way. */
  isStreaming?: boolean
  /** Render `@path` tokens as clickable file-mention chips (user messages). */
  linkifyMentions?: boolean
  /**
   * For markdown whose text IS its store (a board's text element): a ticked checklist box
   * rewrites its `[ ]` in the source and hands the new text here. Absent, a box outside a
   * message stays read-only.
   */
  onSourceChange?: (markdown: string) => void
  /**
   * Off for a document from outside Localix (a mini app's README in the store): its HTML is
   * dropped rather than parsed, so only Markdown reaches the page. On by default.
   */
  rawHtml?: boolean
}

type CodeProps = ComponentPropsWithoutRef<'code'> & { node?: unknown }
type MarkdownPreProps = ComponentPropsWithoutRef<'pre'> & { node?: unknown }
type MarkdownLinkProps = ComponentPropsWithoutRef<'a'> & { node?: unknown }
type MarkdownTableProps = ComponentPropsWithoutRef<'table'> & { node?: unknown }

// While a message streams, the model appends text every ~16ms. Re-parsing the
// WHOLE accumulated markdown (remark/rehype + syntax highlighting of every
// nested code block) on each delta is O(text²) over the message. Throttle the
// re-parse to this cadence during streaming; the final frame is always exact
// because we bypass the throttle entirely once streaming stops (see below).
// ~25fps commits read as one continuous flow; the length backoff below still
// protects long messages from the quadratic re-parse.
// Parsing only the appended tail was investigated and rejected: in CommonMark a
// prefix is not stable, so "append-only" is not a property this text has. Three
// measured counterexamples across a blank-line boundary — a second list item
// turns the first LOOSE (`<li>a</li>` → `<li><p>a</p></li>`), a later link
// reference definition turns earlier `[foo]` into an anchor, a later footnote
// definition rewrites its earlier reference — all mutate output already
// rendered. (Re-rendering the FULL markdown every flush and morphing the DOM is not
// a counter-example: React's reconciler already does that for us, and a paragraph
// buffer only withholds the unfinished tail block.)
// Client-side reveal cadence. The model's text is already paced server-side, but
// it still reaches us in clumps (network framing, the throttle below, a cache
// hit dumping the whole reply at once). A steady prefix reveal makes text flow
// word-by-word instead of jumping a paragraph per throttle tick. Slightly calmer
// than the code-stream default (220ms) — this is prose meant to be read.
const TEXT_REVEAL_CATCH_UP_MS = 260
// A math chunk that failed to load is retried this many times, this far apart (see MarkdownBody).
const MATH_LOAD_RETRIES = 3
const MATH_RETRY_MS = 1_500
// Beyond this size, even core CommonMark parsing can monopolize a frame. Keep the
// growing body readable as escaped text, then let the user opt into the exact expensive render.
export const STREAMING_PLAIN_TEXT_THRESHOLD = 128_000
const STREAMING_PLAIN_TEXT_HEAD = 16_000
const STREAMING_PLAIN_TEXT_OMISSION = '\n\n… middle content omitted while streaming …\n\n'

export function boundPlainStreamingText(text: string): string {
  if (text.length <= STREAMING_PLAIN_TEXT_THRESHOLD) return text
  const tailLength =
    STREAMING_PLAIN_TEXT_THRESHOLD -
    STREAMING_PLAIN_TEXT_HEAD -
    STREAMING_PLAIN_TEXT_OMISSION.length
  return (
    text.slice(0, STREAMING_PLAIN_TEXT_HEAD) +
    STREAMING_PLAIN_TEXT_OMISSION +
    text.slice(-tailLength)
  )
}

export function shouldRenderPlainStreaming(
  length: number,
  streaming: boolean | undefined,
): boolean {
  return Boolean(streaming) && length >= STREAMING_PLAIN_TEXT_THRESHOLD
}

export function shouldSmoothStreaming(length: number, streaming: boolean): boolean {
  return streaming && !shouldRenderPlainStreaming(length, streaming)
}

export function shouldDeferOversizedMarkdown(
  length: number,
  streaming: boolean | undefined,
  expanded: boolean,
): boolean {
  return !streaming && !expanded && length >= STREAMING_PLAIN_TEXT_THRESHOLD
}

/**
 * Math is typeset while a reply streams too: the typesetter reuses every formula it already set
 * (`rehypeMathCached`), so a tick pays only for an expression it has not seen, and the stream
 * stabilizer withholds one still being typed (`markdown-stream.ts`). Until then a reply showed
 * raw `$…$` source for as long as it streamed and re-flowed when it settled.
 */
export function shouldActivateMath(hasMath: boolean, mathReady: boolean): boolean {
  return hasMath && mathReady
}

export function shouldActivateHtml(hasHtml: boolean, streaming: boolean | undefined): boolean {
  return hasHtml && !streaming
}

/**
 * The actual remark/rehype parse. Split out and memoized so that when the
 * throttled text is unchanged between renders (the common case mid-stream),
 * react-markdown does NOT re-parse — `components` is referentially stable
 * (memoized with no deps; file links call the shared inspector bus), so the
 * memo bails cleanly.
 */
const MarkdownBody = memo(function MarkdownBody({
  text,
  components,
  streaming,
  linkifyMentions,
  rawHtml = true,
}: {
  text: string
  components: Components
  streaming?: boolean
  linkifyMentions?: boolean
  rawHtml?: boolean
}) {
  const plainStreaming = shouldRenderPlainStreaming(text.length, streaming)
  const actionSurface = useActionSurface()
  const [expandedText, setExpandedText] = useState<string | null>(null)
  const deferFullMarkdown = shouldDeferOversizedMarkdown(
    text.length,
    streaming,
    expandedText === text,
  )
  // Mid-stream the text often ends inside a construct (open ``` fence, dangling
  // `**`, half-typed link) that would flash as raw syntax until the model closes
  // it — stabilize the tail while streaming; the final frame renders verbatim.
  const plainDisplay = useMemo(
    () => (plainStreaming || deferFullMarkdown ? boundPlainStreamingText(text) : text),
    [plainStreaming, deferFullMarkdown, text],
  )
  // Literal dollars (`$5`, `$HOME`) are escaped before remark-math can pair them into a formula
  // (markdown-dollars.ts). The plain-text path renders this string verbatim, so it is not escaped.
  const display = useMemo(() => {
    if (plainStreaming) return plainDisplay
    return escapeLiteralDollars(streaming ? closePartialMarkdown(text) : plainDisplay)
  }, [streaming, plainStreaming, text, plainDisplay])
  // The one fence still being written (StreamingDiagram draws every other diagram at once).
  const growingFence = useMemo(() => (streaming ? openFenceBody(text) : null), [streaming, text])
  const hasMath = hasMathSyntax(display)
  const hasHtml = rawHtml && hasHtmlSyntax(display)
  // Raw HTML is incomplete while streaming and often appears inside growing HTML
  // code fences. Keep it inert until settlement, then parse and sanitize together.
  const htmlActive = shouldActivateHtml(hasHtml, streaming)
  // Lazy-load the KaTeX pipeline on first math sighting; re-render once it lands.
  const [mathReady, setMathReady] = useState(() => mathPluginsReady())
  const [mathAttempt, setMathAttempt] = useState(0)
  useEffect(() => {
    if (!hasMath || mathReady || mathAttempt > MATH_LOAD_RETRIES) return
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    loadMathPlugins().then(
      () => {
        if (!cancelled) setMathReady(true)
      },
      // A failed chunk load is retried by this message itself, a few times, so formulas appear
      // without a reload once the chunk is reachable again.
      () => {
        if (!cancelled) retry = setTimeout(() => setMathAttempt((n) => n + 1), MATH_RETRY_MS)
      },
    )
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [hasMath, mathReady, mathAttempt])
  const mathActive = shouldActivateMath(hasMath, mathReady && mathPluginsReady())
  const remarkPlugins = useMemo(() => {
    const plugins = [...remarkPluginsFor(mathActive)]
    if (linkifyMentions) plugins.push(remarkFileMention)
    return plugins
  }, [mathActive, linkifyMentions])
  const rehypePlugins = useMemo(
    () =>
      rehypePluginsFor(
        htmlActive,
        mathActive,
        actionSurface === 'chat.content' && !streaming ? rehypeContentActions(display) : undefined,
      ),
    [htmlActive, mathActive, actionSurface, streaming, display],
  )
  if (plainStreaming) {
    return (
      <div className="markdown-renderer whitespace-pre-wrap break-words" data-streaming="">
        {plainDisplay}
      </div>
    )
  }
  if (deferFullMarkdown) {
    return (
      <div className="space-y-2">
        <div className="markdown-renderer whitespace-pre-wrap break-words">{plainDisplay}</div>
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-soft hover:bg-surface-hover hover:text-foreground"
          onClick={() => setExpandedText(text)}
        >
          Render complete formatted message (may be slow)
        </button>
      </div>
    )
  }
  return (
    <div className="markdown-renderer" data-streaming={streaming ? '' : undefined}>
      <ActionSurfaceProvider surface={streaming ? null : actionSurface}>
        <GrowingFenceContext.Provider value={growingFence}>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={components}
            urlTransform={markdownUrlTransform}
            skipHtml={!rawHtml}
          >
            {display}
          </ReactMarkdown>
        </GrowingFenceContext.Provider>
      </ActionSurfaceProvider>
    </div>
  )
})

function MarkdownPre({ children: c }: MarkdownPreProps) {
  return c
}

export function tableRequiresKeyboardScroll(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth + 1
}

function MarkdownTable({ children: c, node: _node, ...tableProps }: MarkdownTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)
  const label =
    typeof tableProps['aria-label'] === 'string'
      ? `${tableProps['aria-label']} scroll area`
      : 'Scrollable table'
  const updateScrollable = useCallback(() => {
    const element = scrollRef.current
    setScrollable(
      Boolean(element && tableRequiresKeyboardScroll(element.scrollWidth, element.clientWidth)),
    )
  }, [])

  useEffect(() => {
    updateScrollable()
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateScrollable)
    observer.observe(element)
    const table = element.querySelector('table')
    if (table) observer.observe(table)
    return () => observer.disconnect()
  }, [updateScrollable])

  return (
    <div
      ref={scrollRef}
      className="lx-markdown-table scrollbar-thin"
      data-scrollable={scrollable || undefined}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? label : undefined}
      tabIndex={scrollable ? 0 : undefined}
    >
      <table {...tableProps}>{c}</table>
    </div>
  )
}

function MarkdownCode({ children: c, className }: CodeProps) {
  const sessionId = useWorkItemSessionId()
  const code = childrenToText(c)
  const lang = getLanguage(className)
  // Settled components only: streaming diagrams use MarkdownStreamingCode.
  if (lang === DIAGRAM_FENCE_LANGUAGE) return <MermaidDiagram source={code.replace(/\n$/, '')} />
  if (lang === TREE_FENCE_LANGUAGE) return <FileTree source={code} />
  if (isCodeBlock(c, className)) return <CodeBlock code={code} language={lang} />
  const filePath = inlineCodeToPath(code)
  // A file reference opens in the chat this markdown belongs to; outside one it stays prose.
  if (filePath && sessionId) {
    const fileLine = inlineCodeLine(code)
    const open = () => inspector.openFile({ sessionId, path: filePath, line: fileLine })
    // A file reference in prose → open it in the inspector. Resting style is
    // unchanged; the underline only appears on hover so prose stays calm.
    return (
      <code className={className}>
        <button
          type="button"
          className="inline cursor-pointer rounded-xs text-left underline-offset-2 outline-none hover:underline focus-ring"
          title={fileLine ? `Open ${filePath}:${fileLine}` : `Open ${filePath}`}
          onClick={open}
        >
          {c}
        </button>
      </code>
    )
  }
  return <code className={className}>{c}</code>
}

function MarkdownStreamingCode({ children: c, className }: CodeProps) {
  const code = childrenToText(c)
  const lang = getLanguage(className)
  if (lang === DIAGRAM_FENCE_LANGUAGE) return <StreamingDiagram source={code.replace(/\n$/, '')} />
  // A tree is cheap to lay out line by line, so it grows with the stream like prose.
  if (lang === TREE_FENCE_LANGUAGE) return <FileTree source={code} />
  if (isCodeBlock(c, className)) {
    return <CodeBlock code={code} language={lang} />
  }
  return <MarkdownCode className={className}>{c}</MarkdownCode>
}

function MarkdownLink({ href, children: c }: MarkdownLinkProps) {
  const sessionId = useWorkItemSessionId()
  const safeHref = typeof href === 'string' ? href : undefined
  const mentionPath = mentionPathFromHref(safeHref)
  if (mentionPath) return <FileMentionChip path={mentionPath} />
  const target = classifyMarkdownLink(safeHref)
  if (target.kind === 'agent-profile')
    return <MarkdownAgentLink href={target.href}>{c}</MarkdownAgentLink>
  if (target.kind === 'app-view')
    return <MarkdownAppViewLink href={target.href}>{c}</MarkdownAppViewLink>
  if (target.kind === 'file') {
    // File reference → open in the in-app inspector instead of navigating — in the chat this
    // markdown belongs to. Outside one there is no workspace to open it in, so it stays text.
    if (!sessionId) return <span>{c}</span>
    return (
      <ContentLinkActions
        target={{ kind: 'file', path: target.path, line: target.line, title: childrenToText(c) }}
      >
        <a
          href={safeHref}
          className="cursor-pointer"
          title={target.line ? `Open ${target.path}:${target.line}` : `Open ${target.path}`}
          onClick={(e) => {
            e.preventDefault()
            inspector.openFile({ sessionId, path: target.path, line: target.line })
          }}
        >
          {c}
        </a>
      </ContentLinkActions>
    )
  }
  if (target.kind === 'external') {
    return (
      <ContentLinkActions target={{ kind: 'link', url: target.href, title: childrenToText(c) }}>
        <ExternalAnchor href={target.href} title={target.href} newTab={target.newTab}>
          {c}
        </ExternalAnchor>
      </ContentLinkActions>
    )
  }
  return <span>{c}</span>
}

// Note: we deliberately do NOT spread react-markdown's extra props (it
// injects `node` + a `ref` typed against its bundled @types/react, which
// conflicts with ours). We pass only the attributes we actually need.
const BASE_COMPONENTS: Components = {
  ...({
    'content-actions': ContentActionBlock,
    // The `> [!TABS]` container (`remarkAnswerContainers.ts`).
    'answer-tabs': AnswerVariants,
    'answer-tab': AnswerVariant,
  } as Components),
  pre: MarkdownPre,
  // GFM task boxes: tickable, and stored on the message, inside an agent's reply.
  input: MarkdownInput,
  blockquote: MarkdownBlockquote,
  table: MarkdownTable,
  code: MarkdownCode,
  a: MarkdownLink,
  img: MarkdownImg,
}
const STREAMING_COMPONENTS: Components = { ...BASE_COMPONENTS, code: MarkdownStreamingCode }

export function markdownComponentsForStreaming(streaming = false): Components {
  return streaming ? STREAMING_COMPONENTS : BASE_COMPONENTS
}

const MarkdownRendererImpl = memo(function MarkdownRendererImpl({
  children,
  isStreaming,
  linkifyMentions,
  onSourceChange,
  rawHtml,
}: MarkdownRendererProps) {
  const streaming = isStreaming ?? false
  const smoothStreaming = shouldSmoothStreaming(children.length, streaming)
  // Steady reveal first (decouples display from arrival bursts), then throttle
  // the parse. Loaded history renders instantly, while oversized streams skip
  // the extra animation state updates and follow the transport cadence directly.
  const paced = useSmoothedText(smoothStreaming ? children : undefined, TEXT_REVEAL_CATCH_UP_MS)
  const text = useStreamingThrottle(
    smoothStreaming ? paced : children,
    streaming,
    STREAM_MARKDOWN_REPARSE_MS,
  )

  const body = (
    <MarkdownBody
      text={text}
      components={markdownComponentsForStreaming(streaming)}
      streaming={isStreaming}
      linkifyMentions={linkifyMentions}
      rawHtml={rawHtml}
    />
  )
  return onSourceChange ? (
    <SourceTasks source={children} onSourceChange={onSourceChange}>
      {body}
    </SourceTasks>
  ) : (
    body
  )
})

export default MarkdownRendererImpl
