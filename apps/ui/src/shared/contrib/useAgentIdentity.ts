import { useMemo, useSyncExternalStore } from 'react'
import { authorAgentId } from '@localixai/api/author'
import { localixUiUri } from '@localixai/mini-app-sdk/navigation'
import { miniAppContribSnapshot, subscribeMiniAppContrib } from './enabledMiniApps'

export interface AgentIdentity {
  agentId?: string
  /** The agent's Claude Code `name`: what to call it on screen, and what the avatar's colour comes from. */
  name: string
  /**
   * The scope its record lives in: `''` is the global registry, otherwise a project id.
   *
   * Carried because a link into Settings must open the scope the record is IN — the
   * agents list is per scope, and a project agent is simply absent from the global one.
   * `''` when the document does not carry the record, which is also the right guess.
   */
  scope: string
}

/**
 * The agent's PROFILE — one destination, wherever the agent is named.
 *
 * A mention in a message, the author line of a reply, the heading of its chats and its row in
 * the registry all mean the same thing by a click on an agent: show me this one. They used to
 * point into Settings and reveal a row, which answered a different question — it landed on the
 * list the record happens to live in, scrolled to it, and left the reader to open it. The
 * profile is a tab of its own, so the same click reaches the same page from all four, and the
 * page is somewhere you can stay.
 */
export function agentProfileUri(identity: AgentIdentity): string {
  return localixUiUri('work-item', ['store'], {
    kind: 'agent',
    id: identity.agentId ?? identity.name,
  })
}

/**
 * The stable AgentId behind a message's `from`, or null for the human and application.
 *
 * Thin on purpose: the `agent:` prefix grammar is owned by the storage vocabulary
 * (`db/author.ts`), reached here through its own package export rather than the server
 * bundle. A second copy of the prefix rule is how the two ends drift.
 */
export function agentAuthorId(from: string | undefined): string | null {
  return from ? authorAgentId(from) : null
}

/**
 * Who authored a message, resolved against the workbench's own capability document.
 *
 * Reading the CONTRIBUTION store rather than fetching is the point: that document is the
 * active scope's, already loaded, and shared by every capability surface — so a transcript
 * of two hundred rows costs no requests and cannot disagree with the settings list about
 * what an agent is called. An agent deleted since falls back to its id; a same-named replacement
 * cannot become the author of an earlier message.
 */
export function useAgentIdentity(from: string | undefined): AgentIdentity | null {
  // The snapshot is replaced wholesale on a publish, so a rename reaches this read.
  const contrib = useSyncExternalStore(
    subscribeMiniAppContrib,
    miniAppContribSnapshot,
    miniAppContribSnapshot,
  )
  return useMemo(() => {
    const agentId = agentAuthorId(from)
    if (!agentId) return null
    return resolveAuthorIdentity(agentId, contrib.document?.agents ?? [])
  }, [from, contrib])
}

type AgentEntry = { record: { id: string; name: string }; projectId: string }

export function resolveAuthorIdentity(
  agentId: string,
  agents: readonly AgentEntry[],
): AgentIdentity {
  const found = agents.find((agent) => agent.record.id === agentId)
  return {
    agentId,
    name: found?.record.name ?? agentId,
    scope: found?.projectId ?? '',
  }
}
