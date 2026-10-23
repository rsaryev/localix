import { useState } from 'react'
import { BookmarkPlus, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { formatBytes } from '../../shared/system'
import { SYSTEM_MARK_NOTE_MAX, systemMarksSchema, type SystemMark } from '../../shared/system-marks'
import { ProblemLine } from '@localixai/plugin-sdk/ui/components'
import { useStoreSnapshot } from '../useStoreSnapshot'
import { useSystemProblem } from './useSystemProblem'

const MARKS_PATH = '/rpc/template/marks'

/**
 * Marks: note what just happened and keep the machine's numbers from that moment.
 *
 * The list is the route's, and every change goes through `send`, whose answer IS the new list: the
 * view holds no second copy of the state to reconcile, so a click shows its result at once and a
 * poll can never put the old list back. What the view did not do — a mark the agent made with its
 * tool — arrives as the store feed's nudge (`useStoreSnapshot`); the poll is only its backstop.
 */
export function SystemMarks({ active }: { active: boolean }) {
  const marks = useStoreSnapshot({
    plugin: 'template',
    sessionId: null,
    path: MARKS_PATH,
    schema: systemMarksSchema,
    intervalMs: 10_000,
    active,
    failureMessage: 'Cannot read marks right now.',
  })
  const problem = useSystemProblem({
    subject: 'Marks',
    failure: marks.error,
    consequence: marks.snapshot ? 'stale' : 'blocked',
  })
  const [note, setNote] = useState('')
  const add = async () => {
    if (await marks.send({ note })) setNote('')
  }
  const newestFirst = [...(marks.snapshot?.marks ?? [])].reverse()
  return (
    <section
      aria-labelledby="marks-title"
      className="overflow-hidden rounded-lg border border-border"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id="marks-title" className="text-sm font-medium">
          Marks
        </h2>
        <p className="mt-0.5 text-xs text-text-faint">
          A note, saved with the CPU and memory of the moment you took it.
        </p>
      </div>
      <form
        className="flex gap-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <Input
          aria-label="Mark note"
          placeholder="What is happening now?"
          value={note}
          maxLength={SYSTEM_MARK_NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={marks.sending || !note.trim()}>
          <BookmarkPlus data-icon="inline-start" />
          Mark
        </Button>
      </form>
      {problem && <ProblemLine {...problem} className="px-4 pb-3" />}
      {/* "No marks yet" only once the list has been read: before the first poll, or after a
          failed one, it claimed there were none while the real list was simply unknown. */}
      {!marks.snapshot ? null : newestFirst.length === 0 ? (
        <EmptyHint className="border-t border-border px-4 py-6">
          No marks yet. Add one before something you want to compare.
        </EmptyHint>
      ) : (
        <ul className="divide-y divide-border-faint border-t border-border">
          {newestFirst.map((mark) => (
            <MarkRow
              key={mark.id}
              mark={mark}
              disabled={marks.sending}
              onRemove={() =>
                void marks.send(undefined, { path: `${MARKS_PATH}/${mark.id}`, method: 'DELETE' })
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function MarkRow({
  mark,
  disabled,
  onRemove,
}: {
  mark: SystemMark
  disabled: boolean
  onRemove: () => void
}) {
  const at = new Date(mark.at)
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-xs">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{mark.note}</p>
        <p className="mt-0.5 text-text-faint tabular-nums">
          {at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · CPU{' '}
          {mark.cpuPercent === null ? '—' : `${mark.cpuPercent.toFixed(1)}%`} · memory{' '}
          {formatBytes(mark.memoryUsedBytes)}
        </p>
      </div>
      <IconButton
        aria-label={`Delete mark "${mark.note}"`}
        tooltip="Delete mark"
        size="sm"
        tone="danger"
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 />
      </IconButton>
    </li>
  )
}
