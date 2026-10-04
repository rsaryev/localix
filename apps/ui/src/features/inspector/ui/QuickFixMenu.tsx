import { useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { Spinner } from '@localixai/kit/spinner'
import { toast } from '@/shared/lib/notify'
import { backendClient } from '@/shared/api/client'
import type { LspCodeAction, LspRange } from '@/shared/api/contracts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { settleLspEdit } from '../model/lspEditResult'

/**
 * Per-diagnostic quick-fix affordance for the Problems panel — a lightbulb
 * on each marker row. On open it lazily asks the language server for
 * `quickfix` code actions overlapping the diagnostic's range (nothing is fetched
 * until the user clicks, so a noisy panel stays cheap), then applies the chosen
 * action — its edits land in the open editor's buffer, or on disk for a file nobody
 * holds open (`settleLspEdit`). Reuses the exact same
 * `lspCodeAction` / `lspApplyCodeAction` RPCs the editor's inline quick-fix uses.
 */
export function QuickFixMenu({
  sessionId,
  file,
  range,
  className,
}: {
  sessionId: string
  file: string
  range: LspRange
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actions, setActions] = useState<LspCodeAction[] | null>(null)
  const [applying, setApplying] = useState(false)

  const loadActions = async () => {
    setLoading(true)
    try {
      const fixes = await backendClient.lspCodeAction(sessionId, file, range, ['quickfix'])
      setActions(fixes)
    } catch (err) {
      // Swallowed, a language server that failed to answer rendered as "No quick fixes
      // available" — a claim about the CODE made from a failure of the request.
      setActions([])
      toast.error('Could not list quick fixes', {
        description: errorMessage(err, '') || undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    // Fetch lazily each time the menu is opened so fixes reflect the current
    // file state (an earlier fix may have resolved this diagnostic).
    if (next) {
      setActions(null)
      void loadActions()
    }
  }

  const apply = async (action: LspCodeAction) => {
    setApplying(true)
    try {
      const result = await backendClient.lspApplyCodeAction(sessionId, file, action)
      // A fix that changed files shows its edit in the editor holding it, so it gets no row;
      // one that changed nothing would otherwise leave no trace at all.
      if (settleLspEdit(result, 'Applied fix') === 0 && !result.bufferEdits?.length)
        toast.info(`“${action.title}” made no changes`)
      setOpen(false)
    } catch (err) {
      toast.error(`Could not apply “${action.title}”`, {
        description: errorMessage(err, '') || undefined,
      })
    } finally {
      setApplying(false)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title="Quick fix"
          aria-label="Quick fix"
          className={cn(
            'shrink-0 rounded-sm p-0.5 text-text-faint outline-none transition-colors focus-ring hover:bg-surface-hover hover:text-status-warning data-[state=open]:text-status-warning',
            className,
          )}
        >
          <Lightbulb className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-faint">
            <Spinner className="size-3.5" />
            Finding quick fixes…
          </div>
        )}
        {!loading && actions?.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-text-faint">No quick fixes available</div>
        )}
        {!loading &&
          actions?.map((action) => (
            <DropdownMenuItem
              key={`${action.kind ?? 'quickfix'}:${action.title}`}
              disabled={applying}
              onSelect={(e) => {
                e.preventDefault()
                void apply(action)
              }}
              className="gap-2 text-xs"
            >
              <Lightbulb className="size-3.5 shrink-0 text-status-warning" />
              <span className="min-w-0 flex-1 truncate">{action.title}</span>
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
