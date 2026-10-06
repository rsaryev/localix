/// <reference types="bun" />

import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { StoredMessagePayload } from '../../db/payload'
import { createProviderConnectionsService } from '../provider-connections/service'
import { createProjectsRepository } from '../projects/repository'
import { createChatRepository } from './repository'
import {
  createTestCatalogService as createCatalogService,
  createTestChatService as createChatService,
} from './test-runtime'
import type { AgentRunner } from './runtime/agent-runner'
import { noLeadership } from './runtime/conversation-strategy'
import type { PersistedMessage } from './contracts'
import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../db'
import { testWork } from '../../testing/work-fixture'

const tempDir = join(process.cwd(), 'tmp', 'chat-service-tests')

/**
 * Wait for a fire-and-forget turn to reach the runner double. An enqueue carries no history, so
 * the test runtime's stand-in dispatcher reads the transcript first (as the real one does), and
 * the run starts only after that read — not inside the call that queued it.
 */
async function eventually(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached before the deadline')
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe('chat service', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('resolves owned session cwd without enumerating the Explorer root', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const userId = 'user_session_cwd'
    const projectId = 'project_session_cwd'
    const missingWorkingDir = join(tempDir, randomUUID(), 'not-created')
    await createProjectsRepository(db).insertProject({
      id: projectId,
      userId,
      name: 'Missing root is valid metadata',
      workingDir: missingWorkingDir,
      settings: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    })
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const session = await chatService.createSession(userId, {
      title: 'Cwd metadata',
      projectId,
    })

    expect(await chatService.resolveSessionCwd(userId, session.id)).toBe(missingWorkingDir)
    expect(await chatService.resolveSessionWorkspaceMetadata(userId, session.id)).toEqual({
      rootPath: missingWorkingDir,
      projectId,
    })
    expect(chatService.resolveSessionCwd('another-user', session.id)).rejects.toMatchObject({
      code: 'session_not_found',
    })
    expect(
      chatService.resolveSessionWorkspaceMetadata('another-user', session.id),
    ).rejects.toMatchObject({
      code: 'session_not_found',
    })
    // The old `listDirectory(...).path` adapter cannot resolve this metadata:
    // it attempts a real readdir/remote ls and therefore rejects a missing root.
    expect(chatService.listDirectory(userId, session.id)).rejects.toMatchObject({
      code: 'not_a_directory',
    })
    await destroyDatabase(db)
  })

  test('job sessions expose computed bash source runtime context', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_job_runtime'

    const parent = await chatService.createSession(userId, { title: 'Parent chat' })
    const timestamp = new Date().toISOString()
    const toolCallId = 'tool_job_1'
    const payload: StoredMessagePayload = {
      id: 'msg_parent_1',
      role: 'assistant',
      from: DEFAULT_AGENT_PARTICIPANT,
      content: '',
      items: [
        {
          id: toolCallId,
          type: 'command',
          status: 'running',
          toolCallId,
          name: 'bash',
          command: 'npm run dev',
          input: {
            command: 'npm run dev',
            cwd: '/workspace/app',
            background: true,
            description: 'Start app server',
          },
        },
      ],
    }

    await repo.insertMessage({
      id: payload.id,
      sessionId: parent.id,
      userId,
      payload,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const job = await chatService.createSession(userId, {
      title: 'Job child',
      parentSessionId: parent.id,
      rootSessionId: parent.id,
      sessionKind: 'job',
      sourceToolCallId: toolCallId,
    })

    expect(job.sourceRuntime).toEqual({
      toolCallId,
      toolName: 'bash',
      title: 'Start app server',
      command: 'npm run dev',
      cwd: '/workspace/app',
      description: 'Start app server',
      isBackground: true,
    })

    await destroyDatabase(db)
  })

  test('captures db resources once, persists the immutable snapshot, and regenerate replays it without resolving again', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const histories: unknown[] = []
    const runSurfaces: unknown[] = []
    const runner = {
      isRunning: () => false,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => false,
      stop: () => false,
      executeToolAction: () => false,
      wake: () => {},
      listQueued: () => [],
      removeQueued: () => false,
      async run(input: {
        historyMessages: unknown[]
        scope: { executionContext: { clientSurface?: unknown } }
      }) {
        histories.push(input.historyMessages)
        runSurfaces.push(input.scope.executionContext.clientSurface)
      },
    } as unknown as AgentRunner
    let captureCalls = 0
    const capture = {
      status: 'resolved' as const,
      capturedAt: '2026-07-12T00:00:00.000Z',
      contributions: [
        {
          id: 'c1',
          providerId: 'fixture:context',
          providerVersion: '1',
          scope: 'session' as const,
          kind: 'database-schema',
          content: 'CREATE TABLE users()',
          revision: 'r1',
          sensitivity: 'project' as const,
        },
      ],
    }
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
      resolveContextBindings: async (_userId, _session, bindings) => {
        captureCalls += 1
        return new Map(bindings.map((binding) => [binding.id, capture]))
      },
    })
    const repo = createChatRepository(db)
    const userId = 'user_fabric_capture'
    const session = await chatService.createSession(userId, { title: 'Fabric capture' })
    await chatService.sendMessage(
      userId,
      session.id,
      'inspect @resource:localix://resource/fixture-db/c/users',
      [
        {
          kind: 'context',
          id: 'r1',
          source: 'mention',
          target: {
            kind: 'resource',
            token: '@resource:localix://resource/fixture-db/c/users',
            label: '@resource:localix://resource/fixture-db/c/users',
            uri: 'localix://resource/fixture-db/c/users',
          },
          resolution: { status: 'pending', contributions: [] },
        },
      ],
    )
    const firstUser = (await repo.listMessages(userId, session.id)).find(
      (message) => message.payload.role === 'user',
    )
    expect(captureCalls).toBe(1)
    expect(firstUser?.payload.bindings?.[0]).toMatchObject({
      kind: 'context',
      resolution: {
        status: 'resolved',
        capturedAt: capture.capturedAt,
        contributions: capture.contributions,
      },
    })

    const toolSurface = {
      capabilities: ['workbench-ui'],
      catalogs: { 'workbench-ui': 'ui1_regenerate' },
    }
    await chatService.regenerate(userId, session.id, toolSurface)
    await eventually(() => histories.length >= 2)
    expect(captureCalls).toBe(1)
    expect(histories).toHaveLength(2)
    expect(runSurfaces).toEqual([undefined, toolSurface])
    const replay = histories[1] as PersistedMessage[]
    expect(replay[0]?.payload.bindings).toEqual(firstUser?.payload.bindings)
    await destroyDatabase(db)
  })

  test('subagent sessions expose computed delegate source runtime context', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_delegate_runtime'

    const parent = await chatService.createSession(userId, { title: 'Parent chat' })
    const timestamp = new Date().toISOString()
    const toolCallId = 'tool_delegate_1'
    const payload: StoredMessagePayload = {
      id: 'msg_parent_2',
      role: 'assistant',
      from: DEFAULT_AGENT_PARTICIPANT,
      content: '',
      items: [
        {
          id: toolCallId,
          type: 'tool_call',
          status: 'running',
          toolCallId,
          name: 'agents',
          activeVerb: 'Delegating',
          input: { action: 'delegate', agent: '@frontend', title: 'Build UI', prompt: 'Build it.' },
        },
      ],
    }

    await repo.insertMessage({
      id: payload.id,
      sessionId: parent.id,
      userId,
      payload,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const child = await chatService.createSession(userId, {
      title: 'Delegate child',
      parentSessionId: parent.id,
      rootSessionId: parent.id,
      sessionKind: 'subagent',
      sourceToolCallId: toolCallId,
      provenance: {
        kind: 'task-delegation',
        parentSessionId: parent.id,
        toolCallId,
      },
    })

    expect(child.sourceRuntime).toEqual({
      toolCallId,
      toolName: 'agents',
    })

    await destroyDatabase(db)
  })

  test('a send while the session is busy is QUEUED, not rejected', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    let active = false
    let runCalls = 0
    let wakeCalls = 0
    let queuedClientMessageId: string | undefined
    const runner = {
      isRunning: () => active,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => active,
      stop: () => {
        active = false
        return true
      },
      executeToolAction: () => false,
      // The busy path enqueues via runner.wake instead of throwing 409. The mock
      // keeps `active` true (the first run never finishes here), so the queued
      // turn just sits there — exactly what we assert.
      wake: (input: { clientMessageId?: string }) => {
        wakeCalls += 1
        queuedClientMessageId = input.clientMessageId
      },
      listQueued: () => [],
      removeQueued: () => false,
      // The first turn is admitted through the enqueue, which marks the session busy at once —
      // as the real queue does by holding the drain lease — so the second send sees it busy.
      async enqueueRun() {
        runCalls += 1
        active = true
      },
    } as unknown as AgentRunner

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
    })
    const repo = createChatRepository(db)
    const userId = 'user_concurrent_send'
    const session = await chatService.createSession(userId, { title: 'Race test' })

    const results = await Promise.allSettled([
      chatService.sendMessage(userId, session.id, 'first'),
      chatService.sendMessage(
        userId,
        session.id,
        'second',
        undefined,
        undefined,
        undefined,
        undefined,
        'optimistic-second',
      ),
    ])

    // BOTH resolve now — the second is queued behind the first, never a 409.
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(runCalls).toBe(1) // only the first turn started a run
    expect(wakeCalls).toBe(1) // the second was queued
    expect(queuedClientMessageId).toBe('optimistic-second')
    // Only the first turn created persisted slots; the queued one drains later.
    const messages = await repo.listMessages(userId, session.id)
    expect(messages.map((message) => message.payload.role)).toEqual(['user', 'assistant'])

    await destroyDatabase(db)
  })

  test('send-now delegates one selected queue id only after the ownership gate', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const calls: Array<[string, string, string]> = []
    const runner = {
      isRunning: () => true,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => true,
      stop: () => true,
      executeToolAction: () => false,
      wake: () => {},
      listQueued: () => [],
      removeQueued: () => false,
      interruptAndPromoteQueued: (userId: string, sessionId: string, itemId: string) => {
        calls.push([userId, sessionId, itemId])
        return { promoted: true as const }
      },
      async run() {},
    } as unknown as AgentRunner
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
    })
    const owner = 'queue_owner'
    const session = await chatService.createSession(owner, { title: 'Atomic queue action' })

    expect(
      chatService.interruptAndPromoteQueuedMessage('someone_else', session.id, 'q1'),
    ).rejects.toThrow()
    expect(calls).toEqual([])

    expect(await chatService.interruptAndPromoteQueuedMessage(owner, session.id, 'q1')).toEqual({
      promoted: true,
    })
    expect(calls).toEqual([[owner, session.id, 'q1']])
    await destroyDatabase(db)
  })

  // Context is checkpointed by the runtime on its own, so there is no command to shrink it by
  // hand. A typed `/compact` must fail closed like any unknown command — never queue, never run,
  // and never reach the model as a prompt.
  test('/compact no longer exists: it fails closed on a busy session and queues nothing', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    let runCalls = 0
    const runner = {
      isRunning: () => true,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => true,
      stop: () => true,
      executeToolAction: () => false,
      wake: async () => {},
      listQueued: async () => [],
      removeQueued: async () => ({ removed: false, reason: 'not_found' as const }),
      async run() {
        runCalls += 1
      },
    } as unknown as AgentRunner

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
    })
    const userId = 'user_removed_compact'
    const session = await chatService.createSession(userId, { title: 'Removed compact' })

    const result = await chatService.sendMessage(userId, session.id, '/compact keep the plan')

    expect(runCalls).toBe(0)
    expect((result as { queued?: boolean }).queued).not.toBe(true)
    const messages = await createChatRepository(db).listMessages(userId, session.id)
    expect(messages.map((message) => message.payload.role)).toEqual(['assistant'])
    expect(messages[0]?.payload.content).toContain('Unknown slash command `/compact`')

    await destroyDatabase(db)
  })

  test('unknown slash commands fail closed with a catalog suggestion instead of reaching the model', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    let runCalls = 0
    const runner = {
      isRunning: () => false,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => false,
      stop: () => false,
      executeToolAction: () => false,
      wake: async () => {},
      listQueued: async () => [],
      removeQueued: async () => ({ removed: false, reason: 'not_found' as const }),
      async run() {
        runCalls += 1
      },
    } as unknown as AgentRunner
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
    })
    const userId = 'user_unknown_slash'
    const session = await chatService.createSession(userId, { title: 'Unknown slash' })

    await chatService.sendMessage(userId, session.id, '/claer preserve constraints')

    expect(runCalls).toBe(0)
    const messages = await createChatRepository(db).listMessages(userId, session.id)
    expect(messages.map((message) => message.payload.role)).toEqual(['assistant'])
    expect(messages[0]?.payload).toMatchObject({
      uiOnly: true,
      commandOutput: { command: '/claer', tone: 'neutral' },
    })
    expect(messages[0]?.payload.content).toContain('Unknown slash command `/claer`')
    expect(messages[0]?.payload.content).toContain('Did you mean `/clear`')

    await destroyDatabase(db)
  })

  test('client-only slash commands unsupported by a surface are reported, while paths remain prompts', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const prompts: string[] = []
    const runner = {
      isRunning: () => false,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => false,
      stop: () => false,
      executeToolAction: () => false,
      wake: async () => {},
      listQueued: async () => [],
      removeQueued: async () => ({ removed: false, reason: 'not_found' as const }),
      async run(params: { historyMessages: Array<{ payload: { content?: string } }> }) {
        const lastUser = [...params.historyMessages]
          .reverse()
          .find((message) => message.payload.content === '/tmp/project')
        if (lastUser?.payload.content) prompts.push(lastUser.payload.content)
      },
    } as unknown as AgentRunner
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
    })
    const userId = 'user_client_slash'
    const session = await chatService.createSession(userId, { title: 'Client slash' })

    await chatService.sendMessage(userId, session.id, '/fork')
    await chatService.sendMessage(userId, session.id, '/tmp/project')

    const messages = await createChatRepository(db).listMessages(userId, session.id)
    expect(messages[0]?.payload).toMatchObject({
      uiOnly: true,
      commandOutput: { command: '/fork' },
    })
    expect(messages[0]?.payload.content).toContain(
      'Command `/fork` must be handled by a compatible client',
    )
    expect(prompts).toEqual(['/tmp/project'])

    await destroyDatabase(db)
  })

  test('sendMessage resolves context bindings once, keeping the prompt as typed', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    let runCalls = 0
    const runner = {
      isRunning: () => false,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => false,
      stop: () => false,
      executeToolAction: () => false,
      wake: () => {},
      listQueued: () => [],
      removeQueued: () => false,
      async run() {
        runCalls += 1
      },
    } as unknown as AgentRunner

    const expandedFor: unknown[] = []
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
      resolveContextBindings: async (_userId, _session, bindings) => {
        expandedFor.push(bindings)
        return new Map(
          bindings.map((binding) => [
            binding.id,
            {
              status: 'resolved' as const,
              contributions: [
                {
                  id: `c-${binding.id}`,
                  providerId: 'localix.context',
                  providerVersion: '1',
                  scope: 'session' as const,
                  kind: binding.target.kind,
                  content: `content-of ${binding.target.token}`,
                  sensitivity: 'project' as const,
                },
              ],
            },
          ]),
        )
      },
    })
    const repo = createChatRepository(db)
    const userId = 'user_quiet_links'
    const session = await chatService.createSession(userId, { title: 'Quiet links' })

    const prompt = 'please look at @file:a.ts and @diff'
    await chatService.sendMessage(userId, session.id, prompt, [
      {
        kind: 'context',
        id: 'file-a',
        source: 'mention',
        target: {
          kind: 'file',
          token: '@file:a.ts',
          label: '@file:a.ts',
          attributes: { path: 'a.ts' },
        },
        resolution: { status: 'pending', contributions: [] },
      },
      {
        kind: 'context',
        id: 'diff',
        source: 'mention',
        target: { kind: 'diff', token: '@diff', label: '@diff' },
        resolution: { status: 'pending', contributions: [] },
      },
    ])

    await eventually(() => runCalls >= 1)
    expect(runCalls).toBe(1)
    expect(expandedFor).toHaveLength(1)
    const messages = await repo.listMessages(userId, session.id)
    const user = messages.find((m) => m.payload.role === 'user')
    // The persisted text is EXACTLY what the user typed — no fenced blocks.
    expect(user?.payload.content).toBe(prompt)
    const contextBindings = (user?.payload.bindings ?? []).filter(
      (binding) => binding.kind === 'context',
    )
    expect(contextBindings.map((binding) => binding.target.token)).toEqual(['@file:a.ts', '@diff'])
    expect(contextBindings[0]?.resolution).toMatchObject({ status: 'resolved' })
    expect(contextBindings[0]?.resolution.contributions[0]?.content).toContain(
      'content-of @file:a.ts',
    )

    await destroyDatabase(db)
  })

  test('a Retry names its reply, and a regenerate refuses once that reply is not the latest', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_retry_target'
    const session = await chatService.createSession(userId, { title: 'Retry target' })
    const at = new Date().toISOString()
    const insert = (id: string, role: 'user' | 'assistant', content: string) =>
      repo.insertMessage({
        id,
        sessionId: session.id,
        userId,
        payload:
          role === 'user'
            ? { id, role, from: USER_PARTICIPANT, content }
            : { id, role, from: DEFAULT_AGENT_PARTICIPANT, content },
        createdAt: at,
        updatedAt: at,
      })
    await insert('u1', 'user', 'first')
    await insert('failed_reply', 'assistant', '')
    await insert('u2', 'user', 'second')
    await insert('newer_reply', 'assistant', 'newer work')

    // The failed run is still in the transcript, but a newer reply came after it.
    await expect(
      chatService.regenerate(userId, session.id, undefined, 'failed_reply'),
    ).rejects.toMatchObject({ status: 409, code: 'regenerate_superseded' })
    // A run that never wrote a reply cannot be regenerated either — the latest reply is not it.
    await expect(
      chatService.regenerate(userId, session.id, undefined, 'never_written'),
    ).rejects.toMatchObject({ status: 409, code: 'regenerate_no_reply' })
    // Neither refusal touched the transcript.
    expect((await repo.listMessages(userId, session.id)).map((m) => m.id)).toEqual([
      'u1',
      'failed_reply',
      'u2',
      'newer_reply',
    ])

    await destroyDatabase(db)
  })

  test('runtime sessions are read-only for destructive chat mutations', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_runtime_readonly'
    const parent = await chatService.createSession(userId, { title: 'Parent chat' })
    const child = await chatService.createSession(userId, {
      title: 'Readonly subagent',
      parentSessionId: parent.id,
      rootSessionId: parent.id,
      sessionKind: 'subagent',
      sourceToolCallId: 'tool_delegate_readonly',
      provenance: {
        kind: 'task-delegation',
        parentSessionId: parent.id,
        toolCallId: 'tool_delegate_readonly',
      },
    })
    const timestamp = new Date().toISOString()
    await repo.insertMessage({
      id: 'readonly_user',
      sessionId: child.id,
      userId,
      payload: { id: 'readonly_user', role: 'user', from: USER_PARTICIPANT, content: 'task' },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await repo.insertMessage({
      id: 'readonly_assistant',
      sessionId: child.id,
      userId,
      payload: {
        id: 'readonly_assistant',
        role: 'assistant',
        from: DEFAULT_AGENT_PARTICIPANT,
        content: 'result',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    expect(chatService.regenerate(userId, child.id)).rejects.toMatchObject({
      status: 409,
      code: 'runtime_session_readonly',
    })
    expect(chatService.rollback(userId, child.id, 'readonly_user')).rejects.toMatchObject({
      status: 409,
      code: 'runtime_session_readonly',
    })
    expect(
      chatService.switchBranch(userId, child.id, 'readonly_assistant', 0),
    ).rejects.toMatchObject({ status: 409, code: 'runtime_session_readonly' })

    await destroyDatabase(db)
  })

  test('branch tree, checkout, and rollback orphan cleanup', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_branch_tree'
    const session = await chatService.createSession(userId, { title: 'Branchy' })
    const ts = new Date().toISOString()
    const insert = (id: string, role: 'user' | 'assistant', content: string) =>
      repo.insertMessage({
        id,
        sessionId: session.id,
        userId,
        payload: {
          id,
          role,
          from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
          content,
        },
        createdAt: ts,
        updatedAt: ts,
      })

    await insert('u1', 'user', 'question')
    await insert('a1', 'assistant', 'first answer')
    // Regenerate-style fork: rewind the leaf to u1 and append a sibling answer.
    await repo.setSessionLeaf(session.id, 'u1')
    await insert('a2', 'assistant', 'second answer')

    const tree = await chatService.getBranchTree(userId, session.id)
    expect(tree.leafId).toBe('a2')
    expect(tree.activePath).toEqual(['u1', 'a2'])
    expect(tree.nodes.map((n) => [n.id, n.parentId])).toEqual([
      ['u1', null],
      ['a1', 'u1'],
      ['a2', 'u1'],
    ])

    // Checkout jumps the active branch to the other sibling's subtree.
    await chatService.checkoutBranch(userId, session.id, 'a1')
    const afterCheckout = await repo.listMessages(userId, session.id)
    expect(afterCheckout.map((m) => m.id)).toEqual(['u1', 'a1'])

    // Rollback of u1 must also delete a2 (sibling branch under the deleted
    // message) — not just the active path — so no orphan rows remain.
    await chatService.rollback(userId, session.id, 'u1')
    const remaining = await repo.listMessages(userId, session.id)
    expect(remaining).toEqual([])
    expect(await repo.getSessionLeaf(session.id)).toBeNull()

    await destroyDatabase(db)
  })

  test('rollback anchors the leaf at the parent, not a higher-sequence sibling branch', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_rollback_branch'
    const session = await chatService.createSession(userId, { title: 'Branchy rollback' })
    const ts = new Date().toISOString()
    const insert = (id: string, role: 'user' | 'assistant', content: string) =>
      repo.insertMessage({
        id,
        sessionId: session.id,
        userId,
        payload: {
          id,
          role,
          from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
          content,
        },
        createdAt: ts,
        updatedAt: ts,
      })

    // Branch A (lower sequence): u1 → a1 → u2 → a2
    await insert('u1', 'user', 'q1')
    await insert('a1', 'assistant', 'answer')
    await insert('u2', 'user', 'q2 — branch A')
    await insert('a2', 'assistant', 'answer A')
    // Branch B (HIGHER sequence): rewind to a1 and add a sibling user turn, now active.
    await repo.setSessionLeaf(session.id, 'a1')
    await insert('u2b', 'user', 'q2 — branch B')
    expect((await repo.listMessages(userId, session.id)).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'u2b',
    ])

    // Roll back the active branch-B user turn. Its subtree (just u2b) is removed; the
    // leaf must land on its parent a1 — NOT jump to branch A's a2 (the highest-seq survivor).
    await chatService.rollback(userId, session.id, 'u2b')
    expect(await repo.getSessionLeaf(session.id)).toBe('a1')
    expect((await repo.listMessages(userId, session.id)).map((m) => m.id)).toEqual(['u1', 'a1'])

    await destroyDatabase(db)
  })

  test('openMessageThread is idempotent and seeds a valid assistant anchor', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_message_thread'
    const session = await chatService.createSession(userId, { title: 'Parent' })
    const ts = new Date().toISOString()
    await repo.insertMessage({
      id: 'anchor_assistant',
      sessionId: session.id,
      userId,
      payload: {
        id: 'anchor_assistant',
        role: 'assistant',
        from: DEFAULT_AGENT_PARTICIPANT,
        content: 'Anchor answer',
      },
      createdAt: ts,
      updatedAt: ts,
    })

    const first = await chatService.openMessageThread(userId, session.id, 'anchor_assistant')
    const second = await chatService.openMessageThread(userId, session.id, 'anchor_assistant')
    expect(second.id).toBe(first.id)
    expect(first.parentSessionId).toBe(session.id)
    expect(first.sessionKind).toBe('chat')
    expect(first.sourceToolCallId).toBe('message-thread:anchor_assistant')
    expect((await repo.getSession(userId, first.id))?.provenance).toEqual({
      kind: 'thread',
      parentSessionId: session.id,
      phase: 'message',
    })

    const messages = await repo.listMessages(userId, first.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.payload.content).toBe('Anchor answer')
    expect(messages[0]!.id).toBe(messages[0]!.payload.id)

    await destroyDatabase(db)
  })

  test('openMessageThread rejects invalid or non-assistant anchors without creating a session', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_message_thread_invalid'
    const session = await chatService.createSession(userId, { title: 'Parent' })
    const ts = new Date().toISOString()
    await repo.insertMessage({
      id: 'user_anchor',
      sessionId: session.id,
      userId,
      payload: { id: 'user_anchor', role: 'user', from: USER_PARTICIPANT, content: 'Question' },
      createdAt: ts,
      updatedAt: ts,
    })

    expect(chatService.openMessageThread(userId, session.id, 'missing')).rejects.toMatchObject({
      status: 404,
      code: 'message_not_found',
    })
    expect(chatService.openMessageThread(userId, session.id, 'user_anchor')).rejects.toMatchObject({
      status: 400,
      code: 'message_not_threadable',
    })
    expect(
      (await repo.listSessions(userId)).filter((s) => s.parentSessionId === session.id),
    ).toHaveLength(0)

    await destroyDatabase(db)
  })

  test('forkSession copies history into an independent linked chat', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_fork'
    const session = await chatService.createSession(userId, { title: 'Original' })
    const ts = new Date().toISOString()
    const insert = (id: string, role: 'user' | 'assistant', content: string) =>
      repo.insertMessage({
        id,
        sessionId: session.id,
        userId,
        payload: {
          id,
          role,
          from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
          content,
        },
        createdAt: ts,
        updatedAt: ts,
      })

    await insert('u1', 'user', 'one')
    await insert('a1', 'assistant', 'two')
    await insert('u2', 'user', 'three')
    await insert('a2', 'assistant', 'four')

    // Fork from the middle (u2) → copy should contain u1, a1, u2 only.
    const fork = await chatService.forkSession(userId, session.id, 'u2')
    expect(fork.parentSessionId).toBe(session.id)
    expect(fork.sessionKind).toBe('chat')
    expect(fork.title).toBe(`Original (fork ${fork.seq})`)

    const forkMsgs = await repo.listMessages(userId, fork.id)
    expect(forkMsgs.map((m) => m.payload.content)).toEqual(['one', 'two', 'three'])
    // Fresh ids — independent from the source.
    expect(forkMsgs.map((m) => m.id).some((id) => ['u1', 'a1', 'u2'].includes(id))).toBe(false)
    forkMsgs.forEach((m) => expect(m.id).toBe(m.payload.id))

    // Source is untouched.
    const srcMsgs = await repo.listMessages(userId, session.id)
    expect(srcMsgs.map((m) => m.payload.content)).toEqual(['one', 'two', 'three', 'four'])

    // Omitting messageId forks the full current branch (up to the leaf).
    const full = await chatService.forkSession(userId, session.id)
    const fullMsgs = await repo.listMessages(userId, full.id)
    expect(fullMsgs.map((m) => m.payload.content)).toEqual(['one', 'two', 'three', 'four'])

    const nested = await chatService.forkSession(userId, fork.id)
    expect(nested.title).toBe(`Original (fork ${nested.seq})`)
    expect(nested.parentSessionId).toBe(fork.id)
    expect(nested.title?.match(/\(fork/g)).toHaveLength(1)

    await destroyDatabase(db)
  })

  test('editMessage replays the EDITED text and drops the stale branch', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    // Capture every history the runner is asked to replay.
    const runHistories: StoredMessagePayload[][] = []
    const runSurfaces: unknown[] = []
    const runner = {
      isRunning: () => false,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => false,
      stop: () => true,
      executeToolAction: () => false,
      wake: () => {},
      listQueued: () => [],
      removeQueued: () => false,
      async run(params: {
        historyMessages: Array<{ payload: StoredMessagePayload }>
        scope: { executionContext: { clientSurface?: unknown } }
      }) {
        runHistories.push(params.historyMessages.map((m) => m.payload))
        runSurfaces.push(params.scope.executionContext.clientSurface)
      },
    } as unknown as AgentRunner

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
    })
    const repo = createChatRepository(db)
    const userId = 'user_edit_replay'
    const session = await chatService.createSession(userId, { title: 'Edit fork' })
    const ts = new Date().toISOString()
    const insert = (
      id: string,
      role: 'user' | 'assistant',
      content: string,
      bindings?: StoredMessagePayload['bindings'],
    ) =>
      repo.insertMessage({
        id,
        sessionId: session.id,
        userId,
        payload: {
          id,
          role,
          from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
          content,
          ...(bindings?.length ? { bindings } : {}),
        },
        createdAt: ts,
        updatedAt: ts,
      })

    // A two-turn conversation. The FIRST user message carries the stale text.
    const capturedContext = {
      kind: 'context' as const,
      id: 'context-1',
      source: 'active-tab' as const,
      target: {
        kind: 'resource',
        token: '@resource:localix://resource/demo/captured',
        label: 'Captured tab',
        uri: 'localix://resource/demo/captured',
      },
      resolution: {
        status: 'resolved' as const,
        capturedAt: ts,
        contributions: [
          {
            id: 'contribution-1',
            providerId: 'demo.context',
            providerVersion: '1',
            scope: 'session' as const,
            kind: 'demo-resource',
            content: 'immutable snapshot',
            sensitivity: 'project' as const,
          },
        ],
      },
    }
    const staleInvocation = {
      kind: 'invocation' as const,
      id: 'invocation-1',
      source: 'slash' as const,
      invocation: {
        kind: 'skill' as const,
        name: 'old-skill',
        lifetime: 'turn' as const,
      },
      presentation: { label: '/old-skill' },
      instruction: 'stale executable authority',
    }
    await insert('u1', 'user', 'Render the text "Localix · Agent Harness" in the video', [
      capturedContext,
      staleInvocation,
    ])
    await insert('a1', 'assistant', 'done')
    await insert('u2', 'user', 'make it smoother')
    await insert('a2', 'assistant', 'done again')

    // Edit the FIRST user message to REMOVE the stale text. This forks a new
    // branch from u1's parent (root) and runs from the edited message.
    const toolSurface = {
      capabilities: ['workbench-ui'],
      catalogs: { 'workbench-ui': 'ui1_edit' },
    }
    await chatService.editMessage(
      userId,
      session.id,
      'u1',
      'Render a clean intro in the video',
      toolSurface,
    )

    // The runner must replay the EDITED branch, never the stale original.
    await eventually(() => runHistories.length >= 1)
    expect(runHistories).toHaveLength(1)
    expect(runSurfaces).toEqual([toolSurface])
    const replayed = runHistories[0]!
    const replayedText = replayed.map((m) => m.content).join('\n')
    expect(replayedText).not.toContain('Localix · Agent Harness')
    expect(replayedText).toContain('Render a clean intro in the video')
    // Editing the first turn discards the later turns of the old branch.
    expect(replayed.map((m) => m.role)).toEqual(['user'])
    expect(replayed[0]?.bindings).toEqual([capturedContext])
    expect(replayed[0]?.bindings).not.toContainEqual(staleInvocation)

    // The active branch the model/UI now reads must also be the edited one.
    const active = await repo.listMessages(userId, session.id)
    const activeText = active.map((m) => m.payload.content).join('\n')
    expect(activeText).not.toContain('Localix · Agent Harness')
    expect(activeText).toContain('Render a clean intro in the video')
    expect(active[0]?.payload.bindings).toEqual([capturedContext])
    expect(active[0]?.payload.bindings).not.toContainEqual(staleInvocation)

    await destroyDatabase(db)
  })

  test('editMessage forks any tree message, even off the active branch', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const runHistories: StoredMessagePayload[][] = []
    const runner = {
      isRunning: () => false,
      activeAgentId: () => undefined,
      leadership: () => noLeadership,
      listWork: () => [],
      isBusy: () => false,
      stop: () => true,
      executeToolAction: () => false,
      wake: () => {},
      listQueued: () => [],
      removeQueued: () => false,
      async run(params: { historyMessages: Array<{ payload: StoredMessagePayload }> }) {
        runHistories.push(params.historyMessages.map((m) => m.payload))
      },
    } as unknown as AgentRunner

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      runner,
    })
    const repo = createChatRepository(db)
    const userId = 'user_edit_offbranch'
    const session = await chatService.createSession(userId, { title: 'Off-branch edit' })
    const ts = new Date().toISOString()
    const insert = (id: string, role: 'user' | 'assistant', content: string) =>
      repo.insertMessage({
        id,
        sessionId: session.id,
        userId,
        payload: {
          id,
          role,
          from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
          content,
        },
        createdAt: ts,
        updatedAt: ts,
      })

    // Two sibling forks of the second user turn, both under a1.
    await insert('u1', 'user', 'first turn, no harness text')
    await insert('a1', 'assistant', 'answer 1')
    await insert('u2a', 'user', 'fork A — Localix · Agent Harness')
    await insert('a2a', 'assistant', 'answer A')
    await repo.setSessionLeaf(session.id, 'a1')
    await insert('u2b', 'user', 'fork B — clean')
    await insert('a2b', 'assistant', 'answer B')
    // Active branch is now fork B (leaf a2b); fork A (u2a) is OFF the active branch.

    // Editing the OFF-branch message u2a must NOT 404 — it forks from u2a's own
    // parent (a1) and replays u2a's ancestor chain, never fork B's history.
    const res = await chatService.editMessage(userId, session.id, 'u2a', 'fork A edited — clean')
    expect(res.sessionId).toBe(session.id)

    await eventually(() => runHistories.length >= 1)
    expect(runHistories).toHaveLength(1)
    const replayed = runHistories[0]!.map((m) => m.content)
    // Ancestor chain of u2a is u1 → a1, then the edited message — NOT fork B.
    expect(replayed).toEqual(['first turn, no harness text', 'answer 1', 'fork A edited — clean'])
    expect(replayed.join('\n')).not.toContain('Localix · Agent Harness')
    expect(replayed.join('\n')).not.toContain('fork B')

    // The active branch now reads the freshly edited fork, not the stale one.
    const active = (await repo.listMessages(userId, session.id)).map((m) => m.payload.content)
    expect(active.join('\n')).not.toContain('Localix · Agent Harness')
    expect(active).toContain('fork A edited — clean')

    await destroyDatabase(db)
  })

  test('listSessions stamps messageCount per session (so the UI can size a thread)', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'user_message_count'

    const withMessages = await chatService.createSession(userId, { title: 'Has messages' })
    const empty = await chatService.createSession(userId, { title: 'Empty' })

    const ts = new Date().toISOString()
    for (let i = 0; i < 3; i++) {
      await repo.insertMessage({
        id: `msg_${i}`,
        sessionId: withMessages.id,
        userId,
        payload: {
          id: `msg_${i}`,
          role: 'user',
          from: USER_PARTICIPANT,
          content: `m${i}`,
          items: [],
        } as StoredMessagePayload,
        createdAt: ts,
        updatedAt: ts,
      })
    }

    const { sessions } = await chatService.listSessions(userId)
    const counts = new Map(sessions.map((s) => [s.id, s.messageCount]))
    expect(counts.get(withMessages.id)).toBe(3)
    // No thread/messages yet → 0 (the UI renders just the icon, never "0").
    expect(counts.get(empty.id)).toBe(0)

    await destroyDatabase(db)
  })
})

/**
 * A session with no explicit project lands in the default one.
 *
 * The scope it gets is the point: `capability_rule` keys a scope per project, and a
 * project-less session used to resolve to `global` — where a denial is monotone and nothing
 * below can undo it. A throwaway chat must not be able to write the installation ceiling.
 */
describe('session project assignment', () => {
  test('a session created without a project gets the default one, and a child inherits it', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const userId = 'user_default_project'

    const root = await chatService.createSession(userId, { title: 'Scratch' })
    expect(root.projectId).not.toBeNull()

    const projects = await createProjectsRepository(db).listProjects(userId)
    expect(projects.map((p) => p.id)).toEqual([root.projectId!])

    // A child's scope IS its parent's: inheriting rather than re-resolving keeps a background
    // job under the same rules the user is looking at.
    const child = await chatService.createSession(userId, {
      title: 'Child',
      parentSessionId: root.id,
      sessionKind: 'job',
    })
    expect(child.projectId).toBe(root.projectId)
    expect((await createProjectsRepository(db).listProjects(userId)).length).toBe(1)

    await destroyDatabase(db)
  })
})
