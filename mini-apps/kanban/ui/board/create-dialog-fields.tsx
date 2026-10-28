import { Check, FolderOpen, Paperclip, Plus, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Chip } from '@localixai/kit/chip'
import { Input } from '@localixai/kit/input'
import { SearchInput } from '@localixai/kit/search-input'
import { TogglePill } from '@localixai/kit/toggle-pill'

import type { CreateTaskForm } from './useCreateTaskForm'

/** The create form's field caption. */
export const FIELD_LABEL = 'text-2xs font-semibold uppercase tracking-wider text-text-faint'

/** Which cards this one waits for — a searchable pill list, the selection pinned first. */
export function DependencyField({ form }: { form: CreateTaskForm }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL} id="kanban-deps-label">
        Depends on{' '}
        <span className="text-text-faint normal-case">(may be taken after these are done)</span>
        {form.dependsOn.length > 0 && (
          <Chip tone="info" size="dense" className="ml-1.5 font-semibold normal-case">
            {form.dependsOn.length} selected
          </Chip>
        )}
      </span>
      {form.depCandidates.length === 0 ? (
        <span className="text-2xs text-text-faint">No other tasks to depend on yet.</span>
      ) : (
        <div
          // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than the
          // dialog's thin glass, so this field group read as a black box in it.
          className="flex flex-col gap-1.5 rounded-lg border border-control-border/55 bg-foreground/[0.03] p-2"
          role="group"
          aria-labelledby="kanban-deps-label"
        >
          <SearchInput
            size="md"
            inset
            value={form.depQuery}
            onValueChange={form.setDepQuery}
            placeholder="Search tasks to link…"
            aria-label="Search dependency tasks"
          />
          {form.depFiltered.length === 0 ? (
            <span className="px-1 py-2 text-center text-2xs text-text-faint">
              No tasks match “{form.depQuery.trim()}”.
            </span>
          ) : (
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto scrollbar-thin">
              {form.depFiltered.map((t) => {
                const on = form.dependsOn.includes(t.id)
                return (
                  <TogglePill
                    key={t.id}
                    active={on}
                    onClick={() => form.toggleDep(t.id)}
                    title={`${t.id} ${t.title}`}
                    className="max-w-[16rem]"
                  >
                    {on && <Check className="size-2.5 shrink-0" />}
                    <span className="truncate">{t.title}</span>
                  </TogglePill>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Workspace paths attached as the card's context: typed, or picked with the native dialog. */
export function AttachmentField({ form }: { form: CreateTaskForm }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>
        <Paperclip className="mr-1 inline size-3" />
        Attached files{' '}
        <span className="text-text-faint normal-case">(workspace paths relevant to the task)</span>
      </span>
      <div className="flex items-center gap-1.5">
        <Input
          value={form.pathDraft}
          onChange={(e) => form.setPathDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              form.addPath()
            }
          }}
          placeholder="e.g. src/features/foo/bar.ts"
          size="lg"
          className="flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={form.addPath}
          disabled={!form.pathDraft.trim()}
        >
          <Plus className="size-3.5" /> Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          title="Choose files with the native picker"
          onClick={() => void form.browsePaths()}
        >
          <FolderOpen className="size-3.5" /> Browse
        </Button>
      </div>
      {form.attachedPaths.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {form.attachedPaths.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => form.removePath(p)}
              // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than
              // the dialog, so these path chips read as black pills.
              className="flex h-6 max-w-[18rem] items-center gap-1 rounded-md border border-control-border/55 bg-foreground/[0.04] px-2 font-mono text-2xs text-text-soft outline-none transition-colors focus-ring hover:border-status-error/50 hover:bg-surface-hover hover:text-foreground"
              title={`Remove ${p}`}
            >
              <span className="truncate">{p}</span>
              <X className="size-2.5 shrink-0 text-text-faint" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
