import type { ComponentProps } from 'react'

import { AddParticipantMenu } from './AddParticipantMenu'
import { ComposerHeaderStrips } from './ComposerHeaderStrips'
import { SessionConversationModeChip } from './SessionConversationModeChip'
import type { usePromptSessionView } from './usePromptSessionView'

type HeaderStripsProps = ComponentProps<typeof ComposerHeaderStrips>

type ComposerSessionStripsProps = Omit<
  HeaderStripsProps,
  'conversationFloor' | 'addParticipantControl' | 'onRemoveParticipant' | 'modeControl'
> & {
  sessionView: ReturnType<typeof usePromptSessionView>
}

/** The composer's header strips, wired to the session's roster and its editing controls. */
export function ComposerSessionStrips({ sessionView, ...strips }: ComposerSessionStripsProps) {
  const editing = sessionView.participantsEditing
  return (
    <ComposerHeaderStrips
      {...strips}
      conversationFloor={sessionView.conversationFloor}
      modeControl={<SessionConversationModeChip sessionId={strips.activeSessionId ?? null} />}
      addParticipantControl={
        <AddParticipantMenu
          seatedAgentIds={sessionView.participants.map((participant) => participant.agentId)}
          projectId={sessionView.activeProjectId ?? ''}
          onAdd={editing.addParticipant}
        />
      }
      onRemoveParticipant={editing.removeParticipant}
    />
  )
}
