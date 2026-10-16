/**
 * THE PLAN LIFECYCLE, WIRED AS THE SERVER WIRES IT — over a real database, minus the model.
 *
 * `bootstrap/session-services.ts` builds the plans service from chat's session update path, its
 * notice writer and the attention source; the existing plan tests replace all three with
 * recorders, so the seams BETWEEN them — the mode line before the plan line, the auto-dismiss
 * the mode hook fires, the journal row the attention item mirrors — were never run together.
 * Here each seam is the production function: `updateSession` (with its mode notice and the mode
 * hook), `recordSessionNotice`, `startAgentNotifications` (attention registry + journal mirror).
 * Only what needs a model is a recorder: the wake, and the participant handle lookup.
 *
 * Every observable step lands in ONE ordered log (`events`), so a test can assert not just that
 * a mode line and a wake happened but that the mode moved before the turn it opens.
 */
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { StoredSystemNotice } from '../../db/payload'
import type { WakeRequest } from '../chat/contracts'
import { createChatRepository, type SessionRecord } from '../chat/repository'
import { recordSessionNotice } from '../chat/runtime/session-notice'
import {
  createSession,
  updateSession,
  type SessionLifecycleCtx,
} from '../chat/service/session-lifecycle'
import type { PermissionMode } from '../capabilities/permission-modes'
import { createCommentRepository } from '../comments/repository'
import { createNotificationJournal } from '../notifications/journal'
import { startAgentNotifications } from '../notifications/producers'
import type { InboxEntry } from '../notifications/contracts'
import { createPlanRepository } from '../plans/repository'
import { createPlanService } from '../plans/service'
import { queuedTurnEvent, resolveTurnRecipients } from '../chat/runtime/conversation-dispatch'
import { noLeadership } from '../chat/runtime/conversation-strategy'
import { createMemoryWorkRepository } from '../work/memory-repository'
import { createWorkRegistry } from '../work/registry'
import { routedParticipants } from '../../testing/session-fixture'
import { createMemoryPlanFiles, withStoredVersions } from '../../testing/plan-files-fixture'

export const USER = 'user-1'
export const ROOT = 'root'
export const CHILD = 'child'

function sessionRow(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  const at = '2026-10-03T00:00:00.000Z'
  return {
    id,
    userId: USER,
    seq: 1,
    title: id,
    isPinned: false,
    createdAt: at,
    updatedAt: at,
    lastMessageAt: at,
    executionBackend: 'local',
    executionTarget: null,
    projectId: 'PRJ-test',
    parentSessionId: null,
    rootSessionId: id,
    sessionKind: 'chat',
    agents: routedParticipants(),
    description: null,
    avatar: null,
    runtimeStatus: 'idle',
    sourceToolCallId: null,
    provenance: { kind: 'root' },
    pinnedSkills: [],
    activatedTools: [],
    archivedAt: null,
    ...overrides,
  }
}

/** The root's participants by handle (agent id `agent-<handle>`); one agent unless given. */
export async function createPlanLifecycle(handles?: readonly string[]) {
  const db = createDatabase()
  await migrateToLatest(db)
  const chat = createChatRepository(db)
  await chat.insertSession(
    sessionRow(
      ROOT,
      handles
        ? {
            agents: handles.map(
              (handle) => routedParticipants({ agentId: `agent-${handle}`, handle })[0],
            ),
          }
        : {},
    ),
  )
  await chat.insertSession(
    sessionRow(CHILD, {
      seq: 2,
      parentSessionId: ROOT,
      rootSessionId: ROOT,
      sessionKind: 'subagent',
    }),
  )

  const events: string[] = []
  const wakes: WakeRequest[] = []
  /** Every `plan.presented` cue, as `v<N>` — apart from `events` so no step's log changes. */
  const presentedCues: string[] = []
  const journal = createNotificationJournal({ db })
  const signals = await startAgentNotifications({
    db,
    journal,
    lookupSession: async (userId, id) => {
      const record = await chat.getSession(userId, id)
      return record
        ? { ...record, projectId: record.projectId ?? null, provenance: record.provenance }
        : null
    },
    defaultUserId: USER,
    work: createWorkRegistry({ repo: createMemoryWorkRepository() }),
  })

  let plans: ReturnType<typeof createPlanService>
  const requireSession = async (userId: string, id: string) => {
    const record = await chat.getSession(userId, id)
    if (!record) throw new Error(`no session ${id}`)
    return record
  }
  const sessions = {
    now: () => new Date().toISOString(),
    repo: chat,
    requireSession,
    getSessionDetail: async (_userId: string, id: string) => ({ id }),
    publishSession: () => {},
    streamRegistry: {
      publish: (_user: string, sessionId: string, event: { type: string; message?: unknown }) => {
        const notice = (event.message as { payload?: { systemNotice?: StoredSystemNotice } })
          ?.payload?.systemNotice
        if (event.type === 'message.created' && notice)
          events.push(`notice@${sessionId} ${notice.kind}`)
      },
    },
    onPermissionModeChanged: async (
      userId: string,
      sessionId: string,
      before: PermissionMode | undefined,
      after: PermissionMode,
    ) => {
      events.push(`mode ${before}->${after}`)
      await plans.permissionModeChanged({ userId, sessionId }, before, after)
    },
  } as unknown as SessionLifecycleCtx

  const planFiles = createMemoryPlanFiles()
  plans = createPlanService({
    repo: createPlanRepository(db),
    comments: createCommentRepository(db),
    files: planFiles.files,
    publish: () => {},
    presented: (_owner, plan) => presentedCues.push(`v${plan.version}`),
    setMode: async ({ userId, sessionId }, mode) => {
      await updateSession(sessions, userId, sessionId, { permissionMode: mode })
    },
    wake: async (request) => {
      events.push(`wake ${request.source}`)
      wakes.push(request)
      return { status: 'delivered' }
    },
    participants: async ({ userId, sessionId }) =>
      (await requireSession(userId, sessionId)).agents.map((member) => member.handle),
    lifecycle: {
      notice: ({ userId, sessionId }, notice) =>
        recordSessionNotice(sessions, userId, sessionId, notice),
      authorHandle: async () => 'lead',
      awaiting: ({ userId }, plan, handle) => signals.plans.awaiting(userId, plan, handle),
      settled: ({ userId, sessionId }, planId, reason) =>
        signals.plans.settled(userId, sessionId, planId, reason),
      completed: ({ userId }, plan) => signals.plans.completed(userId, plan),
    },
  })

  return {
    db,
    /** `present` answering the stored version — for steps that each present a new body. */
    plans: withStoredVersions(plans),
    /** The service as wired: `present` answers what it decided (new, restored, unchanged). */
    service: plans,
    /** The plan's files, in memory — the draft the agent writes, the snapshots the host does. */
    planFiles,
    events,
    wakes,
    presentedCues,
    /** Each stored version as `v<N> <status> awaiting=<0|1>`, newest first — the raw flag. */
    awaitingFlags: async (): Promise<string[]> =>
      (
        await db
          .selectFrom('session_plans')
          .select(['version', 'status', 'awaiting_person'])
          .where('session_id', '=', ROOT)
          .orderBy('version', 'desc')
          .execute()
      ).map((row) => `v${row.version} ${row.status} awaiting=${row.awaiting_person}`),
    owner: { userId: USER, sessionId: ROOT },
    /** The person moves the root's mode through the session update path. */
    setMode: (mode: PermissionMode) =>
      updateSession(sessions, USER, ROOT, { permissionMode: mode }),
    /** Any session's own mode patch, through the same path (a child's is refused there). */
    patchMode: (id: string, mode: PermissionMode) =>
      updateSession(sessions, USER, id, { permissionMode: mode }),
    /** A child born now, the way `fork` creates one: returns its id. */
    delegate: async (): Promise<string> => {
      const detail = await createSession(sessions, USER, {
        parentSessionId: ROOT,
        sessionKind: 'subagent',
        sourceToolCallId: 'call-delegate',
        provenance: { kind: 'task-delegation', parentSessionId: ROOT, toolCallId: 'call-delegate' },
      })
      return (detail as unknown as { id: string }).id
    },
    modeOf: async (id: string) => (await chat.getSession(USER, id))?.permissionMode,
    session: (id: string) => requireSession(USER, id),
    /**
     * The handles a recorded wake reaches, routed as the drain routes it: the same event rule
     * (`queuedTurnEvent`) through the conversation's own strategy, over the stored transcript.
     */
    addressees: async (request: WakeRequest): Promise<string[]> => {
      const session = await requireSession(USER, request.sessionId)
      const recipients = await resolveTurnRecipients(
        session,
        await chat.listMessages(USER, request.sessionId),
        queuedTurnEvent(
          { internal: true, content: request.content, addressedAs: request.addressedAs },
          request.to?.participant,
        ),
        noLeadership,
      )
      return recipients.map(
        ({ agentId }) => session.agents.find((member) => member.agentId === agentId)!.handle,
      )
    },
    /** Everything the root conversation says, as stored — notice kinds in order. */
    noticeKinds: async () =>
      (await chat.listMessages(USER, ROOT))
        .map((message) => message.payload.systemNotice?.kind)
        .filter((kind): kind is NonNullable<typeof kind> => kind !== undefined),
    /** The same lines with their text, as `kind: text`. */
    noticeLines: async () =>
      (await chat.listMessages(USER, ROOT)).flatMap((message) => {
        const notice = message.payload.systemNotice
        return notice ? [`${notice.kind}: ${notice.text}`] : []
      }),
    /** The person's "waiting on you" set, as the client receives it. */
    attention: () => signals.attention.list(USER).map((item) => `${item.kind} ${item.title}`),
    /** The Event Center rows, keyed, once every producer has written. */
    journal: async (): Promise<Map<string, InboxEntry>> => {
      await signals.idle()
      await journal.flush()
      const rows = new Map<string, InboxEntry>()
      for (const change of (await journal.sync(USER, 0)).changes)
        if ('entry' in change) rows.set(change.entry.key, change.entry)
      return rows
    },
    comment: (planScope: string, body: string) =>
      createCommentRepository(db).create({ userId: USER, scope: planScope, anchor: {}, body }),
    /** Take the log so far and start a fresh one — each step asserts only what it caused. */
    drain: () => events.splice(0),
    dispose: () => destroyDatabase(db),
  }
}

export type PlanLifecycle = Awaited<ReturnType<typeof createPlanLifecycle>>
