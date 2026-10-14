/**
 * THE QUESTION REGISTRY: the one place a session's open questions are recorded, named and closed.
 *
 *   - WHAT is open for this session? `list`, behind the one owner filter, from a live index of
 *     pending questions only — the composer, the session list and the prompt all read it on
 *     every render or turn, and none of them may cost a query;
 *   - WHAT is it called? `ask` mints `q-N` — monotonic per session and never reused, so "the
 *     answer to q-2" names one question even after q-2 was answered and a new one was asked;
 *   - WHO closes it, and how many times? `resolve` — the row is closed conditionally on still
 *     being pending, so two tabs answering at once deliver ONE answer, and the loser is told.
 *
 * The index is loaded once at boot (`hydrate`): an open question is exactly the thing that must
 * be waiting for the person after a restart, which a blocking `ask`'s in-memory promise is not.
 */
import { randomUUID } from 'node:crypto'

import { errorMessage } from '../../lib/errors'
import {
  normalizeAskAnswers,
  type AskToolAnswer,
  type AskToolQuestion,
} from '../agent-core/tools/hitl/ask'
import { QUESTION_PREFIX, type QuestionOwner, type QuestionRecord } from './contracts'
import type { QuestionRepository } from './repository'

export interface AskQuestions {
  owner: QuestionOwner
  agentId: string
  toolCallId: string
  questions: AskToolQuestion[]
}

/** How a resolve went: the closed record, or why nothing was closed. */
export type QuestionResolveResult =
  | { ok: true; record: QuestionRecord }
  | { ok: false; reason: 'not_found' | 'already_resolved' | 'empty' }

export interface QuestionRegistryDeps {
  repo: QuestionRepository
  now?: () => Date
  logger?: { warn: (msg: string) => void }
}

/**
 * Two asks are "the same question" when they ask the same things under the same ids. The ids
 * alone are not enough: models reuse generic ones (`choice`, `q1`), and matching on them let
 * "Which colour?" silently replace an unanswered "Which database?".
 */
const sameQuestion = (a: readonly AskToolQuestion[], b: readonly AskToolQuestion[]) => {
  const key = (questions: readonly AskToolQuestion[]) =>
    questions
      .map((question) => `${question.id}\u0000${question.question.trim()}`)
      .sort()
      .join('\n')
  return key(a) === key(b)
}

const laneKey = (sessionId: string, agentId: string) => JSON.stringify([sessionId, agentId])

export function createQuestionRegistry(deps: QuestionRegistryDeps) {
  const now = deps.now ?? (() => new Date())
  /** Pending questions only, by record id. Closed ones live in their rows and transcript items. */
  const pending = new Map<string, QuestionRecord>()
  const marks = new Map<string, number>()
  /**
   * Skips the asking agent has not been told of yet, by session and agent. A skip opens no turn,
   * and it takes the question out of the open list — so without this the agent learned of it only
   * if its next turn happened to call a tool, and could go on waiting for an answer that will not
   * come. The next prompt takes them (`takeSkipped`). Process-lived: the stored row and the
   * transcript card still say "skipped" after a restart.
   */
  const unseenSkips = new Map<string, QuestionRecord[]>()
  const owns = (record: QuestionRecord, owner: QuestionOwner) =>
    record.userId === owner.userId && record.sessionId === owner.sessionId

  // Subscriptions, like the work registry's: the registry is built at boot, before the stream
  // that publishes its changes and the chat that delivers its answers exist.
  const listeners = new Set<(owner: QuestionOwner) => void>()
  const changed = (owner: QuestionOwner) => {
    for (const listener of listeners)
      try {
        listener({ userId: owner.userId, sessionId: owner.sessionId })
      } catch (error) {
        deps.logger?.warn(`question change listener failed: ${errorMessage(error)}`)
      }
  }
  // Every close, whoever closed it — the person's answer or skip, or the agent re-asking. ONE
  // observer delivers the consequence (the card's new state, the agent's wake), so an ending
  // added later cannot reach the transcript without reaching the agent, or the other way round.
  const askedListeners = new Set<(record: QuestionRecord) => void>()
  const resolvedListeners = new Set<(record: QuestionRecord) => void>()
  const announce = (listeners: Set<(record: QuestionRecord) => void>, record: QuestionRecord) => {
    for (const listener of listeners)
      try {
        listener(record)
      } catch (error) {
        deps.logger?.warn(`question listener failed: ${errorMessage(error)}`)
      }
  }

  const mint = (sessionId: string): string => {
    const n = (marks.get(sessionId) ?? 0) + 1
    marks.set(sessionId, n)
    return `${QUESTION_PREFIX}-${n}`
  }

  const list = (owner: QuestionOwner): QuestionRecord[] =>
    [...pending.values()].filter((record) => owns(record, owner))

  /** Close a pending question. The row decides — the index only follows it. */
  const close = async (
    record: QuestionRecord,
    status: 'answered' | 'skipped' | 'superseded',
    answers: AskToolAnswer[] | null,
  ): Promise<QuestionResolveResult> => {
    const resolvedAt = now().toISOString()
    const closed = await deps.repo.resolve(record.id, { status, answers, resolvedAt })
    pending.delete(record.id)
    changed(record)
    if (!closed) return { ok: false, reason: 'already_resolved' }
    const resolved: QuestionRecord = { ...record, status, answers, resolvedAt }
    if (status === 'skipped') {
      const key = laneKey(record.sessionId, record.agentId)
      unseenSkips.set(key, [...(unseenSkips.get(key) ?? []), resolved])
    }
    announce(resolvedListeners, resolved)
    return { ok: true, record: resolved }
  }

  return {
    /** Once at boot, before any run can ask: learn the ids already spent and load what is open. */
    async hydrate(): Promise<void> {
      for (const mark of await deps.repo.highWaterMarks()) marks.set(mark.sessionId, mark.n)
      for (const record of await deps.repo.listPending()) pending.set(record.id, record)
    },

    /**
     * Record a question and answer its id. Asking again what this agent already has open — the
     * same question ids — SUPERSEDES the open one rather than stacking a duplicate: the agent
     * re-asking is it rewording, and the person should see one card, the latest.
     */
    async ask(input: AskQuestions): Promise<{ record: QuestionRecord; superseded: string[] }> {
      const replaced = list(input.owner).filter(
        (record) =>
          record.agentId === input.agentId && sameQuestion(record.questions, input.questions),
      )
      const record: QuestionRecord = {
        id: randomUUID(),
        userId: input.owner.userId,
        sessionId: input.owner.sessionId,
        agentId: input.agentId,
        displayId: mint(input.owner.sessionId),
        toolCallId: input.toolCallId,
        questions: input.questions,
        status: 'pending',
        answers: null,
        askedAt: now().toISOString(),
        resolvedAt: null,
      }
      await deps.repo.insert(record)
      pending.set(record.id, record)
      // Only what this call actually closed: one answered in the same moment is not "replaced",
      // and its answer reaches the agent on its own.
      const superseded: string[] = []
      for (const old of replaced)
        if ((await close(old, 'superseded', null)).ok) superseded.push(old.displayId)
      changed(input.owner)
      announce(askedListeners, record)
      return { record, superseded }
    },

    /** Answers recorded but never admitted as a wake — see `listUndeliveredAnswers`. */
    undeliveredAnswers: (horizon: string) => deps.repo.listUndeliveredAnswers(horizon),

    /** The skips this agent has not been told of — taken once, by the prompt that tells it. */
    takeSkipped(owner: QuestionOwner, agentId: string): QuestionRecord[] {
      const key = laneKey(owner.sessionId, agentId)
      const skipped = unseenSkips.get(key) ?? []
      unseenSkips.delete(key)
      return skipped.filter((record) => record.userId === owner.userId)
    },

    /**
     * The person answered. Only a pending question of THIS owner can be answered, and what is
     * stored is held to the question's own options — the rule a live `ask` applies to its answer.
     */
    async answer(
      owner: QuestionOwner,
      displayId: string,
      submitted: readonly AskToolAnswer[],
    ): Promise<QuestionResolveResult> {
      const record = list(owner).find((candidate) => candidate.displayId === displayId)
      if (!record) return { ok: false, reason: 'not_found' }
      const answers = normalizeAskAnswers(record, submitted)
      // An answer naming none of the questions asked would wake the agent to "(no answer)".
      if (answers.length === 0) return { ok: false, reason: 'empty' }
      return close(record, 'answered', answers)
    },

    /**
     * A question by the id the agent was told, OPEN OR CLOSED, of this owner only — what a re-ask
     * (`ask` with `from`) recalls instead of making the agent write the question out again.
     */
    async find(owner: QuestionOwner, displayId: string): Promise<QuestionRecord | null> {
      const open = list(owner).find((candidate) => candidate.displayId === displayId)
      if (open) return open
      const stored = await deps.repo.findByDisplayId(owner.sessionId, displayId)
      return stored && owns(stored, owner) ? stored : null
    },

    /** The agent replaced an open question itself — it is now asking it another way. */
    async supersede(owner: QuestionOwner, displayId: string): Promise<QuestionResolveResult> {
      const record = list(owner).find((candidate) => candidate.displayId === displayId)
      if (!record) return { ok: false, reason: 'not_found' }
      return close(record, 'superseded', null)
    },

    /** The person declined to answer. */
    async skip(owner: QuestionOwner, displayId: string): Promise<QuestionResolveResult> {
      const record = list(owner).find((candidate) => candidate.displayId === displayId)
      if (!record) return { ok: false, reason: 'not_found' }
      return close(record, 'skipped', null)
    },

    /** The session's open questions, oldest first. THE owner filter. */
    list,

    /** Every open question of every user — what a boot rebuilds the attention set from. */
    listAllPending: (): QuestionRecord[] => [...pending.values()],

    /** Called with the owning session each time its set of open questions changes. */
    onChange(listener: (owner: QuestionOwner) => void): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    /** Called once per question asked — never for one a boot reloads. */
    onAsked(listener: (record: QuestionRecord) => void): () => void {
      askedListeners.add(listener)
      return () => void askedListeners.delete(listener)
    },

    /** Called once per question that closed — answered, skipped or superseded. */
    onResolved(listener: (record: QuestionRecord) => void): () => void {
      resolvedListeners.add(listener)
      return () => void resolvedListeners.delete(listener)
    },

    /** The session was deleted; its rows went with the foreign-key cascade. */
    forgetSession(sessionId: string): void {
      for (const [id, record] of pending) if (record.sessionId === sessionId) pending.delete(id)
      for (const key of unseenSkips.keys())
        if ((JSON.parse(key) as string[])[0] === sessionId) unseenSkips.delete(key)
      marks.delete(sessionId)
    },
  }
}

export type QuestionRegistry = ReturnType<typeof createQuestionRegistry>
