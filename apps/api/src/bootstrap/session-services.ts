/**
 * The per-session support services that hang off chat: the push of a session's running work and
 * of its open queued questions, the consequence of each question's close, the conversation's
 * plan and its comments, and the inspector editor's LSP document service.
 *
 * Separate from `./engines` because they are not engines and nothing downstream receives them:
 * each is constructed for its side effect — a subscription, or a service landing in `serviceRefs`
 * where chat picks it up lazily. What they share is the reason they cannot be built with chat
 * itself — both need the finished `chatService` (its cwd resolution, its stream registry), so they
 * can only be wired after it exists. That is the seam, and it is the whole of this module's job.
 */
import { createLspDocumentService } from '../features/lsp'
import type { createChatService } from '../features/chat/service'
import { sessionWork } from '../features/chat/runtime/work-view'
import { sessionQuestions } from '../features/chat/runtime/question-view'
import { createCommentRepository } from '../features/comments/repository'
import { createPlanRepository } from '../features/plans/repository'
import { createPlanService } from '../features/plans/service'
import { createPlanFiles, planRef } from '../features/plans/plan-files'
import { planResumeProducer } from '../features/plans/resume-point'
import { createResumeRegistry } from '../features/resume/registry'
import { invalidateFileMtime } from '../features/agent-core/tools/file/file-mtime'
import type { TriggersWiringInput } from './triggers'
import type { InfraPhase } from './infra'
import type { DomainServicesPhase } from './domain-services'

export interface SessionServicesInput
  extends
    Pick<InfraPhase, 'db' | 'serviceRefs' | 'work' | 'questions' | 'agentNotifications'>,
    Pick<DomainServicesPhase, 'lspManager'> {
  chatService: ReturnType<typeof createChatService>
  wakes: TriggersWiringInput['wakes']
}

export function wireSessionServices({
  db,
  serviceRefs,
  chatService,
  lspManager,
  work,
  questions,
  wakes,
  agentNotifications,
}: SessionServicesInput): void {
  // The conversation's plan and the person's comments on it (`features/plans`). An approval
  // changes the root session's mode through chat's own update path — so the tree cascade and
  // the session push happen as for any mode change — and every decision reaches the agent
  // through the one wake delivery.
  // Each step also writes its one conversation line through chat's notice writer, and moves the
  // version's attention item (and so its journal row) through the plan's attention source.
  const planSignals = agentNotifications.plans
  // "Continue" (`features/resume`): one registry, its producers read at call time. The plan is
  // the first producer — an approved version nobody is working on — and every change to the
  // plans re-pushes the points (below), so a composer's Continue follows approve/complete/dismiss.
  const resume = createResumeRegistry({
    producers: () => (serviceRefs.plans ? [planResumeProducer(serviceRefs.plans)] : []),
    wake: (...args) => wakes.deliver(...args),
    notice: ({ userId, sessionId }, notice) =>
      chatService.recordSessionNotice(userId, sessionId, notice),
    publish: ({ userId, sessionId }, points) =>
      chatService.streamRegistry.publish(userId, sessionId, {
        type: 'session_resume.updated',
        sessionId,
        points,
      }),
  })
  serviceRefs.resume = resume
  serviceRefs.comments = createCommentRepository(db)
  serviceRefs.plans = createPlanService({
    repo: createPlanRepository(db),
    comments: serviceRefs.comments,
    // The draft and snapshots sit in the ROOT session's working dir and are read and written
    // through its execution environment, as the file viewer does — so an ssh/docker session's
    // plan is on that machine. A host write forgets the path in every session's read record, as
    // an editor save does: the agent's next `edit` of a draft the host rewrote must re-read it.
    files: createPlanFiles({
      open: async ({ userId, sessionId }) => {
        const { session, env, dir } = await chatService.sessionEnvironment(userId, sessionId)
        return {
          cwd: dir,
          rootRef: planRef(session),
          env: {
            readFile: (...args) => env.readFile(...args),
            writeFile: async (...args) => {
              await env.writeFile(...args)
              invalidateFileMtime(args[0])
            },
          },
        }
      },
    }),
    publish: (owner, plans) => {
      chatService.streamRegistry.publish(owner.userId, owner.sessionId, {
        type: 'plan.updated',
        sessionId: owner.sessionId,
        plans,
      })
      void resume.changed(owner).catch(() => undefined)
    },
    presented: ({ userId, sessionId }, plan) =>
      chatService.streamRegistry.publish(userId, sessionId, {
        type: 'plan.presented',
        sessionId,
        planId: plan.id,
        version: plan.version,
      }),
    setMode: async ({ userId, sessionId }, mode) => {
      await chatService.updateSession(userId, sessionId, { permissionMode: mode })
    },
    wake: (...args) => wakes.deliver(...args),
    participants: ({ userId, sessionId }) => chatService.participantHandles(userId, sessionId),
    lifecycle: {
      notice: ({ userId, sessionId }, notice) =>
        chatService.recordSessionNotice(userId, sessionId, notice),
      authorHandle: ({ userId, sessionId }, agentId) =>
        chatService.participantHandle(userId, sessionId, agentId),
      awaiting: ({ userId }, plan, handle) => planSignals.awaiting(userId, plan, handle),
      settled: ({ userId, sessionId }, planId, reason) =>
        planSignals.settled(userId, sessionId, planId, reason),
      completed: ({ userId }, plan) => planSignals.completed(userId, plan),
    },
  })

  // The user's whole "waiting on you" set, on every change — user-wide, so published with an
  // empty session key (delivered to every socket of the user, like `plugins.changed`).
  agentNotifications.attention.onChange((userId, items) =>
    chatService.streamRegistry.publish(userId, '', {
      type: 'attention.updated',
      sessionId: '',
      items,
    }),
  )

  // Every change to a session's running work — a job, a monitor's latest event — reaches its
  // composer as the full list: the push that replaced polling the terminal registry (which saw
  // only work that happened to run in a PTY) and the monitors' own strip.
  work.onChange(({ userId, sessionId }) =>
    chatService.streamRegistry.publish(userId, sessionId, {
      type: 'session_work.updated',
      sessionId,
      work: sessionWork(work, userId, sessionId),
    }),
  )

  // The same push for the session's open queued questions — the composer's questions strip and
  // the sidebar's mark — and the ONE consequence of every close: the card shows how it ended and
  // the agent that asked hears of it (`chat/service/question-facade.ts`).
  questions.onChange(({ userId, sessionId }) =>
    chatService.streamRegistry.publish(userId, sessionId, {
      type: 'session_questions.updated',
      sessionId,
      questions: sessionQuestions(questions, userId, sessionId),
    }),
  )
  questions.onResolved(
    (record) =>
      void chatService
        .settleQuestion(record)
        .catch((error: unknown) =>
          console.warn(`[questions] settling ${record.displayId} failed`, error),
        ),
  )

  // Inspector-editor LSP document service: drives the language server from the
  // editor's UNSAVED buffer and fans per-file diagnostics back onto the session
  // firehose as `lsp.diagnostics`. Root metadata resolves through chatService's
  // ownership check without enumerating the Explorer directory.
  serviceRefs.lspDocumentService = createLspDocumentService({
    lspManager,
    resolveProjectRoot: (...args) => chatService.resolveSessionCwd(...args),
    publish: (userId, sessionId, push) =>
      chatService.streamRegistry.publish(userId, sessionId, {
        type: 'lsp.diagnostics',
        sessionId,
        file: push.file,
        diagnostics: push.diagnostics,
      }),
    // Commit a rename's WorkspaceEdit through the editor's locked, optimistic-
    // concurrency write path (file-change tracking stays coherent for the agent).
    writeFile: (...args) => chatService.writeFile(...args),
  })
}
