import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import type { ReasoningEffort } from '../../../db/types'
import type { SessionAgentRoute, ModelRoute } from '../repository-types'
import { sessionRoute } from '../session-route'
import {
  resolveSessionParticipants,
  type ResolveSessionAgent,
  type ResolvedSessionAgent,
  type SessionAgentSelection,
} from './session-agent-selection'

/**
 * Who a NEW conversation is with, and on what each of them starts — the whole birth, in order:
 * resolve the requested agents, ask the model chain for each one's effort, seed the routes.
 *
 * One function because two births used it: a workspace session and an externally driven one.
 * The external one used to write its participant by hand (priority 1, effort `low`), so an
 * unattended conversation thought less hard than the identical one opened in the workspace.
 */
export async function bornParticipants(args: {
  userId: string
  projectId: string
  requested?: readonly (SessionAgentSelection & Partial<ModelRoute>)[]
  explicit?: Partial<ModelRoute>
  parent?: { agents: SessionAgentRoute[] } | null
  /** Only a conversation seats conversational participants; an engine's worker omits it. */
  host?: string
  resolve?: ResolveSessionAgent
  ask?: (userId: string, projectId: string, agentId: string) => Promise<ReasoningEffort>
}): Promise<SessionAgentRoute[]> {
  const participants = await resolveSessionParticipants({
    userId: args.userId,
    projectId: args.projectId,
    requested: args.requested,
    resolve: args.resolve,
    ...(args.host ? { host: args.host } : {}),
  })
  const efforts = await participantEfforts({
    userId: args.userId,
    projectId: args.projectId,
    participants,
    parent: args.parent,
    ask: args.ask,
  })
  return seedParticipants({
    requested: participants,
    explicit: args.explicit ?? {},
    effortFor: (agentId) => efforts.get(agentId),
    parent: args.parent ?? null,
  })
}

/**
 * WHAT EACH PARTICIPANT RUNS ON when membership is decided — at birth and on every change.
 *
 * Membership and routes are two verbs, and keeping them apart is the point: these functions
 * decide the list of participants and seed a NEWCOMER's route; what a participant who stays
 * runs on is never restated here, and a deliberate re-route is its own write
 * (`updateSessionAgentRoute`). Collapsing the two — sending a whole list to change a model —
 * would let a mis-shaped request silently drop a participant, and no writer can tell that apart
 * from a deliberate removal.
 *
 * Nothing here knows about a particular agent or about how many participants there are. A
 * conversation is a list; a list of one is not a special case.
 */

/**
 * Apply a new membership list, keeping the route of everyone who was already here.
 *
 * Adding a participant must not silently re-route the others, and removing one must not
 * either — which is exactly what would happen if the patch's entries were taken as written,
 * because a caller adding one participant states the whole list and knows nobody else's model.
 *
 * A newcomer arrives with NO model of its own, so the chain answers for it exactly as it does
 * for a fresh conversation — its card, or what you last ran it on. It used to be seeded from the
 * first participant's route, which handed it a model chosen for somebody else and, worse,
 * recorded that as a decision. What it does inherit is the conversation's EFFORT: how hard to
 * think is a property of the conversation in progress, and a participant joining a `high`
 * discussion joins it at `high`.
 */
export function reseatParticipants(
  session: { agents: SessionAgentRoute[] },
  next: readonly ResolvedSessionAgent[],
): SessionAgentRoute[] {
  const seated = new Map(session.agents.map((member) => [member.agentId, member]))
  const seed: ModelRoute = {
    providerConnectionId: null,
    modelId: '',
    reasoningEffort: sessionRoute(session).reasoningEffort,
  }
  return next.map((member) => ({
    ...seed,
    ...seated.get(member.agentId),
    ...member,
    handle: member.handle,
  }))
}

/**
 * The level each new participant is born on, asked once per participant.
 *
 * A CHILD never asks: it takes its parent's dial (see {@link seedParticipants}), and a lookup
 * whose answer would be discarded is a lookup not worth making on a spawn path — `delegate`
 * creates one of these per sub-agent.
 */
export async function participantEfforts(args: {
  userId: string
  projectId: string
  participants: readonly ResolvedSessionAgent[]
  parent?: unknown
  ask?: (userId: string, projectId: string, agentId: string) => Promise<ReasoningEffort>
}): Promise<Map<string, ReasoningEffort>> {
  const efforts = new Map<string, ReasoningEffort>()
  if (args.parent || !args.ask) return efforts
  await Promise.all(
    args.participants.map(async (member) => {
      const effort = await args.ask!(args.userId, args.projectId, member.agentId).catch(() => null)
      if (effort) efforts.set(member.agentId, effort)
    }),
  )
  return efforts
}

/**
 * Seed each participant's route at birth.
 *
 * Membership has already been resolved by the host. A participant's own route choice overrides
 * the caller's session-wide one. A top-level participant with no choice stays blank so the model
 * chain remains live. A child inherits the matching parent participant's effective route, or the
 * primary participant's route when it was not in the conversation. That is the final safety net
 * for an executable child: a conversation already running on a model must not create a
 * model-less child.
 */
export function seedParticipants(args: {
  /** Resolved participants, in order. */
  requested: readonly ResolvedSessionAgent[]
  /** The caller's explicit choice, if it made one. */
  explicit: Partial<ModelRoute>
  /** What the model chain says this agent's effort should start at. */
  effortFor?: (agentId: string) => ReasoningEffort | undefined
  parent?: { agents: SessionAgentRoute[] } | null
}): SessionAgentRoute[] {
  const { requested, explicit: input, parent } = args
  // A TOP-LEVEL SESSION STORES ONLY WHAT THE CALLER ACTUALLY CHOSE FOR THE MODEL.
  //
  // A participant used to be born holding a concrete model — the project's default, else
  // whatever route the user happened to be on last. That made every participant look explicitly
  // decided, so "this one has no model of its own" could not be expressed and the levels below
  // the session could never be consulted again: an agent's own model was unreachable, and a
  // project default changed later reached nothing. The levels are applied on READ now
  // (`session-route-defaults.ts`), which only works if a blank stays blank here. A child is the
  // deliberate exception: it is an executable slice of an already-routed parent and snapshots
  // that effective route for its one-shot lifetime.
  //
  // THE EFFORT IS THE OPPOSITE CASE and is written now, concretely. It is the dial for the task
  // this conversation is about, so it must not move under a running conversation when a level
  // below it changes; `agent-route-resolution.ts` says why the two fields are settled at
  // different times. A child takes its parent's: a child is a slice of its parent's task, and a
  // flat default silently downgraded every `delegate` child of a high-effort run.
  const parentEffort = parent ? sessionRoute(parent).reasoningEffort : undefined
  return requested.map((agent) => {
    const {
      providerConnectionId: agentConnectionId,
      modelId: agentModelId,
      reasoningEffort: agentEffort,
      ...identity
    } = agent
    const parentRoute = parent
      ? (parent.agents.find((member) => member.agentId === agent.agentId) ?? sessionRoute(parent))
      : null
    const agentStatesModel = Boolean(agentModelId)
    const inputStatesModel = !agentStatesModel && Boolean(input.modelId)
    const inheritedModel =
      !agentStatesModel && !inputStatesModel && parentRoute?.modelId ? parentRoute : null
    return {
      providerConnectionId: agentStatesModel
        ? (agentConnectionId ?? null)
        : inputStatesModel
          ? (input.providerConnectionId ?? null)
          : (inheritedModel?.providerConnectionId ?? null),
      modelId: agentStatesModel
        ? agentModelId!
        : inputStatesModel
          ? input.modelId!
          : (inheritedModel?.modelId ?? ''),
      ...(inheritedModel ? { modelOrigin: 'primary' as const } : {}),
      reasoningEffort:
        agentEffort ??
        input.reasoningEffort ??
        parentEffort ??
        args.effortFor?.(agent.agentId) ??
        DEFAULT_REASONING_EFFORT,
      ...identity,
    }
  })
}
