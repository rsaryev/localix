import { MonogramAvatar, monogramInkStyle } from '@localixai/kit/avatar'
import { agentProfileUri, type AgentIdentity } from '@/shared/contrib/useAgentIdentity'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { navigateUi } from '@/shared/lib/uiNavigation'

const AVATAR_SIZE = 26

/**
 * The indent that puts the reply under the name rather than under the tile — the tile's
 * width plus the line's own gap. Exported so the two cannot drift: a body that does not
 * match reads as a hanging indent nobody chose.
 */
export const AUTHOR_BODY_INDENT = 'pl-[2.125rem]'

/**
 * Who is speaking, above their reply: tile, name, time. It gives the wall clock a home the footer
 * never had.
 *
 * The name carries the agent's own hue, the same one its tile is built from. That pairing is
 * what lets a reader find one speaker while scrolling past everyone else.
 *
 * Tile and name together are one button to the agent's PROFILE — the tab a mention chip and the
 * registry row open too. It goes through the canonical URI rather than reaching for the grid
 * directly, so this click, a global-search hit and an agent's own `ui.navigate` all land the
 * same way — and the URI carries the record's SCOPE, because a project agent is simply absent
 * from the global registry.
 */
export function MessageAuthorLine({
  author,
  clock,
  triggerLabel,
}: {
  author: AgentIdentity
  clock: string
  triggerLabel?: string
}) {
  const navigation = useUiNavigation({ sessionId: useWorkItemSessionId() })
  return (
    <div className="mb-1.5 flex w-full min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => navigateUi(agentProfileUri(author), navigation)}
        title={`Open ${author.name}’s profile`}
        className="group/author focus-ring flex min-w-0 items-center gap-2 rounded-md transition-opacity hover:opacity-90"
      >
        <MonogramAvatar identity={author.name} label={author.name} size={AVATAR_SIZE} />
        <span
          className="min-w-0 truncate text-xs font-semibold group-hover/author:underline"
          style={monogramInkStyle(author.name)}
        >
          {author.name}
        </span>
      </button>
      {clock && <span className="shrink-0 text-2xs tabular-nums text-text-faint">{clock}</span>}
      {triggerLabel && <span className="text-2xs text-text-faint">via {triggerLabel}</span>}
    </div>
  )
}
