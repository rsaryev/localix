import { useEffect, useRef } from 'react'
import { ArrowUpRight, X, FileCode2 } from 'lucide-react'
import { CodeEditor } from '@/shared/ui/code-editor/CodeEditor'
import { languageFromPath } from '@/shared/ui/diff'
import { IconButton } from '@localixai/kit/icon-button'
import { TextAction } from '@localixai/kit/text-action'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { ProblemLine } from '@/shared/ui/problem-report'
import type { PeekDefinitionView, PeekTarget } from './usePeekDefinition'

export type { PeekTarget } from './usePeekDefinition'

/**
 * Inline "Peek Definition" panel (Alt+F12):
 * a docked, read-only preview of the definition's source WITHOUT navigating the
 * editor away. Shows the target file, reveals the definition line, and offers
 * "Open" (jump there for real) + "Close".
 *
 * The read itself belongs to the tab (see `usePeekDefinition`): this panel is unmounted the moment
 * the peek closes, which is the one thing a problem owner may not be.
 */
export function PeekDefinitionPanel({
  target,
  view,
  onOpen,
  onClose,
}: {
  target: PeekTarget
  view: PeekDefinitionView
  onOpen: (target: PeekTarget) => void
  onClose: () => void
}) {
  const { content, revealKey, problem } = view
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes the peek.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [onClose])

  // A foreground VEIL, not `bg-surface-raised`: this is a pane-sized docked region (full width,
  // fixed height) inside the editor pane, and `--surface-raised` mixes from a ground DARKER than
  // that pane — under the macOS glass theme the panel read as a black strip below the code. A veil
  // lifts whatever the pane's ground turned out to be instead of replacing it, on every theme.
  return (
    <div
      ref={panelRef}
      className="flex h-64 shrink-0 flex-col border-t-2 border-control-border-focus bg-foreground/[0.04]"
      role="region"
      aria-label={`Definition preview: ${baseName(target.file)}`}
    >
      {/* No fill: the panel above already carries the relief, and `--surface-raised` is not
          covered by the paint-the-ground-once rule, so a second coat compounded into a black
          strip under glass. The toolbar inherits the panel's ground. */}
      <WorkbenchToolbar aria-label="Definition preview actions" className="text-2xs">
        <FileCode2 className="size-3 shrink-0 text-text-faint" />
        <TextAction
          onClick={() => onOpen(target)}
          tooltip={`Open ${target.file}:${target.line + 1}`}
          className="min-w-0 truncate text-text-soft hover:text-foreground hover:underline"
        >
          {baseName(target.file)}
          <span className="text-text-faint">:{target.line + 1}</span>
        </TextAction>
        <WorkbenchToolbarSection align="end" spacing="compact" aria-label="Definition actions">
          <button
            type="button"
            onClick={() => onOpen(target)}
            title="Open definition in the editor"
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            <ArrowUpRight className="size-3" />
            Open
          </button>
          <IconButton
            size="xs"
            tooltip="Close peek (Esc)"
            aria-label="Close definition preview"
            onClick={onClose}
          >
            <X className="size-3" />
          </IconButton>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <div className="min-h-0 flex-1">
        {problem ? (
          <ProblemLine {...problem} className="p-3" />
        ) : content == null ? (
          <ActivitySignal
            label="Loading definition"
            className="p-3 text-2xs text-text-faint"
            labelClassName="min-w-0"
          />
        ) : (
          <CodeEditor
            value={content}
            language={languageFromPath(target.file)}
            readOnly
            initialLine={target.line + 1}
            initialColumn={target.character}
            revealKey={revealKey}
            ariaLabel={`Definition of ${baseName(target.file)}`}
          />
        )}
      </div>
    </div>
  )
}
