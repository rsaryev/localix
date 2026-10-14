/**
 * WHERE a form says what is wrong: next to the control, not in a line at the bottom.
 *
 * Every form here used to answer a failed submit the same way — one sentence pinned above
 * the footer, naming fields ("Name and system prompt are required.") that the reader then
 * had to go find, in a drawer tall enough that the field in question was usually scrolled
 * out of view. The message was furthest from the thing it was about, and a form with two
 * problems reported one of them.
 *
 * The primitive for the other arrangement already existed and nothing used it: `Field` takes
 * an `error`, renders it under its own control, and wires `aria-invalid` +
 * `aria-describedby` so a screen reader reaches the message from the input. What was missing
 * was the shape a validator answers in — one message per field rather than one per form —
 * and the one behaviour a summary gives for free: taking the reader to the first problem.
 *
 * So: validators return `FieldErrors`, in FORM ORDER, and the submit focuses the first one.
 * The pinned row survives for what it is actually for — a failure of the whole operation,
 * like a refused write — which belongs beside the button that caused it.
 */

/** One message per field, keyed by the draft's own field names. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>

export const hasFieldErrors = <K extends string>(errors: FieldErrors<K>): boolean =>
  Object.values(errors).some(Boolean)

/**
 * Move focus to the first field that failed, so a long form does not leave the reader
 * hunting for the message it just printed.
 *
 * "First" is the order the VALIDATOR reported, which is the order the fields appear — an
 * object's own insertion order, which is why validators here are written top-down. Focus
 * rather than scroll alone: keyboard users get the caret where the correction happens, and
 * the browser scrolls it into view as part of focusing.
 */
export function focusFirstInvalid<K extends string>(
  errors: FieldErrors<K>,
  /** The DOM id of each field's control — the same value its `Field` was given. */
  controlIds: Partial<Record<K, string>>,
  doc: Pick<Document, 'getElementById'> = document,
): boolean {
  for (const [field, message] of Object.entries(errors) as Array<[K, string | undefined]>) {
    if (!message) continue
    const id = controlIds[field]
    const element = id ? doc.getElementById(id) : null
    if (element && 'focus' in element && typeof element.focus === 'function') {
      element.focus()
      return true
    }
  }
  return false
}
