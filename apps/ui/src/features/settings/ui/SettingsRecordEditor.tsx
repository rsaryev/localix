import type { ReactNode } from 'react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@localixai/kit/drawer'
import { RecordEditorDecisions, RecordEditorStatus } from './SettingsRecordChrome'

interface SettingsRecordEditorProps {
  /** What is being edited — "New agent", "Edit Code Reviewer". */
  title: string
  /** Where the record lives, where it came from: one line, never a second description. */
  description?: ReactNode
  /** A save is in flight: the decision row locks and says so. */
  busy?: boolean
  /** What the submit button says while saving ("Saving agent"). */
  busyLabel: string
  submitLabel: ReactNode
  cancelLabel?: string
  /** This EDIT's failure — a rejected field, a refused write. Never the list's load error. */
  error?: string | null
  /**
   * What just happened to the FORM without anything being written yet — "defaults filled in".
   * It shares the error's pinned row, because it answers the same question from the same
   * click: is there anything to save now?
   */
  notice?: string | null
  /** Nothing to save: the form matches what it opened with. Kept enabled during a save. */
  submitDisabled?: boolean
  /** Verbs that act on the whole record (duplicate, delete), kept off the decision pair. */
  aside?: ReactNode
  /**
   * One verb that acts on THIS FORM rather than on the record (restore the defaults into the
   * fields). It sits with Cancel and Save because that is where the decisions about this edit
   * are, and it is expected to be absent whenever it would do nothing.
   */
  extraAction?: ReactNode
  onSubmit: () => void
  onCancel: () => void
  children: ReactNode
}

/**
 * A SHORT settings record — a skill, an MCP server, an install source — edited in the app's
 * bottom drawer, the same shell the model picker opens in. A record with more to say than
 * one sheet holds (an agent) gets `SettingsRecordPage` and a tab of its own instead.
 *
 * Every registry used to open its editor INLINE, above the list: the rows it was about
 * jumped down the page, the action that opened it vanished, the list's own empty state had
 * to be suppressed while it was up, and a long form left the save button somewhere below
 * the fold. A record editor is a modal interaction — it has a decision at the end and the
 * list behind it must not move.
 *
 * WHY A DRAWER AND NOT A CENTERED DIALOG. A centered dialog is sized by a text measure and
 * grows from the middle of the screen: an agent's form is long enough that it floated at the
 * top of the window, narrow, with the paired fields squeezed into a column. The drawer is
 * anchored to the edge the pointer is already near, carries the app's one wide measure
 * (`DrawerContent`'s `md:max-w-205`), and grows downward instead of away from the cursor.
 *
 * The status row and the decision pair are `SettingsRecordChrome`'s, shared with the page
 * shell an agent opens in: what this file still owns is the drawer, and nothing else.
 */
export function SettingsRecordEditor({
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
}: SettingsRecordEditorProps) {
  return (
    <Drawer
      open
      onOpenChange={(next) => {
        // Escape, the scrim and the drag handle all close it; a save in flight owns the
        // surface until it settles.
        if (!next && !busy) onCancel()
      }}
    >
      {/* Wider and shorter than the drawer's own defaults, for the same reason the model
          picker overrides its width: an editor is a WORKING surface, not a confirmation.
          `md:` on the measure is mandatory — `DrawerContent` caps itself at `md:max-w-205`
          and an unprefixed override loses at md and up (see `drawerWidth.structure.test`).
          The height cap keeps the sheet a sheet: the agent form is long enough to reach the
          top of the window otherwise, which is a full-screen takeover with a drag handle. */}
      <DrawerContent
        aria-busy={busy || undefined}
        className="max-h-[78dvh] md:max-w-[min(1100px,96vw)]"
      >
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          {description && <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>

        {/* A container, so the paired fields inside keep answering to the WIDTH THEY HAVE.
            Their `@md:` / `@max-md:` rules were written against the settings pane, and a
            portalled drawer leaves that ancestor behind — without a container here a
            container query simply never matches, and a two-column row stays two columns
            however narrow the viewport clamps the sheet. */}
        <DrawerBody className="@container space-y-4">{children}</DrawerBody>

        <RecordEditorStatus
          error={error}
          notice={notice}
          className="border-t border-border-soft px-4 py-2"
        />

        <DrawerFooter aside={aside}>
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
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
