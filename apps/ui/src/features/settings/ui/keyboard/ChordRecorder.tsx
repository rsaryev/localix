import { useEffect, useState } from 'react'
import { TriangleAlert, RotateCcw, X } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { chordFromEvent, type Chord } from '@/shared/lib/keybindings'
import { KeyChip } from './KeyChip'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'

interface ChordRecorderProps {
  chord: Chord
  /** Whether this binding differs from the catalog default (enables Reset). */
  overridden: boolean
  /**
   * Labels of the other same-category commands a candidate chord would collide
   * with ("already in use" awareness). Returning a non-empty list makes
   * the recorder pause on a confirm step instead of committing silently, so a
   * clash never shadows another binding without an informed choice.
   */
  conflictsFor: (chord: Chord) => string[]
  onRecord: (chord: Chord) => void
  onUnassign: () => void
  onReset: () => void
}

/** A captured chord awaiting the user's confirm because it clashes. */
interface PendingClash {
  chord: Chord
  owners: string[]
}

/**
 * Inline chord editor for one command: shows the current binding as keycaps and,
 * when clicked, captures the next key combination. Escape cancels recording;
 * the × unassigns the command; the reset arrow restores the catalog default
 * (shown only when overridden). Capture-phase listener + preventDefault so the
 * recorded combo never triggers its own app action while binding. When a
 * captured chord already belongs to another command in the same category the
 * recorder pauses on a confirm step that NAMES the owner —
 * Assign anyway commits, Cancel discards — so a silent shadow is impossible.
 */
export function ChordRecorder({
  chord,
  overridden,
  conflictsFor,
  onRecord,
  onUnassign,
  onReset,
}: ChordRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState<PendingClash | null>(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false) // plain Escape cancels recording
        return
      }
      const next = chordFromEvent(e)
      if (!next) return // bare modifier held — keep waiting for the main key
      setRecording(false)
      const owners = conflictsFor(next)
      if (owners.length > 0) {
        setPending({ chord: next, owners }) // clash — ask before committing
      } else {
        onRecord(next)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, conflictsFor, onRecord])

  if (pending) {
    const owners = pending.owners.join(', ')
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <span
          className="inline-flex items-center gap-1 text-2xs text-status-warning"
          title={`Already bound to ${owners} in this section`}
        >
          <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
          <span className="max-w-40 truncate">In use by {owners}</span>
        </span>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            onRecord(pending.chord)
            setPending(null)
          }}
          className="text-2xs text-text-soft"
        >
          Assign anyway
        </Button>
        <IconButton
          size="lg"
          onClick={() => setPending(null)}
          tooltip="Keep current shortcut"
          aria-label="Cancel rebind"
        >
          <X className="size-3.5" />
        </IconButton>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        variant="outline"
        size="lg"
        onClick={() => setRecording((v) => !v)}
        className={cn(
          'min-w-28',
          recording
            ? // `--control-border-focus`, not `--ring`: "recording" is an armed control, so it
              // borrows the focus edge rather than the near-white monochrome ring the app retired.
              'border-control-border-focus bg-foreground/[0.06] text-foreground'
            : // `transparent` needs no dark: fork — it is the one fill with nothing to re-tune.
              'border-border-soft bg-transparent hover:border-border',
        )}
        aria-pressed={recording}
        aria-label={recording ? 'Press a key combination' : 'Change shortcut'}
      >
        {recording ? (
          <span role="status" className="animate-pulse-soft text-2xs text-text-soft">
            Press keys…
          </span>
        ) : (
          <KeyChip chord={chord} />
        )}
      </Button>
      {!recording && chord && (
        <IconButton
          size="lg"
          onClick={onUnassign}
          tooltip="Unassign"
          aria-label="Unassign shortcut"
        >
          <X className="size-3.5" />
        </IconButton>
      )}
      {!recording && overridden && (
        <IconButton
          size="lg"
          onClick={onReset}
          tooltip="Reset to default"
          aria-label="Reset shortcut to default"
        >
          <RotateCcw className="size-3.5" />
        </IconButton>
      )}
    </div>
  )
}
