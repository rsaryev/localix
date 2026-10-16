import { useMemo } from 'react'
import { participantAgentId } from '@localixai/api/participant'
import { localixUiUri } from '@localixai/plugin-sdk/navigation'
import { pluginContribSnapshot } from './enabledPlugins'
import { usePluginContribVersion } from './usePluginContribVersion'

export interface AgentIdentity {
  agentId?: string
  /** The registry handle — the immutable username, and what the avatar's colour comes from. */
  handle: string
  /** What to call it on screen: the registry label, or the handle read as words. */
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
  // `agent`, not `agentId`: a location's parameter names are lowercase by the URI grammar
  // (`UI_LOCATION_PARAM_KEY`), and a camelCase one is rejected with the whole destination —
  // which shows up as a click that does nothing at all.
  return localixUiUri('work-item', ['agent'], {
    agent: identity.agentId ?? identity.handle,
    scope: identity.scope,
  })
}

/**
 * The stable AgentId behind a message's `from`, or null for the human and application.
 *
 * Thin on purpose: the `agent:` prefix grammar is owned by the storage vocabulary
 * (`db/participant.ts`), reached here through its own package export rather than the server
 * bundle. A second copy of the prefix rule is how the two ends drift.
 */
export function agentAuthorId(from: string | undefined): string | null {
  return from ? participantAgentId(from) : null
}

/** `code-reviewer` → `Code reviewer`. The fallback when a record carries no label. */
export function humanizeHandle(handle: string): string {
  const words = handle.replace(/[-_.]+/g, ' ').trim()
  return words ? words[0]!.toLocaleUpperCase() + words.slice(1) : handle
}

/**
 * Who authored a message, resolved against the workbench's own capability document.
 *
 * Reading the CONTRIBUTION store rather than fetching is the point: that document is the
 * active scope's, already loaded, and shared by every capability surface — so a transcript
 * of two hundred rows costs no requests and cannot disagree with the settings list about
 * what an agent is called. Missing registry entries use the captured display snapshot;
 * a same-named replacement cannot become the author of an earlier message.
 */
export function useAgentIdentity(
  from: string | undefined,
  snapshot?: { handle: string },
): AgentIdentity | null {
  const version = usePluginContribVersion()
  return useMemo(() => {
    const agentId = agentAuthorId(from)
    if (!agentId) return null
    return resolveAuthorIdentity(agentId, snapshot, pluginContribSnapshot().document?.agents ?? [])
    // `version` is a dependency, not a value: a capability publish can rename an agent.
  }, [from, snapshot?.handle, version])
}

export function resolveAuthorIdentity(
  agentId: string,
  snapshot: { handle: string } | undefined,
  agents: readonly { record: { id: string; handle: string; label?: string }; projectId: string }[],
): AgentIdentity {
  const found = agents.find((agent) => agent.record.id === agentId)
  const handle = snapshot?.handle ?? found?.record.handle ?? agentId
  return {
    agentId,
    handle,
    name: found?.record.label?.trim() || humanizeHandle(handle),
    scope: found?.projectId ?? '',
  }
}

/** Catalog selection by handle is only for navigation, never for a stored author. */
export function useAgentHandleIdentity(handle: string): AgentIdentity {
  const version = usePluginContribVersion()
  return useMemo(() => resolveHandleIdentity(handle), [handle, version])
}

/**
 * The same lookup as {@link useAgentHandleIdentity}, for a LIST of handles resolved in one pass —
 * a hook cannot run once per row of a described menu. The caller re-reads it under
 * `usePluginContribVersion()` so a rename reaches it.
 */
export function resolveHandleIdentity(handle: string): AgentIdentity {
  const found = pluginContribSnapshot().document?.agents.find(
    (agent) => agent.record.handle === handle,
  )
  return {
    agentId: found?.record.id,
    handle,
    name: found?.record.label?.trim() || humanizeHandle(handle),
    scope: found?.projectId ?? '',
  }
}
