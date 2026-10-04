import type { ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { SettingsActionActivity } from './SettingsActionActivity'

/**
 * The chrome a record editor has whatever SHAPE it is given — the drawer the small registries
 * open in, and the full page an agent opens as its own tab.
 *
 * The two shells differ in exactly one thing: where the form is put. What a failed write says,
 * and what the decision row offers, is the same promise either way — so it is stated here once.
 * A copy per shell is how one of them ends up announcing a failure the other only prints, and
 * how a save in flight locks the buttons on one surface and not on the other.
 */

interface RecordEditorStatusProps {
  /** This EDIT's failure — a rejected field, a refused write. Never the list's load error. */
  error?: string | null
  /**
   * What just happened to the FORM without anything being written yet — "defaults filled in".
   * It shares the error's row, because it answers the same question from the same click: is
   * there anything to save now?
   */
  notice?: string | null
  /** The shell's own gutter: a drawer and a page do not have the same one. */
  className?: string
}

/**
 * The one row a record editor speaks through when a write fails.
 *
 * It is pinned beside the button that caused it rather than placed in the scrolling body: the
 * click that produces it happens at the footer, so that is where it has to be readable.
 */
export function RecordEditorStatus({ error, notice, className }: RecordEditorStatusProps) {
  if (error) {
    return (
      <p role="alert" className={cn('shrink-0 text-xs text-status-error', className)}>
        {error}
      </p>
    )
  }
  if (notice) {
    return (
      <p role="status" className={cn('shrink-0 text-xs text-text-faint', className)}>
        {notice}
      </p>
    )
  }
  return null
}

interface RecordEditorDecisionsProps {
  /** A save is in flight: the row locks and says so. */
  busy: boolean
  /** What the submit says while saving ("Saving agent"). */
  busyLabel: string
  submitLabel: ReactNode
  cancelLabel?: string
  /** Nothing to save: the form matches what it opened with. Kept enabled during a save. */
  submitDisabled?: boolean
  /**
   * One verb that acts on THIS FORM rather than on the record (restore the defaults into the
   * fields). It sits with Cancel and Save because that is where the decisions about this edit
   * are, and it is expected to be absent whenever it would do nothing.
   */
  extraAction?: ReactNode
  onSubmit: () => void
  onCancel: () => void
}

/** Cancel + submit (+ the one form-scoped extra) — the decision pair, in either shell. */
export function RecordEditorDecisions({
  busy,
  busyLabel,
  submitLabel,
  cancelLabel = 'Cancel',
  submitDisabled = false,
  extraAction,
  onSubmit,
  onCancel,
}: RecordEditorDecisionsProps) {
  return (
    <>
      {extraAction}
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        {cancelLabel}
      </Button>
      <Button
        variant="mono"
        className="min-w-32"
        onClick={onSubmit}
        disabled={busy || submitDisabled}
        aria-busy={busy || undefined}
      >
        {/* A live region, so a save that takes a while is ANNOUNCED and not merely spelled on
            a button nobody is focused on. */}
        {busy ? (
          <span role="status" className="inline-flex min-w-0">
            <SettingsActionActivity label={busyLabel} />
          </span>
        ) : (
          submitLabel
        )}
      </Button>
    </>
  )
}
