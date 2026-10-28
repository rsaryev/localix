import { useId } from 'react'
import { Boxes } from 'lucide-react'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Input } from '@localixai/kit/input'
import { matchesChord } from '@localixai/kit/keybindings'
import { Select } from '@localixai/kit/select'
import { Textarea } from '@localixai/kit/textarea'

import type { KanbanTask } from '../../shared/contracts'
import { HUMAN_ASSIGNEE_ID } from '../../shared/rules'
import { PRIORITY_PRESENTATION, type PriorityBucket } from '../model/priorityPresentation'
import { useBoardAgents } from '../model/useBoardAgents'
import { AttachmentField, DependencyField, FIELD_LABEL } from './create-dialog-fields'
import { useCreateTaskForm, type PriorityValue } from './useCreateTaskForm'
import { focusOnMount } from './focusOnMount'

/** The form's three values, drawn by the board's one priority presentation. */
const PRIORITIES: Array<{ value: PriorityValue; bucket: PriorityBucket }> = [
  { value: 1, bucket: 'high' },
  { value: 0, bucket: 'normal' },
  { value: -1, bucket: 'low' },
]

/**
 * The "full" task-creation form (vs. the toolbar's one-line quick-add). Covers everything the
 * create contract supports: markdown description, kind, priority, the assigned agent, the epic,
 * dependencies, and attached workspace file paths.
 */
export function CreateTaskDialog({
  sessionId,
  open,
  onClose,
  tasks,
}: {
  /** The chat whose board the card goes on. */
  sessionId: string
  open: boolean
  onClose: () => void
  tasks: KanbanTask[]
}) {
  const form = useCreateTaskForm({ sessionId, tasks, onClose })
  const readyId = useId()
  const directory = useBoardAgents(sessionId)
  const agentOptions = [
    { value: '', label: directory.loading ? 'Loading agents…' : 'Unassigned' },
    // The directory lists agents only; a card can still wait on the person.
    { value: HUMAN_ASSIGNEE_ID, label: 'You' },
    ...directory.agents.map((a) => ({ value: a.id, label: a.name })),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4 px-0.5 py-1">
          <Input
            value={form.title}
            onChange={(e) => form.setTitle(e.target.value)}
            placeholder="Title"
            ref={focusOnMount}
            onKeyDown={(e) => {
              if (matchesChord(e, 'mod+enter')) void form.submit()
            }}
          />

          <Textarea
            value={form.description}
            onChange={(e) => form.setDescription(e.target.value)}
            placeholder="Description (markdown supported) — context, constraints, links…"
            rows={5}
            className="resize-y"
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL} id="kanban-type-label">
                Type
              </span>
              <SegmentedControl aria-labelledby="kanban-type-label">
                {(['task', 'epic'] as const).map((k) => (
                  <SegmentedControlItem
                    key={k}
                    active={form.kind === k}
                    onClick={() => form.setKind(k)}
                    className="gap-1 capitalize"
                  >
                    {k === 'epic' && <Boxes className="size-3" />} {k}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL} id="kanban-priority-label">
                Priority
              </span>
              <SegmentedControl aria-labelledby="kanban-priority-label">
                {PRIORITIES.map((p) => {
                  const { label, icon: Icon } = PRIORITY_PRESENTATION[p.bucket]
                  return (
                    <SegmentedControlItem
                      key={p.value}
                      active={form.priority === p.value}
                      onClick={() => form.setPriority(p.value)}
                      className="gap-1"
                    >
                      <Icon className="size-3" aria-hidden="true" /> {label}
                    </SegmentedControlItem>
                  )
                })}
              </SegmentedControl>
            </div>

            <div className="col-span-2 flex flex-col gap-1.5">
              <span className={FIELD_LABEL} id="kanban-agent-label">
                Agent <span className="text-text-faint normal-case">(optional)</span>
              </span>
              <Select
                value={form.agent}
                onValueChange={form.setAgent}
                aria-labelledby="kanban-agent-label"
                aria-describedby={directory.error ? 'kanban-agent-error' : undefined}
                disabled={directory.agents.length === 0}
                options={agentOptions}
              />
              {directory.error && (
                <span id="kanban-agent-error" className="text-2xs text-status-error">
                  {directory.error}
                </span>
              )}
            </div>
          </div>

          {form.kind === 'task' && form.epicOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>
                <Boxes className="mr-1 inline size-3" />
                Parent epic{' '}
                <span className="text-text-faint normal-case">
                  (group this task under an epic — optional)
                </span>
              </span>
              <Select
                value={form.parentTaskId}
                onValueChange={form.setParentTaskId}
                aria-label="Parent epic"
                options={[
                  { value: '', label: 'None (top-level task)' },
                  ...form.epicOptions.map((e) => ({ value: e.id, label: e.title })),
                ]}
              />
            </div>
          )}

          {form.kind === 'task' && <DependencyField form={form} />}

          <AttachmentField form={form} />

          {form.error && (
            <p role="alert" className="text-xs text-status-error">
              {form.error}
            </p>
          )}
        </DialogBody>

        <DialogFooter
          aside={
            form.kind === 'task' ? (
              <label
                htmlFor={readyId}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-text-soft"
              >
                <Checkbox
                  id={readyId}
                  checked={form.ready}
                  onChange={(e) => form.setReady(e.target.checked)}
                />
                Put in Ready
              </label>
            ) : undefined
          }
        >
          <Button variant="ghost" size="sm" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void form.submit()}
            disabled={!form.title.trim() || form.busy}
          >
            {form.busy ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
