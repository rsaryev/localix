import type { UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { rememberSeatEffort, seatProviderId } from './seatEffortMemory'
import type { ReasoningEffort } from './reasoning'
import { patchSessionById } from './sessionListHelpers'
import { findSessionInState } from './findSession'
import type { ChatStore, CustomSet } from './store'
import { withModelChoices } from './sessionModelChoices'

/**
 * "ALL" — ONE ROUTE FOR EVERY AGENT THE PICKER LISTS.
 *
 * A cascade, not a setting: the write names each listed agent (seated or not yet invited) with the
 * same route, and each becomes that agent's own choice (`sessionModelChoices.ts`).
 *
 * `modelId` absent changes only the level (the room already shares a model). The level is the
 * caller's, already clamped to the chosen model: every member gets the same model, so one clamp
 * answers for all of them.
 */
export interface PartyRouteChoice {
  providerConnectionId?: string | null
  modelId?: string
  reasoningEffort: ReasoningEffort
}

/** The picker's "All" port: the choice, and every agent the picker lists (invited or not). */
export type ApplyPartyRoute = (
  choice: PartyRouteChoice,
  agentIds: readonly string[],
) => void | Promise<void>

export type PartyRouteEntry = {
  agentId: string
  providerConnectionId?: string | null
  modelId?: string
  reasoningEffort: ReasoningEffort
}

/** The batch a choice becomes: one entry per listed agent, in the picker's order. */
export function partyRouteEntries(
  agents: readonly { agentId: string }[],
  choice: PartyRouteChoice,
): PartyRouteEntry[] {
  return agents.map(({ agentId }) => ({
    agentId,
    ...(choice.modelId
      ? { modelId: choice.modelId, providerConnectionId: choice.providerConnectionId ?? null }
      : {}),
    reasoningEffort: choice.reasoningEffort,
  }))
}

const applyEntries = (session: UiSession, entries: readonly PartyRouteEntry[]): UiSession => ({
  ...session,
  agents: session.agents.map((member) => {
    const entry = entries.find((candidate) => candidate.agentId === member.agentId)
    if (!entry) return member
    const { agentId: _agentId, ...route } = entry
    return { ...member, ...route }
  }),
})

/**
 * The store action. It shares the per-session write lane with the single-member picker, so a
 * bulk apply and a quick per-member pick reach the server in the order they were made, and a run
 * started after the response reads the room as one statement (the server writes it in one
 * transaction).
 */
export function createApplyPartyRoute({
  customSet,
  get,
  lane,
}: {
  customSet: CustomSet
  get: () => ChatStore
  lane: Map<string, Promise<UiSession>>
}) {
  return async (
    sessionId: string,
    choice: PartyRouteChoice,
    /** Every agent the picker lists; absent, the seated ones. */
    agentIds?: readonly string[],
  ): Promise<void> => {
    const previous = findSessionInState(get(), sessionId)
    if (!previous) return
    const listed = agentIds?.map((agentId) => ({ agentId })) ?? previous.agents
    if (listed.length === 0) return
    const entries = partyRouteEntries(listed, choice)
    customSet((state) =>
      patchSessionById(state, sessionId, (session) =>
        withModelChoices(applyEntries(session, entries), entries),
      ),
    )
    const persist = () => backendClient.updateSession(sessionId, { routes: entries })
    const prior = lane.get(sessionId)
    const write = prior ? prior.then(persist, persist) : persist()
    lane.set(sessionId, write)
    let session: UiSession
    try {
      session = await write
    } catch (error) {
      // Undo only while nothing newer has been queued behind this write, and only the route:
      // a member's handle or anything else that changed meanwhile is not this write's to undo.
      if (lane.get(sessionId) === write) {
        customSet((state) =>
          patchSessionById(state, sessionId, (current) => ({
            ...current,
            modelChoices: previous.modelChoices,
            agents: current.agents.map((member) => {
              const before = previous.agents.find((seat) => seat.agentId === member.agentId)
              if (!before) return member
              const { providerConnectionId, modelId, reasoningEffort } = before
              return { ...member, providerConnectionId, modelId, reasoningEffort }
            }),
          })),
        )
      }
      throw error
    } finally {
      if (lane.get(sessionId) === write) lane.delete(sessionId)
    }
    if (!lane.has(sessionId)) get()._replaceSession(session)
    // The level is remembered per agent and model, exactly as a single pick records it.
    for (const member of session.agents) {
      const providerId = seatProviderId(
        get().connections,
        member.providerConnectionId,
        member.modelId,
      )
      if (member.modelId && providerId)
        rememberSeatEffort({
          agentId: member.agentId,
          providerId,
          modelId: member.modelId,
          effort: member.reasoningEffort,
        })
    }
  }
}
