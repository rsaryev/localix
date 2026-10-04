/// <reference types="bun" />

import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { testWork } from '../../testing/work-fixture'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProviderConnectionsService } from '../provider-connections/service'
import type {
  RequestSecretPayload,
  RequestSecretRequest,
} from '../agent-core/tools/hitl/request-secret'
import { createVaultTool, vaultInputSchema } from '../secrets/agent-tool'
import { createHitlRegistry } from './runtime/hitl-registry'
import { createSessionStreamRegistry } from './runtime/session-stream-registry'
import {
  createTestCatalogService as createCatalogService,
  createTestChatService as createChatService,
} from './test-runtime'

const tempDir = join(process.cwd(), 'tmp', 'chat-submit-secret-tests')

// A value that must NEVER surface anywhere the agent (or a log/stream reader)
// can see. Every assertion below greps serialized surfaces for it.
const PLANTED_VALUE = 'sk-PLANTED-SECRET-VALUE-9f31c'

/**
 * The REAL producer of a `request_secret` prompt: the unified `vault` tool's
 * create/rotate paths. There is no separate `request_secret` tool — driving anything
 * else here would test a fixture instead of the shipped contract.
 *
 * `create` never touches the metadata ports, so they throw: a future change that
 * starts using them must not pass silently.
 */
const vaultTool = () =>
  createVaultTool({
    list: async () => [],
    updateMetadata: async () => {
      throw new Error('updateMetadata is not part of the create path')
    },
    remove: async () => {
      throw new Error('remove is not part of the create path')
    },
  })

/**
 * Pause a real `vault action=create` call on the SAME controller the service resolves
 * through; production runtime wiring uses the same `deps.hitlRegistry.controller` port.
 * The input goes through `vaultInputSchema.parse` so the schema defaults the model
 * relies on (`type`, `tags`) are exercised rather than hand-written.
 */
const startVaultCreate = (
  controller: ReturnType<typeof createHitlRegistry>['controller'],
  toolCallId: string,
  key: string,
  reason: string,
) => {
  let request: RequestSecretRequest | undefined
  const settled = vaultTool().execute(
    toolCallId,
    vaultInputSchema.parse({ action: 'create', key, reason }),
    undefined,
    (details) => {
      request = (details as { request?: RequestSecretRequest }).request
    },
    { humanInLoop: controller },
  )
  return { settled, request }
}

describe('chatService.submitSecret (request_secret answer leg)', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const build = async (
    storeSecret?: (
      userId: string,
      request: RequestSecretPayload,
      value: string,
    ) => Promise<{
      stored: boolean
      outcome: 'created' | 'rotated' | 'exists' | 'missing' | 'conflict'
    }>,
  ) => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const hitlRegistry = createHitlRegistry()
    const streamRegistry = createSessionStreamRegistry()
    const chatService = createChatService({
      db,
      work: testWork(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      hitlRegistry,
      streamRegistry,
      storeSecret,
    })
    return { db, hitlRegistry, streamRegistry, chatService }
  }

  test('vaults the value, resumes with only { stored }, and never leaks the value', async () => {
    const vaultCalls: Array<{ userId: string; request: RequestSecretPayload; value: string }> = []
    const { db, hitlRegistry, streamRegistry, chatService } = await build(
      async (userId, request, value) => {
        vaultCalls.push({ userId, request, value })
        return { stored: true, outcome: 'created' }
      },
    )
    const userId = 'secret_owner'

    // Capture EVERYTHING published on the stream during the exchange — the
    // planted value must appear in none of it.
    const publishedFrames: string[] = []
    const events: Array<Record<string, unknown>> = []
    streamRegistry.subscribeAll(userId, ({ data, event }) => {
      publishedFrames.push(data)
      events.push(event as unknown as Record<string, unknown>)
    })

    const { settled: resultPromise, request } = startVaultCreate(
      hitlRegistry.controller,
      'call_secret_1',
      'OPENROUTER_KEY',
      'API access',
    )
    expect(request).toBeDefined()
    hitlRegistry.trackRequest(
      'sess_1',
      'msg_1',
      'call_secret_1',
      'request_secret',
      request!,
      userId,
    )

    const outcome = await chatService.submitSecret('call_secret_1', PLANTED_VALUE, userId)
    expect(outcome).toEqual({ ok: true })

    // The vault got the value once, under the run's owner + the request's key.
    expect(vaultCalls).toEqual([
      {
        userId,
        request: {
          action: 'create',
          key: 'OPENROUTER_KEY',
          reason: 'API access',
          type: 'secret',
          tags: [],
        },
        value: PLANTED_VALUE,
      },
    ])

    // The tool result the model would see: confirmation + reference, NEVER the value.
    const result = await resultPromise
    expect(JSON.stringify(result)).not.toContain(PLANTED_VALUE)
    expect(result.content).toBe(
      'Vault item "OPENROUTER_KEY" created securely. Use only its reference secret:OPENROUTER_KEY; the value remains hidden.',
    )
    expect(result.details).toEqual({
      action: 'create',
      key: 'OPENROUTER_KEY',
      stored: true,
      outcome: 'created',
    })

    // The controller's in-memory record kept only the boolean.
    const record = hitlRegistry.controller.getRecord('call_secret_1')
    expect(record?.response?.payload).toEqual({
      answers: { stored: true, outcome: 'created' },
    })
    expect(JSON.stringify(record)).not.toContain(PLANTED_VALUE)

    // `hitl.resolved` was published (clears the overlay) — and no frame carries the value.
    expect(events.some((e) => e.type === 'hitl.resolved' && e.requestId === 'call_secret_1')).toBe(
      true,
    )
    for (const frame of publishedFrames) {
      expect(frame).not.toContain(PLANTED_VALUE)
    }

    await destroyDatabase(db)
  })

  test('refuses an unknown requestId without touching the vault', async () => {
    const vaultCalls: string[] = []
    const { db, chatService } = await build(async (_u, request) => {
      vaultCalls.push(request.key)
      return { stored: true, outcome: 'created' }
    })

    const outcome = await chatService.submitSecret('no_such_request', PLANTED_VALUE, 'anyone')
    expect(outcome).toEqual({ ok: false, error: 'secret_request_not_active' })
    expect(vaultCalls).toEqual([])

    await destroyDatabase(db)
  })

  test("refuses a foreign caller answering another user's secret prompt", async () => {
    const vaultCalls: string[] = []
    const { db, hitlRegistry, chatService } = await build(async (_u, request) => {
      vaultCalls.push(request.key)
      return { stored: true, outcome: 'created' }
    })

    const { settled, request } = startVaultCreate(
      hitlRegistry.controller,
      'call_secret_2',
      'OWNED_KEY',
      'why',
    )
    void settled
    hitlRegistry.trackRequest(
      'sess_1',
      'msg_1',
      'call_secret_2',
      'request_secret',
      request!,
      'owner',
    )

    const outcome = await chatService.submitSecret('call_secret_2', PLANTED_VALUE, 'intruder')
    expect(outcome).toEqual({ ok: false, error: 'secret_request_not_active' })
    expect(vaultCalls).toEqual([])
    // The prompt is still live for its rightful owner.
    expect(hitlRegistry.controller.getPending('call_secret_2')).toBeDefined()

    await destroyDatabase(db)
  })

  test("interact('respond') cannot spoof a request_secret resolution — only submitSecret resolves it", async () => {
    const vaultCalls: string[] = []
    const { db, hitlRegistry, chatService } = await build(async (_u, request) => {
      vaultCalls.push(request.key)
      return { stored: true, outcome: 'created' }
    })
    const userId = 'spoof_owner'

    const { settled, request } = startVaultCreate(
      hitlRegistry.controller,
      'call_secret_spoof',
      'SPOOF_KEY',
      'why',
    )
    void settled
    hitlRegistry.trackRequest(
      'sess_1',
      'msg_1',
      'call_secret_spoof',
      'request_secret',
      request!,
      userId,
    )

    // A same-owner generic respond claiming `stored: true` must be refused: nothing was
    // vaulted, and the agent would otherwise hand out a secret:KEY that resolves to nothing.
    const outcome = chatService.interact(
      'call_secret_spoof',
      'respond',
      { answers: { stored: true } },
      userId,
    )
    expect(outcome.ok).toBe(false)
    expect(vaultCalls).toEqual([])
    // The prompt survives for the real answer leg…
    expect(hitlRegistry.controller.getPending('call_secret_spoof')).toBeDefined()
    // …and dismiss (the UI's Escape) still works.
    expect(chatService.interact('call_secret_spoof', 'dismiss', undefined, userId).ok).toBe(true)

    await destroyDatabase(db)
  })

  test('refuses when request meta is absent — the owner would be unknown', async () => {
    const vaultCalls: string[] = []
    const { db, hitlRegistry, chatService } = await build(async (_u, request) => {
      vaultCalls.push(request.key)
      return { stored: true, outcome: 'created' }
    })

    // A pending exists on the controller but was never tracked (no meta): submitSecret must
    // refuse rather than vault under the caller's own id off a guessed toolCallId.
    void startVaultCreate(hitlRegistry.controller, 'call_secret_untracked', 'K', 'why').settled
    expect(hitlRegistry.controller.getPending('call_secret_untracked')).toBeDefined()

    const outcome = await chatService.submitSecret(
      'call_secret_untracked',
      PLANTED_VALUE,
      'guesser',
    )
    expect(outcome).toEqual({ ok: false, error: 'secret_request_not_active' })
    expect(vaultCalls).toEqual([])

    await destroyDatabase(db)
  })

  test('refuses to answer a pending request of a different kind (ask)', async () => {
    const vaultCalls: string[] = []
    const { db, hitlRegistry, chatService } = await build(async (_u, request) => {
      vaultCalls.push(request.key)
      return { stored: true, outcome: 'created' }
    })
    const userId = 'ask_owner'

    const askRequest = {
      id: 'call_ask_1',
      kind: 'ask' as const,
      payload: { toolCallId: 'call_ask_1', loading_messages: ['…'], questions: [] },
      createdAt: Date.now(),
    }
    void hitlRegistry.controller.request(askRequest).catch(() => {})
    hitlRegistry.trackRequest('sess_1', 'msg_1', 'call_ask_1', 'ask', askRequest, userId)

    const outcome = await chatService.submitSecret('call_ask_1', PLANTED_VALUE, userId)
    expect(outcome).toEqual({ ok: false, error: 'secret_request_not_active' })
    expect(vaultCalls).toEqual([])

    await destroyDatabase(db)
  })

  test('reports storage unavailable when no vault port is wired', async () => {
    const { db, hitlRegistry, chatService } = await build(undefined)
    const userId = 'no_vault_user'

    const { settled, request } = startVaultCreate(
      hitlRegistry.controller,
      'call_secret_3',
      'K',
      'r',
    )
    void settled
    hitlRegistry.trackRequest(
      'sess_1',
      'msg_1',
      'call_secret_3',
      'request_secret',
      request!,
      userId,
    )

    const outcome = await chatService.submitSecret('call_secret_3', PLANTED_VALUE, userId)
    expect(outcome).toEqual({ ok: false, error: 'secret_storage_unavailable' })

    await destroyDatabase(db)
  })
})
