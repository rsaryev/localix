/**
 * THE BIRTH OF A SESSION — everything decided once, at creation, and never again.
 *
 * Its own module because it answers a different question from the rest of the lifecycle. The
 * others act on a conversation that exists (list it, patch it, archive it); this one decides
 * what a conversation IS: which project it belongs to, who is in it, what each of them starts
 * on, where it sits in the session tree, and what provenance it may claim. Those are settled in
 * one order, each step feeding the next, and reading them interleaved with the update path made
 * both harder to follow than either is alone.
 *
 * The order below is the argument: validate what the caller stated (the parent's lineage, the
 * connection it named), then decide what the caller left open (project, party, efforts), then
 * allocate, then write. Nothing is allocated before every refusal has had its chance — a
 * session ref spent on a request that then fails leaves a hole in a sequence the user reads.
 */
import { InvalidRequestError, NotFoundError } from '../../../lib/domain-errors'
import type { SessionDetail } from '../contracts'
import { toSessionSummary, type SessionRecord } from '../repository'
import { resolveSessionRoot, sessionRootResolutionError } from '../session-ancestry'
import { normalizeSessionTitle } from '../session-limits'
import type { SessionProvenance } from '../session-provenance'
import { DEFAULT_TITLE } from './context'
import { bornParticipants } from './participant-routes'
import { isDelegationParent } from '../../agent-core/delegation-policy'
import type { CreateSessionInput, SessionLifecycleCtx } from './session-lifecycle-contracts'

export async function createSession(
  ctx: SessionLifecycleCtx,
  userId: string,
  input: CreateSessionInput,
): Promise<SessionDetail> {
  const timestamp = ctx.now()
  const history = input.externalAgentSessionKey ? input.externalAgentHistory : undefined
  const createdAt = history
    ? new Date(history.startedAt ?? history.updatedAt).toISOString()
    : timestamp
  const updatedAt = history ? new Date(history.updatedAt).toISOString() : timestamp
  const parent = input.parentSessionId
    ? await ctx.requireSession(userId, input.parentSessionId)
    : null
  const parentRoot = parent
    ? resolveSessionRoot(
        parent,
        parent.parentSessionId ? await ctx.repo.listSessionAncestry(userId, parent.id) : [],
      )
    : null
  if (parentRoot && !parentRoot.ok) {
    throw sessionRootResolutionError(input.parentSessionId!, parentRoot)
  }
  // Every session belongs to a project. An explicit one wins; a child inherits its parent's
  // (its scope is the parent's by construction); anything else falls to the default project,
  // whose whole purpose is that "no project" must not resolve to the `global` capability scope.
  const projectId =
    input.projectId ?? parent?.projectId ?? (await ctx.resolveDefaultProjectId(userId))
  if (input.projectId) await assertStatedProjectExists(ctx, userId, input.projectId)
  await assertStatedConnectionExists(ctx, userId, input.providerConnectionId)
  const sessionKind = input.sessionKind ?? 'chat'
  assertDelegatedSession(input, sessionKind)
  if (
    (sessionKind === 'subagent' || input.provenance?.kind === 'skill-fork') &&
    (!parent || !isDelegationParent(parent))
  ) {
    throw new InvalidRequestError(
      'invalid_delegation_parent',
      'Only a root chat may delegate. Subsessions cannot create delegated work.',
    )
  }
  // The ONE place a conversation's participants are decided at birth, routes and all. A session
  // is never with no one, and saying so here — rather than at the writer, or again at each
  // caller — keeps "who is in this conversation, on what" a birth property instead of a rule
  // three layers each half-enforce.
  const agents = await bornParticipants({
    userId,
    projectId,
    requested: input.agents,
    explicit: input,
    parent,
    resolve: ctx.resolveSessionAgent,
    seat: ctx.seatRoute,
    // Only a conversation seats conversational participants. An engine's own worker session is
    // created for an agent whose chat invocation is often denied on purpose, and that is fine:
    // it is not being asked to chat.
    ...(sessionKind === 'chat' ? { host: 'chat' } : {}),
  })
  const externalAgentProvider =
    input.externalAgentProvider ??
    (sessionKind === 'chat' ? parent?.externalAgentProvider : undefined)
  const { seq, id } = await ctx.repo.allocateSessionRef(userId)
  const session: SessionRecord = {
    id,
    seq,
    userId,
    title: normalizeSessionTitle(input.title, DEFAULT_TITLE),
    goal: input.goal ?? null,
    previousTopicSummary: input.previousTopicSummary ?? null,
    isPinned: false,
    projectId,
    parentSessionId: input.parentSessionId ?? null,
    // Parent links are authoritative. Never let a caller-supplied or stale denormalized root
    // redirect a child's security/UI scope.
    rootSessionId: parentRoot?.ok ? parentRoot.root.id : null,
    sessionKind,
    runtimeStatus:
      input.sessionKind === 'subagent' || input.sessionKind === 'job' ? 'running' : 'idle',
    ...(externalAgentProvider ? { externalAgentProvider } : {}),
    ...(input.externalAgentSessionKey
      ? { externalAgentSessionKey: input.externalAgentSessionKey }
      : {}),
    sourceToolCallId: input.sourceToolCallId ?? null,
    provenance: bornProvenance(input, sessionKind),
    createdAt,
    updatedAt,
    lastMessageAt: updatedAt,
    executionBackend: 'local',
    executionTarget: null,
    agents,
    // A delegated child is born into its tree's mode (the parent carries it — a mode change is
    // written to the whole tree): a worker delegated from a plan session must not be the one
    // call in that session able to write.
    ...(parent?.permissionMode ? { permissionMode: parent.permissionMode } : {}),
    description: input.description ?? null,
    avatar: input.avatar ?? null,
    pinnedSkills: input.pinnedSkills ?? [],
    activatedTools: [],
    archivedAt: null,
  }

  await ctx.repo.insertSession(session)
  const detail = await ctx.getSessionDetail(userId, session.id)
  const resolved = {
    ...session,
    agents: detail.agents ?? session.agents,
    messageCount: detail.messageCount ?? 0,
  }
  // Publish the resolved record to EVERY workspace, including ordinary root chats.
  if (!session.parentSessionId) ctx.publishSession(resolved)
  if (session.parentSessionId) {
    ctx.streamRegistry.publish(userId, session.parentSessionId, {
      type: 'child_session.updated',
      parentSessionId: session.parentSessionId,
      session: toSessionSummary({
        ...resolved,
        rootSessionId: session.rootSessionId ?? session.id,
      }),
    })
  }
  return detail
}

/** A subagent is exclusively a one-shot delegation, born of the tool call that asked for it. */
function assertDelegatedSession(
  input: CreateSessionInput,
  sessionKind: NonNullable<CreateSessionInput['sessionKind']>,
): void {
  if (sessionKind !== 'subagent') return
  if (
    !input.parentSessionId ||
    !input.sourceToolCallId ||
    input.provenance?.kind !== 'task-delegation' ||
    input.provenance.parentSessionId !== input.parentSessionId ||
    input.provenance.toolCallId !== input.sourceToolCallId
  ) {
    throw new InvalidRequestError(
      'invalid_subagent_origin',
      'A subagent requires a parent session and the delegating tool call.',
    )
  }
}

/**
 * Refuse a connection the user does not hold, before anything is allocated.
 *
 * The column is a foreign key into `provider_connections`, and an id that resolves to nothing
 * used to reach the insert: the constraint's failure is an unhandled throw, which the root
 * handler can only answer `500 Unexpected server error`. That is the shape every client got
 * after `~/.localix/localix.db` was recreated while it still named a connection from the old
 * one. A caller naming something that does not exist has made a request error, and the answer
 * has to say which thing and what to do about it.
 */
async function assertStatedProjectExists(
  ctx: SessionLifecycleCtx,
  userId: string,
  projectId: string,
): Promise<void> {
  if (!ctx.projectExists || (await ctx.projectExists(userId, projectId))) return
  throw new NotFoundError('project_not_found', 'Project not found')
}

async function assertStatedConnectionExists(
  ctx: SessionLifecycleCtx,
  userId: string,
  connectionId: string | null | undefined,
): Promise<void> {
  if (!connectionId || !ctx.connectionExists) return
  if (await ctx.connectionExists(userId, connectionId)) return
  throw new NotFoundError(
    'provider_connection_not_found',
    'That provider connection no longer exists. Pick a provider in the model picker.',
  )
}

/**
 * What a new session may claim about where it came from.
 *
 * Only a top-level chat may acquire root provenance. Every missing or contradictory child
 * classification fails closed to the explicit `unknown-origin` kind — a real persisted value,
 * deliberately powerless: a passive execution class, never trusted.
 */
function bornProvenance(
  input: CreateSessionInput,
  sessionKind: NonNullable<CreateSessionInput['sessionKind']>,
): SessionProvenance {
  if (!input.parentSessionId && sessionKind === 'chat') {
    return input.provenance?.kind === 'root' || input.provenance === undefined
      ? { kind: 'root' }
      : input.provenance
  }
  return input.provenance?.kind !== 'root'
    ? (input.provenance ?? { kind: 'unknown-origin' })
    : { kind: 'unknown-origin' }
}
