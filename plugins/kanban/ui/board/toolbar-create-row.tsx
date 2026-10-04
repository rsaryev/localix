import { ArrowUp, Plus, SquarePen } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@localixai/kit/input-group'

/**
 * The "new task" row — title input and the add / full-form actions. A card created here lands in
 * the backlog of the chat this board belongs to; there is no other place it could go.
 */
export function KanbanCreateRow({
  draft,
  setDraft,
  busy,
  onCreate,
  onOpenFullCreate,
}: {
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  busy: boolean
  onCreate: () => Promise<void>
  /** Open the full task-creation form (description, dependencies, attachments…). */
  onOpenFullCreate: () => void
}) {
  const canCreate = draft.trim().length > 0 && !busy
  // Every control keeps the kit's own geometry: the group is the `md` rung (28px), its text is the
  // field's, and the trailing actions are `xs`/`icon-sm` so they sit INSIDE the field with the
  // host's inset. The row used to override the text to `text-sm` and put a 28px send button in a
  // 28px field, so the text rode high and the button sat glued to the border.
  return (
    <InputGroup aria-label="Quick task creation">
      <InputGroupAddon>
        <Plus className="size-3.5 text-text-faint" />
      </InputGroupAddon>
      <InputGroupInput
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void onCreate()
          else if (e.key === 'Escape' && draft) {
            e.preventDefault()
            setDraft('')
          }
        }}
        aria-label="New task title"
        placeholder="Add a task to the backlog…"
      />
      <InputGroupAddon
        align="inline-end"
        aria-label="New task actions"
        focusOnClick={false}
        className="gap-1"
      >
        <InputGroupButton
          size="xs"
          onClick={onOpenFullCreate}
          aria-label="New task with full details"
          title="Full task form — description, dependencies, attachments…"
        >
          {/* "Full form", not "Details": this opens the CREATE form, while a card's details are
              its own tab — the old label named both. */}
          <SquarePen className="size-3 shrink-0" />
          <span className="hidden @md:inline">Full form</span>
        </InputGroupButton>
        {/* Quiet until there is a title to send: a disabled solid button was the heaviest thing
            in the row while doing nothing. */}
        <InputGroupButton
          variant={canCreate ? 'mono' : 'ghost'}
          size="icon-sm"
          disabled={!canCreate}
          onClick={() => void onCreate()}
          aria-label="Add task"
        >
          <ArrowUp className="size-3.5" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
