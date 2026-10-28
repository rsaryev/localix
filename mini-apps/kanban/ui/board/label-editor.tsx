import { useState } from 'react'
import { Plus, Tag } from 'lucide-react'

import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { Input } from '@localixai/kit/input'

import { KANBAN_LABEL_MAX_LENGTH, KANBAN_MAX_LABELS } from '../../shared/contracts'
import { kanbanLabelTone, normalizeKanbanLabel } from '../model/kanbanLabel'

/**
 * Add a label to a task: type a new one, or pick one already used on this board.
 *
 * The suggestion list is what keeps a label vocabulary from fragmenting — without
 * it "flaky", "flakey" and "flake" accumulate as three labels that filter
 * separately. Typed input is normalized exactly as the contract normalizes it, so a
 * label never appears to be new just because it was typed with a capital.
 */
export function LabelEditor({
  labels,
  suggestions,
  onAdd,
}: {
  /** The task's current labels — used to hide what it already has and to cap. */
  labels: readonly string[]
  /** Every label in use on the board, most common first. */
  suggestions: readonly string[]
  onAdd: (label: string) => void
}) {
  const [draft, setDraft] = useState('')
  const full = labels.length >= KANBAN_MAX_LABELS
  const normalized = normalizeKanbanLabel(draft)
  const unused = suggestions.filter((name) => !labels.includes(name))
  const canAdd = normalized.length > 0 && !labels.includes(normalized) && !full

  const add = (label: string) => {
    onAdd(label)
    setDraft('')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={full}
          title={full ? `A task carries at most ${KANBAN_MAX_LABELS} labels` : 'Add a label'}
        >
          <Tag /> Label
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <div className="flex items-center gap-1 p-1">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canAdd) {
                event.preventDefault()
                add(normalized)
              }
            }}
            // The menu's own type-ahead would otherwise swallow the keystrokes.
            onKeyDownCapture={(event) => event.stopPropagation()}
            placeholder="New label…"
            aria-label="New label name"
            maxLength={KANBAN_LABEL_MAX_LENGTH}
            className="h-[var(--chrome-control-sm)] text-xs"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!canAdd}
            onClick={() => add(normalized)}
            aria-label="Add this label"
          >
            <Plus />
          </Button>
        </div>
        {unused.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Used on this board</DropdownMenuLabel>
            {unused.slice(0, 12).map((name) => (
              <DropdownMenuItem key={name} onSelect={() => add(name)}>
                <span
                  className={cn('rounded-sm border px-1.5 py-0.5 text-2xs', kanbanLabelTone(name))}
                >
                  {name}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
