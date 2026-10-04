/**
 * WHETHER ANYONE MAY JOIN THIS CONVERSATION — the person's choice, made before it starts.
 *
 * Fixing the participants closes every door at once: the add menu here, an agent's
 * `conversation_control` invitation, a plugin assigning work to someone who is not in the room.
 * The server owns that refusal (`changeParticipants`); this is the control for it.
 *
 * AN ICON BUTTON, NOT A SWITCH. The roster row is a row of icon buttons (add, remove); a switch
 * was a second control vocabulary in it, needed a word beside it to mean anything, and still
 * read as a setting of the whole composer. A lock in the same geometry as the add button says
 * what it decides by its shape: open padlock, anyone may join; closed, nobody.
 *
 * Open to change only before the first message (`@localixai/api/roster-lock`): an agent told
 * mid-conversation it may no longer invite would be reading a history in which it did. After
 * that an open conversation shows nothing extra, and a fixed one keeps the closed lock —
 * disabled, still explaining itself — so the grey participants say why they are grey.
 */
import { Lock, LockOpen } from 'lucide-react'

import { IconButton } from '@localixai/kit/icon-button'

export interface RosterLockButtonProps {
  locked: boolean
  /** The conversation has started: the choice is shown, not offered. */
  settled: boolean
  onChange: (locked: boolean) => void
}

export function RosterLockButton({ locked, settled, onChange }: RosterLockButtonProps) {
  if (settled && !locked) return null
  if (settled) {
    return (
      <IconButton
        size="xs"
        disabled
        aria-label="Participants fixed for this conversation"
        tooltip="Participants are fixed for this conversation"
      >
        <Lock className="size-3" />
      </IconButton>
    )
  }
  return (
    <IconButton
      size="xs"
      aria-pressed={locked}
      aria-label="Fix the participants"
      tooltip={
        locked
          ? 'Participants fixed: nobody can be added or removed, by you or an agent. Click to open. Decide before the first message.'
          : 'Anyone can join: you and the agents can add participants. Click to fix them. Decide before the first message.'
      }
      onClick={() => onChange(!locked)}
    >
      {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
    </IconButton>
  )
}
