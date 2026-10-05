import type { ReactNode } from 'react'
import { SettingsPageHeader } from './SettingsScaffold'
import { RecordEditorDecisions, RecordEditorStatus } from './SettingsRecordChrome'

interface SettingsRecordPageProps {
  /**
   * What is being edited — "New agent", "Edit Code Reviewer".
   *
   * Absent when the HOST already says it: an agent's profile draws one heading above its own
   * sub-tabs, so the form under them must not repeat the name it is already standing beneath.
   */
  title?: string
  /** Where the record lives, where it came from: one line, never a second description. */
  description?: string
  /** A save is in flight: the decision row locks and says so. */
  busy?: boolean
  /** What the submit button says while saving ("Saving agent"). */
  busyLabel: string
  submitLabel: ReactNode
  cancelLabel?: string
  /** This EDIT's failure — a rejected field, a refused write. Never the list's load error. */
  error?: string | null
  /** What just happened to the FORM without anything being written yet. */
  notice?: string | null
  /** Nothing to save: the form matches what it opened with. Kept enabled during a save. */
  submitDisabled?: boolean
  /** Verbs that act on the whole record (duplicate, delete), kept off the decision pair. */
  aside?: ReactNode
  /** One verb that acts on THIS FORM rather than on the record (restore the defaults). */
  extraAction?: ReactNode
  onSubmit: () => void
  onCancel: () => void
  children: ReactNode
}

/**
 * A record edited as a PAGE, in a tab of its own — the shape a long record needs.
 *
 * The drawer is right for a record that fits on one sheet, and wrong for one that does not:
 * an agent carries its identity, its model, its instructions, what it may use and how far it
 * may go, so the sheet grew until it covered the screen it was supposed to float over, and
 * the list it was opened from was unreachable without throwing the edit away. A tab answers
 * both: the edit is a place you can leave and come back to, and the rows stay one click away.
 *
 * It is pane content, not a portal — the settings panel's own scroll container scrolls it, so
 * the decision row is `sticky` rather than pinned to a viewport it does not own. That keeps
 * Save reachable from anywhere in a long form without the page owning a scrollport of its own.
 */
export function SettingsRecordPage({
  title,
  description,
  busy = false,
  busyLabel,
  submitLabel,
  cancelLabel = 'Cancel',
  error,
  notice,
  submitDisabled = false,
  aside,
  extraAction,
  onSubmit,
  onCancel,
  children,
}: SettingsRecordPageProps) {
  return (
    <div aria-busy={busy || undefined} className="flex flex-col gap-6">
      {title !== undefined && (
        <SettingsPageHeader
          title={title}
          {...(description === undefined ? {} : { description })}
          {...(aside === undefined ? {} : { actions: aside })}
          className="border-b border-border-faint pb-4"
        />
      )}

      {/* A container of its own, so the paired fields inside answer to the WIDTH THEY HAVE.
          Their `@md:` / `@max-md:` rules were written against the settings pane; the pane is
          still the ancestor here, and naming the container again costs nothing and makes the
          form's reflow independent of how deep it happens to sit. */}
      <div className="@container min-w-0 space-y-8">{children}</div>

      <div className="sticky bottom-0 flex min-w-0 flex-col gap-2 border-t border-border-faint bg-background py-3">
        <RecordEditorStatus error={error} notice={notice} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <RecordEditorDecisions
            busy={busy}
            busyLabel={busyLabel}
            submitLabel={submitLabel}
            cancelLabel={cancelLabel}
            submitDisabled={submitDisabled}
            extraAction={extraAction}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  )
}
