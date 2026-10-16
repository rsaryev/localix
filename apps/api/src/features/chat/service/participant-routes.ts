import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import type { SeatRouteFor } from './session-route-defaults'
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
  /** Decides each top-level seat's complete route (`agent-route-resolution.ts`). */
  seat?: SeatRouteFor
}): Promise<SessionAgentRoute[]> {
  const participants = await resolveSessionParticipants({
    userId: args.userId,
    projectId: args.projectId,
    requested: args.requested,
    resolve: args.resolve,
    ...(args.host ? { host: args.host } : {}),
  })
  const explicit = args.explicit ?? {}
  // A child is an executable slice of its parent and snapshots the parent's route.
  if (args.parent || !args.seat) {
    return seedParticipants({ requested: participants, explicit, parent: args.parent ?? null })
  }
  const seated: SessionAgentRoute[] = []
  for (const agent of participants) {
    seated.push(
      await seatNewcomer(args.seat, args.userId, args.projectId, agent, {
        chosen: chosenRoute(agent, explicit),
        primary: seated[0] ?? null,
      }),
    )
  }
  return seated
}

/** What the caller explicitly asked for one participant: its own pick, else the session-wide one. */
function chosenRoute(
  agent: Partial<ModelRoute>,
  explicit: Partial<ModelRoute>,
): Partial<ModelRoute> {
  const effort = agent.reasoningEffort ?? explicit.reasoningEffort
  const model = agent.modelId
    ? { modelId: agent.modelId, providerConnectionId: agent.providerConnectionId ?? null }
    : explicit.modelId
      ? { modelId: explicit.modelId, providerConnectionId: explicit.providerConnectionId ?? null }
      : {}
  return { ...model, ...(effort ? { reasoningEffort: effort } : {}) }
}

/** One new seat, its route decided once and stored explicitly. */
export async function seatNewcomer(
  seat: SeatRouteFor,
  userId: string,
  projectId: string | null,
  agent: ResolvedSessionAgent,
  given: { chosen?: Partial<ModelRoute> | null; primary?: Partial<ModelRoute> | null },
): Promise<SessionAgentRoute> {
  const {
    providerConnectionId: _connection,
    modelId: _model,
    reasoningEffort: _effort,
    ...identity
  } = agent as ResolvedSessionAgent & Partial<ModelRoute>
  const route = await seat(userId, projectId, agent.agentId, given)
  return {
    ...identity,
    providerConnectionId: route.providerConnectionId,
    modelId: route.modelId,
    reasoningEffort: route.reasoningEffort,
    modelOrigin: route.modelOrigin,
  }
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
 * A newcomer's route is decided once, by the same `seatRoute` a new conversation uses — its
 * own last model, its card, the project, else the room's primary — and its effort is the level
 * remembered for that model, never the conversation's or another participant's.
 */
export async function reseatParticipants(
  session: { agents: SessionAgentRoute[]; projectId?: string | null; userId?: string },
  next: readonly ResolvedSessionAgent[],
  seat?: SeatRouteFor,
): Promise<SessionAgentRoute[]> {
  const seated = new Map(session.agents.map((member) => [member.agentId, member]))
  const out: SessionAgentRoute[] = []
  for (const member of next) {
    const existing = seated.get(member.agentId)
    if (existing) {
      out.push({ ...existing, ...member, handle: member.handle })
    } else if (seat && session.userId) {
      out.push(
        await seatNewcomer(seat, session.userId, session.projectId ?? null, member, {
          primary: out[0] ?? session.agents[0] ?? null,
        }),
      )
    } else {
      out.push({
        providerConnectionId: null,
        modelId: '',
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        ...member,
        handle: member.handle,
      })
    }
  }
  return out
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
        agentEffort ?? input.reasoningEffort ?? parentEffort ?? DEFAULT_REASONING_EFFORT,
      ...identity,
    }
  })
}
