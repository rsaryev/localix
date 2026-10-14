// Clickable agent mention inside message markdown. The same gesture as the author line's
// avatar: one identity, one destination — the agent's own profile tab — wherever it appears.
// Rendered inline at text size so a mention reads as part of the sentence.
import { MENTION_CHIP } from './mention-chip'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { agentProfileUri, useAgentHandleIdentity } from '@/shared/contrib/useAgentIdentity'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { navigateUi } from '@/shared/lib/uiNavigation'

export function AgentMentionChip({ handle }: { handle: string }) {
  const identity = useAgentHandleIdentity(handle)
  // The profile tab is app-level, but the navigation still acts for the chat that shows the chip.
  const sessionId = useWorkItemSessionId()
  const navigation = useUiNavigation({ sessionId })
  return (
    <button
      type="button"
      title={`Open ${identity.name}’s profile`}
      onClick={() => navigateUi(agentProfileUri(identity), navigation)}
      className={MENTION_CHIP.link}
    >
      <MonogramAvatar identity={handle} label={identity.name} size={14} />
      <span className="truncate">@{handle}</span>
    </button>
  )
}
