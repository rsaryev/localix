import { ChevronRight, Plus } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { MonogramAvatar } from '@localixai/kit/avatar'
import {
  agentProfileUri,
  humanizeHandle,
  useAgentHandleIdentity,
} from '@/shared/contrib/useAgentIdentity'
import { pluginContribSnapshot } from '@/shared/contrib/enabledPlugins'
import { usePluginContribVersion } from '@/shared/contrib/usePluginContribVersion'
import { AvatarStack } from '@localixai/kit/avatar'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { groupParticipants, isConversationGroup } from '../model/sessionGroups'

/**
 * One agent's heading in the chat list, with its own "new chat".
 *
 * The tile belongs HERE, unlike on a chat row. On a row it was decoration — a colour standing
 * in for a title already written next to it, repeated down a column of chats with the same
 * agent. Here it appears once and identifies the one thing the row is about, and it is the
 * same tile that agent wears in the transcript and in Settings.
 *
 * The button is here rather than in a picker on the global one because this is where the
 * answer already is: the list shows who you talk to, so "another one with them" is a click on
 * the row that says their name. The global button stays a straight line to the default
 * agent — the common case must not grow a question.
 *
 * The heading does not indent its chats. A sidebar is narrow, and the tree already spends its
 * indent on a chat's own forks and threads; a group is a caption over the same left edge.
 */
export function AgentGroupHeader({
  handle,
  count,
  expanded,
  onToggle,
  onNewChat,
}: {
  handle: string
  count: number
  expanded: boolean
  onToggle: () => void
  onNewChat?: () => void
}) {
  // A conversation heading stands for a SET of agents. It has no single record to open and no
  // single monogram, so it draws the participants' tiles stacked and names them in order; a
  // one-to-one keeps the single identity it always had.
  const participants = groupParticipants(handle)
  const isConversation = isConversationGroup(handle)
  const identity = useAgentHandleIdentity(isConversation ? '' : handle)
  usePluginContribVersion()
  const agents = pluginContribSnapshot().document?.agents ?? []
  const participantNames = participants.map(
    (participant) =>
      agents.find((agent) => agent.record.handle === participant)?.record.label?.trim() ||
      humanizeHandle(participant),
  )
  const name = isConversation ? participantNames.join(', ') : (identity?.name ?? handle)
  // A sidebar heading belongs to no chat; what it opens (an agent's profile) is app-level.
  const navigation = useUiNavigation({ sessionId: null })

  return (
    <div className="group/agent mt-3 flex h-8 items-center gap-1 pr-1 first:mt-0">
      {/* The tile is a link to the agent's profile, exactly as it is in a transcript's
          author line — one identity, one gesture, wherever it appears. It sits OUTSIDE the
          toggle rather than inside it: a click has to mean one thing, and nesting a link in a
          disclosure means the same pixel does two. */}
      {isConversation ? (
        <AvatarStack identities={participants} labels={participantNames} size={22} max={3} />
      ) : (
        <button
          type="button"
          onClick={() => navigateUi(agentProfileUri(identity), navigation)}
          title={`Open ${name}’s profile`}
          className="focus-ring shrink-0 rounded-md transition-opacity hover:opacity-80"
        >
          <MonogramAvatar identity={handle} label={name} size={22} />
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        // The heading has to outweigh what hangs under it. It read as a caption before —
        // lighter and smaller than the chat rows it owned — so the hierarchy looked inverted.
        className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md text-sm font-semibold text-sidebar-foreground transition-colors hover:text-sidebar-foreground"
      >
        <ChevronRight
          className={`size-3 shrink-0 text-sidebar-foreground/40 transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{name}</span>
        {/* Kept while collapsed, where it is the only thing saying how much is behind the
            heading. Hidden at zero: "0" is louder than the empty line below already is. */}
        {count > 0 && (
          <span className="shrink-0 text-2xs text-sidebar-foreground/35 tabular-nums">{count}</span>
        )}
      </button>
      {onNewChat ? (
        <IconButton
          size="sm"
          surface="sidebar"
          onClick={onNewChat}
          aria-label={`New chat with ${name}`}
          tooltip={`New chat with ${name}`}
          className="opacity-0 transition-opacity group-hover/agent:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
        >
          <Plus className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  )
}
