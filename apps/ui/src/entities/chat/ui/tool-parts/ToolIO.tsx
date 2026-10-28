import type { ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { LinkedText } from './LinkedText'
import { clampConsoleTail } from './consoleTail'
import { IconButton } from '@localixai/kit/icon-button'
import { TextAction } from '@localixai/kit/text-action'
import { MetadataTooltip } from '@localixai/kit/tooltip'
import { baseName } from '@localixai/api/context-refs'
import { createMessageBindingDraft } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { linkDragProps } from '../linkDrag'
import { SUGAR_HIGH_THEME } from '@/shared/ui/code-block/sugarHighTheme'

// ── Layout primitives ──────────────────────────────────────────────────────────

/**
 * The words a tool card labels its sections with. Every card says what it was given (`In`) and
 * what came back (`Out`), a failure as `Error`; a batch numbers its items. A free-form label was
 * the old shape, and a long one (PROMPT) outgrew the label column and printed over its content.
 */
export type ToolSectionLabel = 'In' | 'Out' | 'Error' | number

/**
 * One labelled section of a tool card's body: the label in a fixed column, the content beside it.
 * The group is named by its label so a screen reader hears "In" / "Out" / "Error" for what the
 * sighted reader sees; the visible label is hidden from it so the word is not read twice.
 */
export function IORow({ label, children }: { label: ToolSectionLabel; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={typeof label === 'number' ? `Item ${label}` : label}
      className="flex min-w-0 gap-2"
    >
      <span
        aria-hidden="true"
        className="w-10 shrink-0 select-none pt-2 text-2xs font-medium text-text-faint"
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * Scrollable output block — the standard flat body of an `In` or `Out` section. Code, JSON and
 * command output stay monospace (a `<pre>`); pass `prose` for natural language (a subagent's
 * prompt or answer, a message), which is set in the interface font and wraps at word boundaries.
 * Both cap at the same height, scroll inside themselves, and carry the same copy button.
 * Pass `linkify` for command/search output so `path:line` tokens become clickable.
 */
export function OutputBlock({
  children,
  linkify,
  prose,
}: {
  children: ReactNode
  linkify?: boolean
  prose?: boolean
}) {
  // Tool output remains lossless in the session model. The transcript projection
  // is deliberately bounded, matching ConsoleOutput's live-path caps, so settling a
  // command cannot suddenly mount a multi-megabyte <pre>. The visible marker makes
  // the projection explicit.
  const display = typeof children === 'string' ? clampConsoleTail(children) : children
  // `overscroll-contain`: nested inside the transcript scroller — reaching the
  // end of this capped block must not chain into the conversation.
  const frame = 'max-h-64 overflow-auto overscroll-contain scrollbar-thin px-1 py-1.5 pr-8'
  return (
    <div className="group relative min-w-0">
      {typeof children === 'string' && <RawCopyButton text={children} />}
      {prose ? (
        <div
          className={`${frame} text-xs leading-relaxed text-text-soft whitespace-pre-wrap break-words`}
        >
          {typeof display === 'string' ? (
            <LinkedText text={display} linkify={linkify ?? false} />
          ) : (
            display
          )}
        </div>
      ) : (
        <pre
          className={`${frame} font-mono text-2xs leading-relaxed text-text-soft whitespace-pre-wrap break-all ${SUGAR_HIGH_THEME}`}
        >
          {typeof display === 'string' ? (
            <LinkedText text={display} syntax linkify={linkify ?? false} />
          ) : (
            display
          )}
        </pre>
      )}
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

/** The standard `Error` section — a labelled OutputBlock for a failed tool's message.
 *  Renders nothing when `message` is empty, so call sites need no extra guard.
 *  `linkify` (default on) makes `path:line` tokens clickable; pass false for raw
 *  terminal output. */
export function ErrorRow({ message, linkify = true }: { message?: string; linkify?: boolean }) {
  if (!message) return null
  return (
    <IORow label="Error">
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
