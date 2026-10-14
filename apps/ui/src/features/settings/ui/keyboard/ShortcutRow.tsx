import { AlertTriangle } from 'lucide-react'
import { isConfigurable, type Chord, type ShortcutCommand } from '@/shared/lib/keybindings'
import { KeyChip } from './KeyChip'
import { ChordRecorder } from './ChordRecorder'
import { SettingsRow } from '../SettingsScaffold'

interface ShortcutRowProps {
  command: ShortcutCommand
  chord: Chord
  overridden: boolean
  /** Labels of the OTHER commands this row currently shares its chord with. */
  conflictLabels: string[]
  /** Names of the commands a candidate chord would clash with (record-time warn). */
  conflictsFor: (chord: Chord) => string[]
  onRecord: (chord: Chord) => void
  onUnassign: () => void
  onReset: () => void
}

/**
 * One catalog command: label + description on the left, the binding control on
 * the right. Configurable commands get the inline recorder; reference-only
 * (built-in interaction) keys show a muted, read-only keycap instead.
 */
export function ShortcutRow({
  command,
  chord,
  overridden,
  conflictLabels,
  conflictsFor,
  onRecord,
  onUnassign,
  onReset,
}: ShortcutRowProps) {
  const editable = isConfigurable(command)
  return (
    <SettingsRow layout="responsive">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">{command.label}</span>
          {conflictLabels.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-2xs text-status-warning"
              title={`Same shortcut as ${conflictLabels.join(', ')} in this section`}
            >
              <AlertTriangle className="size-3" />
              Also: {conflictLabels.join(', ')}
            </span>
          )}
        </div>
        <p className="text-xs leading-5 text-text-soft">{command.description}</p>
      </div>
      <div className="shrink-0">
        {editable ? (
          <ChordRecorder
            chord={chord}
            overridden={overridden}
            conflictsFor={conflictsFor}
            onRecord={onRecord}
            onUnassign={onUnassign}
            onReset={onReset}
          />
        ) : (
          <div
            className="flex h-[var(--chrome-control-lg)] min-w-28 items-center justify-center px-2.5"
            title="Built-in — not rebindable"
          >
            <KeyChip chord={chord} muted />
          </div>
        )}
      </div>
    </SettingsRow>
  )
}
