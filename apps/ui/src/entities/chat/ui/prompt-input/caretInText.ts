/**
 * The caret offset PAIRED with the text it was measured in. A programmatic setPrompt (accepting
 * a suggestion, inserting a tip) moves the DOM caret to the end without firing a caret event, so
 * an offset is only trusted while its text still matches the live prompt — otherwise the caret
 * is at the end.
 */
export interface CaretInText {
  offset: number
  text: string
}

/**
 * State reducer for the caret report, and a LATENCY fix as much as a correctness
 * one: the textarea reports the caret from five separate events
 * (change/select/click/keyUp/focus), several of which fire for a single
 * keystroke. Returning a fresh `{offset, text}` each time made React's
 * bail-out impossible, so one keypress cost two full composer renders — the
 * second one identical to the first. Keeping the previous object when neither
 * field moved restores the bail without changing what is reported.
 */
export function nextCaretInText(
  prev: CaretInText | null,
  offset: number,
  text: string,
): CaretInText | null {
  return prev?.offset === offset && prev.text === text ? prev : { offset, text }
}
