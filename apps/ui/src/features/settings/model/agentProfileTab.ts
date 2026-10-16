import { inspector } from '@/shared/lib/inspectorBus'

/**
 * The agent profile tab's IDENTITY — the one formula that decides when two opens are the same
 * tab.
 *
 * It is a module of its own because three callers need to agree on it and none of them may
 * derive it again: the URI location that opens a profile, the registry screen that opens one
 * for a record it is showing, and the delete that has to close the tab of the record it just
 * removed. A second spelling anywhere means a duplicate tab for the same agent, or a tab left
 * behind pointing at a record that no longer exists.
 *
 * A record is addressed by its id AND its scope: the same handle can exist globally and inside
 * a project, and those are two different records with two different profiles.
 */

/** Everything the profile tab is opened by — its own kind, its id grammar, its payload. */
export const AGENT_PROFILE_WORK_KIND = 'agent'

/** Every profile tab's id starts here, so a scope-wide close needs no list of them. */
export const AGENT_PROFILE_TAB_PREFIX = 'agent:'

/** One saved record's profile. */
export const agentProfileTabId = (agentId: string, scope: string) =>
  `${AGENT_PROFILE_TAB_PREFIX}profile:${scope}:${agentId}`

/**
 * The profile of an agent that does not exist yet.
 *
 * Keyed by scope alone, so "New agent" twice in the same scope reveals the draft already open
 * instead of a second empty one — and a draft in the global registry stays distinct from a
 * draft in a project, which is what the scope decides.
 */
export const newAgentTabId = (scope: string) => `${AGENT_PROFILE_TAB_PREFIX}new:${scope}`

export interface AgentProfilePayload {
  /** The record's id, or '' while the profile is a draft that has not been created yet. */
  agentId: string
  /** '' = the global registry, otherwise the project the record lives in. */
  projectId: string
  initialHandle?: string
  section?: 'rules' | 'definition'
  sectionRequestId?: string
}

/** Open (or reveal) one saved agent's profile. */
export function openAgentProfile(agentId: string, scope: string, title: string): void {
  inspector.openWorkItem({
    workKind: AGENT_PROFILE_WORK_KIND,
    id: agentProfileTabId(agentId, scope),
    title,
    // An agent profile is app-level: it belongs to no chat.
    scope: null,
    payload: { agentId, projectId: scope } satisfies AgentProfilePayload,
  })
}

/** Open (or reveal) the draft profile a new agent is created from. */
export function openNewAgentProfile(scope: string): void {
  inspector.openWorkItem({
    workKind: AGENT_PROFILE_WORK_KIND,
    id: newAgentTabId(scope),
    title: 'New agent',
    scope: null,
    payload: { agentId: '', projectId: scope } satisfies AgentProfilePayload,
  })
}

/**
 * Close a profile tab whose record is gone.
 *
 * By prefix rather than by exact id because a deleted record's tab and the draft that created
 * it are the same subject to the person who pressed Delete, and a tab left open on a record the
 * app no longer has is a screen full of fields that cannot be saved.
 */
export function closeAgentProfile(agentId: string, scope: string): void {
  inspector.closeWorkItems(agentProfileTabId(agentId, scope))
}
