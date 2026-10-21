import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { nextRefSeq, retrySqliteBusy } from '../../db'
import { recordSessionChanges } from './session-changes'
import { deleteSessionChunks } from '../context-store/repository-maintenance'
import { claimSessionIdentity, type SessionIdentityClaim } from './repository-session-identity'
import { sessionRef } from './contracts'
import { createExternalSessionWriter } from './repository-external-session-write'
import {
  writeAgentRoute,
  writeMembership,
  writeParticipants,
} from './repository-conversation-participants'
import { writeModelChoices } from './repository-model-choices'
import type { ModelRoute, SessionRecord } from './repository-types'
import { serializeSessionProvenance } from './session-provenance'
import { sessionRowPatch } from './repository-session-patch'
import { sessionSubtreeForDeletion } from './session-subtree'

// Session writes: ref allocation, insert (with the in-transaction agent-name claim),
// the external-session get-or-create, the field patch, the two conditional writes, and
// delete. Identity claims and external-key reservation share the insert transaction.

export function createSessionWriteQueries(db: Kysely<AppDatabase>) {
  const insertSessionRecord = async (
    exec: Kysely<AppDatabase>,
    record: SessionRecord,
    // Passed rather than read off the record: the name must be CLAIMED in this same transaction
    // (see claimSessionIdentity), and an argument makes that a structural requirement instead of a
    // convention a future call site can forget.
    identity: SessionIdentityClaim,
  ): Promise<void> => {
    await exec
      .insertInto('agent_sessions')
      .values({
        id: record.id,
        user_id: record.userId,
        seq: record.seq ?? 0,
        title: record.title,
        goal: record.goal ?? null,
        previous_topic_summary: record.previousTopicSummary ?? null,
        is_pinned: record.isPinned ? 1 : 0,
        project_id: record.projectId,
        parent_session_id: record.parentSessionId,
        root_session_id: identity.rootSessionId,
        session_kind: record.sessionKind,
        runtime_status: record.runtimeStatus,
        source_tool_call_id: record.sourceToolCallId,
        ...(record.externalAgentProvider
          ? { external_agent_provider: record.externalAgentProvider }
          : {}),
        ...(record.externalAgentSessionKey
          ? { external_agent_session_key: record.externalAgentSessionKey }
          : {}),
        invocation_json: serializeSessionProvenance(record.provenance),
        pinned_skills: JSON.stringify(record.pinnedSkills ?? []),
        description: record.description,
        avatar: record.avatar,
        ...(record.permissionMode ? { permission_mode: record.permissionMode } : {}),
        activated_tools: record.activatedTools?.length
          ? JSON.stringify(record.activatedTools)
          : null,
        archived_at: record.archivedAt ?? null,
        task_name: identity.taskName,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        last_message_at: record.lastMessageAt,
      })
      .execute()
    // The participants are a second statement inside the same transaction, so a session and the
    // people in it commit together: a reader can never see a conversation with nobody in it.
    await writeParticipants(exec, record.id, record.agents)
    await recordSessionChanges(exec, record.userId, [record.id])
  }
  return {
    /** Reserve the next globally unique `LOCALIX-<seq>` ref. */
    async allocateSessionRef(_userId: string): Promise<{ seq: number; id: string }> {
      const seq = await nextRefSeq(db, 'agent_sessions')
      return { seq, id: sessionRef(seq) }
    },

    /**
     * Insert a session and claim its addressable agent name in the same transaction.
     *
     * The transaction is here for the claim, not the insert: see `claimSessionIdentity`. The name the
     * caller ends up with is read back through the session row (`mapSession`) rather than returned,
     * the same way `seq` is — every creation path already re-reads the row it just wrote
     * (`createSession` returns `getSessionDetail`), so a second channel for the same fact would just
     * be one more thing that can disagree with the database.
     */
    async insertSession(record: SessionRecord): Promise<void> {
      await retrySqliteBusy(() =>
        db
          .transaction()
          .execute(async (trx) =>
            insertSessionRecord(trx, record, await claimSessionIdentity(trx, record)),
          ),
      )
    },

    getOrCreateExternalSession: createExternalSessionWriter(db, async (trx, record) => {
      await insertSessionRecord(trx, record, await claimSessionIdentity(trx, record))
    }),

    async updateSession(userId: string, id: string, patch: Partial<SessionRecord>): Promise<void> {
      await retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          // Membership belongs to the owned session, and both changes must commit together.
          // Checking only the UPDATE predicate would still let the membership writer mutate a
          // foreign row.
          const owned = await trx
            .selectFrom('agent_sessions')
            .select('id')
            .where('user_id', '=', userId)
            .where('id', '=', id)
            .executeTakeFirst()
          if (!owned) return
          await recordSessionChanges(trx, userId, [id])
          const rowPatch = sessionRowPatch(patch)
          if (Object.keys(rowPatch).length > 0)
            await trx
              .updateTable('agent_sessions')
              .set(rowPatch)
              .where('user_id', '=', userId)
              .where('id', '=', id)
              .execute()
          // The party is its own table, so it is its own statement. Passing it states WHO is in
          // the conversation; omitting it leaves the party alone, like every other absent patch
          // field. What the people who stay run on is NEVER written here — the record being
          // patched was read with its routes already resolved, so re-stating them would launder
          // an inherited model into an explicit choice (see `writeMembership`). A deliberate
          // re-route is its own verb: `updateSessionAgentRoute`.
          if (patch.agents !== undefined) await writeMembership(trx, id, patch.agents)
          // A mode is the TREE's: a child run reads its own row, so a root that changed mode while
          // its children kept the old one would leave a delegated worker writing in plan mode.
          if (patch.permissionMode !== undefined)
            await trx
              .updateTable('agent_sessions')
              .set({ permission_mode: patch.permissionMode })
              .where('user_id', '=', userId)
              .where('root_session_id', '=', id)
              .execute()
        }),
      )
    },

    /**
     * Change WHO is in a conversation — only if nobody changed the session since it was read.
     *
     * Two editors used to race silently: the composer sent a whole participant list read seconds
     * earlier, an agent's reply tagged someone in between, and the later write
     * erased the invitation. The check and the write share one transaction, so a stale list is
     * refused (`false`) instead of applied. `expectedUpdatedAt` absent means the caller read the
     * session inside the same request and accepts any revision.
     */
    async updateMembership(
      userId: string,
      id: string,
      agents: SessionRecord['agents'],
      stamp: { updatedAt: string; expectedUpdatedAt?: string },
    ): Promise<boolean> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('agent_sessions')
            .select('updated_at')
            .where('user_id', '=', userId)
            .where('id', '=', id)
            .executeTakeFirst()
          if (!row) return false
          if (stamp.expectedUpdatedAt !== undefined && row.updated_at !== stamp.expectedUpdatedAt)
            return false
          await trx
            .updateTable('agent_sessions')
            .set({ updated_at: stamp.updatedAt })
            .where('user_id', '=', userId)
            .where('id', '=', id)
            .execute()
          await writeMembership(trx, id, agents)
          return true
        }),
      )
    },

    /**
     * Re-route ONE participant of one session.
     *
     * Separate from `updateSession` because it is a different act: that one replaces the whole
     * party, which is what adding or removing a member means, while this changes what a member
     * already in the room runs on. Sending a whole-party replacement for a model change would
     * make the picker able to silently drop a participant.
     */
    async updateSessionAgentRoute(
      userId: string,
      id: string,
      agentId: string,
      route: Partial<ModelRoute>,
      opts?: { seeded?: boolean },
    ): Promise<void> {
      // Ownership is checked here rather than inside the participant writer: `conversation_participants` has no
      // user column of its own — it is owned through its session, and this is the seam that
      // knows that.
      const owned = await db
        .selectFrom('agent_sessions')
        .select('id')
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()
      if (!owned) return
      await writeAgentRoute(db, id, agentId, route, opts)
    },

    /**
     * The person's model choice for the named agents, seated or not — seats and choice map in
     * ONE transaction (`repository-model-choices.ts`).
     */
    updateSessionAgentRoutes: (
      userId: string,
      id: string,
      routes: readonly ({ agentId: string } & Partial<ModelRoute>)[],
    ): Promise<void> => writeModelChoices(db, userId, id, routes),

    /**
     * Replace the generated fallback title only while it is still current.
     * This is deliberately a single conditional write so a user rename that
     * races background title generation is never overwritten.
     */
    async updateTitleIfCurrent(
      userId: string,
      id: string,
      expectedTitle: string,
      title: string,
      goal?: string,
      expectedGoal?: string | null,
    ): Promise<boolean> {
      const result = await db
        .updateTable('agent_sessions')
        .set({ title, ...(goal !== undefined ? { goal } : {}) })
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .where('title', '=', expectedTitle)
        .$if(goal !== undefined, (query) =>
          query
            .where('goal', expectedGoal == null ? 'is' : '=', expectedGoal ?? null)
            .where('previous_topic_summary', 'is', null),
        )
        .executeTakeFirst()
      const updated = Number(result.numUpdatedRows) === 1
      if (updated) {
        await recordSessionChanges(db, userId, [id])
      }
      return updated
    },

    async deleteSession(
      userId: string,
      id: string,
      stoppedSessionIds: readonly string[],
    ): Promise<void> {
      // No FK cascades in the schema — clean up children (jobs/sub-agents) and all
      // messages explicitly so deleting a session never leaves dangling rows.
      await db.transaction().execute(async (trx) => {
        const sessionIds = await sessionSubtreeForDeletion(id, async (parentId) => {
          const children = await trx
            .selectFrom('agent_sessions')
            .select('id')
            .where('user_id', '=', userId)
            .where('parent_session_id', '=', parentId)
            .execute()
          return children.map((child) => child.id)
        })
        const stopped = new Set(stoppedSessionIds)
        if (
          sessionIds.length !== stopped.size ||
          sessionIds.some((sessionId) => !stopped.has(sessionId))
        ) {
          throw new Error('Session tree changed during deletion; retry after stopping the new tree')
        }
        await trx
          .deleteFrom('agent_messages')
          .where('user_id', '=', userId)
          .where('session_id', 'in', sessionIds)
          .execute()
        await trx
          .deleteFrom('agent_sessions')
          .where('user_id', '=', userId)
          .where('id', 'in', sessionIds)
          .execute()
        // The search index is a virtual table: no foreign key reaches it.
        await deleteSessionChunks(trx, userId, sessionIds)
        // Each chat's messages go with it (`CORE_CASCADES`).
        await recordSessionChanges(trx, userId, sessionIds, 'deleted')
      })
    },
  }
}
