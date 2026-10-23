import { Fragment, useMemo, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { SectionLabel } from '@localixai/kit/section-label'
import { splitLinkedPaths, type TextSegment } from './linkText'
import { clampConsoleTail } from './consoleTail'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { IconButton } from '@localixai/kit/icon-button'
import { TextAction } from '@localixai/kit/text-action'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { MetadataTooltip } from '@localixai/kit/tooltip'
import { baseName } from '@localixai/api/context-refs'
import { createMessageBindingDraft } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { linkDragProps } from '../linkDrag'
import { detectCodeLanguage } from '@/shared/ui/code-block/detectCodeLanguage'
import { highlightCodeTokens } from '@/shared/ui/code-block/highlightCode'
import { SUGAR_HIGH_THEME } from '@/shared/ui/code-block/sugarHighTheme'

/** Render plain text with file-path tokens turned into inspector-opening links. */
export function LinkedText({
  text,
  syntax = false,
  linkify = true,
}: {
  text: string
  syntax?: boolean
  linkify?: boolean
}) {
  // The transcript's chat: a path in a tool's output opens in the chat that ran the tool.
  const sessionId = useWorkItemSessionId()
  const tokens = useMemo(() => {
    const language = syntax ? detectCodeLanguage(text) : undefined
    return language ? highlightCodeTokens(text, language) : null
  }, [text, syntax])
  const segments: TextSegment[] = linkify ? splitLinkedPaths(text) : [{ text, start: 0 }]
  let tokenIndex = 0
  const colored = (value: string, start: number) => {
    if (!tokens) return value
    const end = start + value.length
    const children: ReactNode[] = []
    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]!
      if (token.start >= end) break
      const content = text.slice(Math.max(start, token.start), Math.min(end, token.end))
      children.push(
        token.kind === 'space' || token.kind === 'break' ? (
          content
        ) : (
          <span
            key={token.start}
            className={`sh__token--${token.kind}`}
            style={{ color: `var(--sh-${token.kind})` }}
          >
            {content}
          </span>
        ),
      )
      if (token.end > end) break
      tokenIndex++
    }
    return children
  }
  return (
    <>
      {segments.map((seg) =>
        seg.path ? (
          <TextAction
            key={seg.start}
            tooltip={seg.line ? `Open ${seg.path}:${seg.line}` : `Open ${seg.path}`}
            tooltipSide="top"
            onClick={(e) => {
              e.stopPropagation()
              if (sessionId) inspector.openFile({ sessionId, path: seg.path!, line: seg.line })
            }}
            className="cursor-pointer rounded-sm text-text-soft underline decoration-dotted decoration-text-faint underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            {colored(seg.text, seg.start)}
          </TextAction>
        ) : seg.href ? (
          <ActionTooltip key={seg.start} label={seg.href} side="top">
            <ExternalAnchor
              href={seg.href}
              onClick={(e) => e.stopPropagation()}
              className="cursor-pointer rounded-sm text-text-soft underline decoration-dotted decoration-text-faint underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground"
            >
              {colored(seg.text, seg.start)}
            </ExternalAnchor>
          </ActionTooltip>
        ) : (
          <Fragment key={seg.start}>{colored(seg.text, seg.start)}</Fragment>
        ),
      )}
    </>
  )
}

// ── Layout primitives ──────────────────────────────────────────────────────────

/** Labelled IN / OUT / DIFF row inside a tool's collapsed body. */
export function IORow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 min-w-0">
      <SectionLabel
        as="span"
        weight="semibold"
        className="shrink-0 w-8 pt-0.5 select-none font-mono"
      >
        {label}
      </SectionLabel>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Scrollable monospace output block — the standard flat "OUT" body.
 *  Pass `linkify` for command/search output so `path:line` tokens become clickable. */
export function OutputBlock({ children, linkify }: { children: ReactNode; linkify?: boolean }) {
  // Tool output remains lossless in the session model. The transcript projection
  // is deliberately bounded, matching ConsoleOutput's live-path caps, so settling a
  // command cannot suddenly mount a multi-megabyte <pre>. The visible marker makes
  // the projection explicit.
  const display = typeof children === 'string' ? clampConsoleTail(children) : children
  return (
    <div className="group relative min-w-0">
      {typeof children === 'string' && <RawCopyButton text={children} />}
      {/* `overscroll-contain`: nested inside the transcript scroller — reaching the
          end of this capped <pre> must not chain into the conversation. */}
      <pre
        className={`max-h-64 overflow-auto overscroll-contain scrollbar-thin px-1 py-1.5 pr-8 font-mono text-2xs leading-relaxed text-text-soft whitespace-pre-wrap break-all ${SUGAR_HIGH_THEME}`}
      >
        {typeof display === 'string' ? (
          <LinkedText text={display} syntax linkify={linkify ?? false} />
        ) : (
          display
        )}
      </pre>
    </div>
  )
}

/** Copy the complete source payload, never the bounded transcript projection. */
export function RawCopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopied()
  const label = copied ? 'Copied full output' : 'Copy full output'
  return (
    <IconButton
      aria-label={label}
      tooltip={label}
      tooltipSide="top"
      size="xs"
      onClick={(event) => {
        event.stopPropagation()
        void copy(text)
      }}
      className="absolute right-1 top-1 z-(--z-raised) opacity-60 transition-[opacity,color,background-color] focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </IconButton>
  )
}

/** The standard "ERR" row — a labelled OutputBlock for a failed tool's message.
 *  Renders nothing when `message` is empty, so call sites need no extra guard.
 *  `linkify` (default on) makes `path:line` tokens clickable; pass false for raw
 *  terminal output. */
export function ErrorRow({ message, linkify = true }: { message?: string; linkify?: boolean }) {
  if (!message) return null
  return (
    <IORow label="ERR">
      <OutputBlock linkify={linkify}>{message}</OutputBlock>
    </IORow>
  )
}

/** Wrapper for the collapsible body — consistent padding and spacing. */
export function ToolBody({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5 py-1.5">{children}</div>
}

/** Compact "+12 −4" line-count badge for file changes. Renders nothing at 0/0. */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions + deletions === 0) return null
  const label = `${additions} addition${additions === 1 ? '' : 's'}, ${deletions} deletion${deletions === 1 ? '' : 's'}`
  return (
    <MetadataTooltip label={label}>
      <span className="inline-flex shrink-0 items-center gap-1 tabular-nums text-2xs font-medium">
        <span className="sr-only">{label}</span>
        {additions > 0 && (
          <span aria-hidden="true" className="text-status-success">
            +{additions}
          </span>
        )}
        {deletions > 0 && (
          <span aria-hidden="true" className="text-status-error">
            −{deletions}
          </span>
        )}
      </span>
    </MetadataTooltip>
  )
}

/**
 * Standard compact tool-row action (e.g. Open / Diff → inspector). Toolbars use
 * stable square icon controls: the accessible name and styled tooltip retain the
 * full label without making row geometry depend on translated action text.
 */
export function ToolHeaderAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  /** Render inert + muted (e.g. a terminal whose process has exited). */
  disabled?: boolean
  /** Destructive lifecycle actions retain the same geometry with danger feedback. */
  tone?: 'default' | 'danger'
}) {
  return (
    <IconButton
      aria-label={label}
      tooltip={label}
      tooltipSide="top"
      size="xs"
      tone={tone}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <Icon className="size-[0.7rem]" />
    </IconButton>
  )
}

// ── File link ──────────────────────────────────────────────────────────────────

/** Clickable file path — opens the file in the in-app inspector panel, and drags as that file. */
export function FileLink({ path, line }: { path: string; line?: number }) {
  const sessionId = useWorkItemSessionId()
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (sessionId) inspector.openFile({ sessionId, path, line })
  }
  return (
    <TextAction
      tooltip={line ? `Open ${path}:${line}` : `Open ${path}`}
      tooltipSide="top"
      onClick={handleClick}
      {...linkDragProps(() => createMessageBindingDraft('file', path, baseName(path)))}
      className="block w-full truncate text-left font-mono text-2xs text-text-faint underline-offset-2 hover:underline hover:text-text-soft transition-colors"
    >
      {path}
    </TextAction>
  )
}
