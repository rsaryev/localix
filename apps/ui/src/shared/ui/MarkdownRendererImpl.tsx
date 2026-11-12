import { memo, type ComponentPropsWithoutRef } from 'react'
import {
  Markdown,
  childrenToText,
  getLanguage,
  isCodeBlock,
  type Extension,
  type MarkdownComponents,
} from '@localix-ai/flowdown'
import { ActionSurfaceProvider, useActionSurface } from '@localixai/mini-app-sdk/ui'
import { ContentActionBlock, ContentLinkActions } from './ContentActionBlock'
import { contentActions } from './contentActionsExtension'
import { MarkdownImg } from './MarkdownImage'
import { CodeBlock } from './code-block'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { inlineCodeToPath, inlineCodeLine } from './markdownFileRef'
import { classifyMarkdownLink, markdownUrlTransform } from './markdownLink'
import { MarkdownAgentLink } from './MarkdownAgentLink'
import { MarkdownAppViewLink } from './MarkdownAppViewLink'
import { fileMentions, mentionPathFromHref } from './fileMentionExtension'
import { FileMentionChip } from './FileMentionChip'
import { ExternalAnchor } from './external-anchor'
import { DiagramPending, MermaidDiagram } from './mermaid/MermaidDiagram'
import { FileTree } from './FileTree'
import { MarkdownInput, SourceTasks } from './MarkdownTaskList'
import { loadMath } from './markdownStages'

export interface MarkdownRendererProps {
  children: string
  /** The text is still arriving: its unfinished end is completed while it streams. */
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

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & { node?: unknown }
type MarkdownPreProps = ComponentPropsWithoutRef<'pre'> & { node?: unknown }
type MarkdownLinkProps = ComponentPropsWithoutRef<'a'> & { node?: unknown }

// Client-side reveal cadence. The model's text is already paced server-side, but it still reaches
// us in clumps (network framing, a cache hit dumping the whole reply at once). A steady prefix
// reveal makes text flow word by word instead of jumping a paragraph at a time. Slightly calmer
// than the code-stream default (220ms): this is prose meant to be read.
const TEXT_REVEAL_CATCH_UP_MS = 260

// The renderer keeps every finished block of a streaming reply and parses only the end that
// changed (`flowdown`), so a token costs the same at the end of a long reply as at its start.
// That is why there is no reparse throttle and no plain-text fallback for long replies here.

/** The fence's code element owns the frame (CodeBlock), so `pre` adds nothing around it. */
function MarkdownPre({ children: c }: MarkdownPreProps) {
  return c
}

function MarkdownCode({ children: c, className }: MarkdownCodeProps) {
  const sessionId = useWorkItemSessionId()
  const code = childrenToText(c)
  if (isCodeBlock(c, className)) return <CodeBlock code={code} language={getLanguage(className)} />
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

/**
 * A ```mermaid fence. The fence a streaming reply still ends inside is incomplete (every token
 * would be a layout, most of them a syntax error), so it holds its place as a pending frame; every
 * finished diagram above it is drawn at once.
 */
function MarkdownDiagram({ source, growing }: { source: string; growing: boolean }) {
  return growing ? <DiagramPending /> : <MermaidDiagram source={source} />
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

// The components take only the attributes they use: `<Markdown>` also hands each one `node`, the
// parsed node it draws, which no DOM element takes.
const COMPONENTS: MarkdownComponents = {
  ...({ 'content-actions': ContentActionBlock } as MarkdownComponents),
  pre: MarkdownPre,
  // GFM task boxes: tickable, and stored on the message, inside an agent's reply.
  input: MarkdownInput,
  code: MarkdownCode,
  a: MarkdownLink,
  img: MarkdownImg,
  diagram: MarkdownDiagram,
  tree: FileTree,
}

// Module constants, one list per combination: `<Markdown>` redraws every block when its
// extension list changes.
const EXTENSIONS: Record<'none' | 'mentions' | 'actions' | 'both', Extension[]> = {
  none: [],
  mentions: [fileMentions],
  actions: [contentActions],
  both: [fileMentions, contentActions],
}

const MarkdownRendererImpl = memo(function MarkdownRendererImpl({
  children,
  isStreaming,
  linkifyMentions,
  onSourceChange,
  rawHtml = true,
}: MarkdownRendererProps) {
  const streaming = isStreaming ?? false
  const actionSurface = useActionSurface()
  // Block actions belong to a settled reply in a conversation: a streaming block is still moving.
  const actions = actionSurface === 'chat.content' && !streaming

  const body = (
    <ActionSurfaceProvider surface={streaming ? null : actionSurface}>
      <Markdown
        streaming={streaming}
        smooth={TEXT_REVEAL_CATCH_UP_MS}
        components={COMPONENTS}
        extensions={
          EXTENSIONS[
            linkifyMentions ? (actions ? 'both' : 'mentions') : actions ? 'actions' : 'none'
          ]
        }
        html={rawHtml}
        math={loadMath}
        urlTransform={markdownUrlTransform}
      >
        {children}
      </Markdown>
    </ActionSurfaceProvider>
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
