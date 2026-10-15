import type { ComponentProps } from 'react'

import { AddParticipantMenu } from './AddParticipantMenu'
import { ComposerHeaderStrips } from './ComposerHeaderStrips'
import { RosterLockButton } from './RosterLockButton'
import type { usePromptSessionView } from './usePromptSessionView'

type HeaderStripsProps = ComponentProps<typeof ComposerHeaderStrips>

type ComposerSessionStripsProps = Omit<
  HeaderStripsProps,
  | 'participantUsage'
  | 'conversationFloor'
  | 'addParticipantControl'
  | 'onRemoveParticipant'
  | 'participantsLocked'
  | 'participantsLockControl'
> & {
  sessionView: ReturnType<typeof usePromptSessionView>
}

/** The composer's header strips, wired to the session's roster and its editing controls. */
export function ComposerSessionStrips({ sessionView, ...strips }: ComposerSessionStripsProps) {
  const editing = sessionView.participantsEditing
  return (
    <ComposerHeaderStrips
      {...strips}
      participantUsage={sessionView.participantUsage}
      conversationFloor={sessionView.conversationFloor}
      addParticipantControl={
        <AddParticipantMenu
          seatedAgentIds={sessionView.participants.map((participant) => participant.agentId)}
          projectId={sessionView.activeProjectId ?? ''}
          onAdd={editing.addParticipant}
        />
      }
      onRemoveParticipant={editing.removeParticipant}
      participantsLocked={sessionView.rosterLocked}
      participantsLockControl={
        <RosterLockButton
          locked={sessionView.rosterLocked}
          settled={sessionView.rosterLockSettled}
          onChange={editing.setRosterLocked}
        />
      }
    />
  )
}
