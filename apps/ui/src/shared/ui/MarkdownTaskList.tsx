import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { Checkbox } from '@localixai/kit/checkbox'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'

/**
 * A CHECKLIST THE READER CAN TICK: GFM's `- [ ] item` in an agent's reply, made interactive.
 *
 * GFM renders a task item as a disabled checkbox — a picture of a checklist. Here, inside an
 * agent's message, each box toggles and the mark is STORED on the message (`taskStates`), so it
 * is the same in every window and after a reload. Outside a message (a plugin's markdown, a file
 * preview) there is nothing to store it on, and the box stays the picture it was.
 *
 * A box is keyed by WHERE it is in its text — the text item's id and the item's source offset —
 * which a settled reply never changes, so a tick cannot land on a different line.
 */
export interface TaskListScope {
  messageId: string
  /** The text item this markdown is (a message can carry several); `content` for flat text. */
  scope: string
  states: Readonly<Record<string, boolean>> | undefined
}

const TaskListContext = createContext<TaskListScope | null>(null)

/** Makes the checklists in `children` tickable, stored on this message under this scope. */
export function TaskScope({
  messageId,
  scope,
  states,
  children,
}: TaskListScope & { children: ReactNode }) {
  const value = useMemo(() => ({ messageId, scope, states }), [messageId, scope, states])
  return <TaskListContext.Provider value={value}>{children}</TaskListContext.Provider>
}

/**
 * Markdown whose SOURCE is its store — a board's text element. There no message holds the
 * marks, so a box was a disabled picture even though the text it came from is editable; here a
 * tick rewrites that item's `[ ]` / `[x]` and hands the new text back, the edit a person would
 * otherwise make by hand.
 */
const SourceTaskContext = createContext<((offset: number, checked: boolean) => void) | null>(null)

/** An item's box, at the item's source offset: the bullet, then `[ ]`/`[x]`. */
const TASK_BOX_AT = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)[ xX](\])/

/** The source with the task item at `offset` ticked or cleared; null when no box is there. */
export function toggleTaskInSource(source: string, offset: number, checked: boolean) {
  const match = TASK_BOX_AT.exec(source.slice(offset))
  if (!match) return null
  const box = offset + match[1]!.length
  return `${source.slice(0, box)}${checked ? 'x' : ' '}${source.slice(box + 1)}`
}

export function SourceTasks({
  source,
  onSourceChange,
  children,
}: {
  source: string
  onSourceChange: (source: string) => void
  children: ReactNode
}) {
  const toggle = useCallback(
    (offset: number, checked: boolean) => {
      const next = toggleTaskInSource(source, offset, checked)
      if (next !== null) onSourceChange(next)
    },
    [source, onSourceChange],
  )
  return <SourceTaskContext.Provider value={toggle}>{children}</SourceTaskContext.Provider>
}

type MarkdownInputProps = ComponentPropsWithoutRef<'input'> & {
  node?: unknown
  /** The item's source offset, set by `rehypeTaskKeys` (the box itself has no position). */
  'data-task-key'?: number | string
}

export function MarkdownInput({
  node: _node,
  'data-task-key': taskKey,
  ...props
}: MarkdownInputProps) {
  const tasks = useContext(TaskListContext)
  const editSource = useContext(SourceTaskContext)
  const sessionId = useWorkItemSessionId()
  const key = tasks && taskKey !== undefined ? `${tasks.scope}:${taskKey}` : null
  const stored = key ? tasks?.states?.[key] : undefined
  // Painted at once, then the stored row (arriving on the stream) takes over: a tick that waits
  // a round-trip to show feels broken, and the row is the truth the moment it lands.
  // The tick is remembered with the stored row it was made against, so a new stored row ends it.
  const [held, setPending] = useState<{ against: boolean | undefined; value: boolean } | null>(null)
  const pending = held && held.against === stored ? held.value : null
  if (props.type !== 'checkbox') return <input {...props} />
  if (!tasks && editSource && taskKey !== undefined) {
    // The source is the state: the new text re-renders this box, so nothing is held here.
    const marked = Boolean(props.checked)
    return (
      <Checkbox
        checked={marked}
        onChange={() => editSource(Number(taskKey), !marked)}
        aria-label={marked ? 'Mark as not done' : 'Mark as done'}
        className="lx-task-box nodrag"
      />
    )
  }
  const checked = pending ?? stored ?? Boolean(props.checked)
  if (!tasks || !key || !sessionId)
    return <Checkbox checked={checked} disabled readOnly className="lx-task-box nodrag" />
  const toggle = () => {
    const next = !checked
    setPending({ against: stored, value: next })
    void backendClient.checkMessageTask(sessionId, tasks.messageId, key, next).catch(() => {
      setPending(null)
      toast.error('Could not save the checkmark')
    })
  }
  return (
    <Checkbox
      checked={checked}
      onChange={toggle}
      aria-label={checked ? 'Mark as not done' : 'Mark as done'}
      className="lx-task-box nodrag"
    />
  )
}
