/**
 * Pure state machine for composer-based message editing.
 *
 * Clicking "Edit" on a past user message no longer opens an inline textarea in the
 * transcript — instead the message text loads into the MAIN composer with an
 * "Editing" banner above it. This module owns the small reducer that backs that
 * flow: it tracks which message is being edited and stashes the composer draft
 * that was displaced, so cancel/confirm can restore it.
 *
 * The reducer is deliberately UI-agnostic (no React, no store): each transition
 * returns the next {@link EditState} plus the text the composer should display,
 * so the caller applies it to whatever holds the composer value.
 */

/** Identity of the message currently loaded into the composer for editing. */
export interface EditingMessage {
  sessionId: string
  messageId: string
  /** The message's text at the moment editing began — powers the banner preview. */
  originalText: string
}

export interface EditState {
  /** Non-null while a message is loaded into the composer for editing. */
  editing: EditingMessage | null
  /** The composer draft displaced when editing began — restored on cancel/confirm. */
  stashedDraft: string
}

export const initialEditState: EditState = { editing: null, stashedDraft: '' }

export interface EditTransition {
  state: EditState
  /** Text the composer should display after this transition. */
  composerText: string
}

/**
 * Begin editing a message: load its text into the composer and stash the current
 * draft so it can be restored later. If we're ALREADY editing (the user clicked
 * Edit on a different message mid-edit), keep the original stash — the displaced
 * draft is the pre-edit one, not the message text currently in the box.
 */
export function enterEdit(
  state: EditState,
  params: { sessionId: string; messageId: string; originalText: string; currentDraft: string },
): EditTransition {
  const stashedDraft = state.editing ? state.stashedDraft : params.currentDraft
  return {
    state: {
      editing: {
        sessionId: params.sessionId,
        messageId: params.messageId,
        originalText: params.originalText,
      },
      stashedDraft,
    },
    composerText: params.originalText,
  }
}

/** Leave edit mode, restoring the stashed draft into the composer. */
function leaveEdit(state: EditState): EditTransition {
  return { state: initialEditState, composerText: state.stashedDraft }
}

/** Cancel editing (× / Esc): discard the edit, restore the stashed draft. */
export function cancelEdit(state: EditState): EditTransition {
  return leaveEdit(state)
}

/**
 * Confirm editing (submit): the caller performs the actual update-message call;
 * the reducer just clears edit state and restores the stashed draft, mirroring
 * cancel. Kept as its own name so call sites read intent-first.
 */
export function confirmEdit(state: EditState): EditTransition {
  return leaveEdit(state)
}

/**
 * Whether a submitted edit is worth sending: non-empty and actually changed from
 * the original. Empty or unchanged submits are treated as a cancel (an
 * empty edit is never sent).
 */
export function shouldPersistEdit(editing: EditingMessage, text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed !== editing.originalText.trim()
}
