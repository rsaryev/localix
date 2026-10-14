import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { createHumanInLoopController } from '@localixai/agent/agents'
import {
  classifyVaultCall,
  createVaultTool,
  vaultActionSchema,
  vaultInputSchema,
} from './agent-tool'
import type { SecretMeta } from './contracts'

const items: SecretMeta[] = [
  {
    id: 'item-1',
    key: 'OPENAI_KEY',
    label: 'OpenAI production',
    description: 'Provider key',
    type: 'api_key',
    source: 'user',
    backend: 'local-aes',
    version: 3,
    tags: ['production'],
    reference: 'secret:OPENAI_KEY',
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: 'item-2',
    key: 'WALLET_SEED',
    label: 'Cold wallet',
    description: 'Recovery material',
    type: 'crypto_wallet',
    source: 'user',
    backend: 'local-aes',
    version: 1,
    tags: ['finance'],
    reference: 'secret:WALLET_SEED',
    createdAt: 1,
    updatedAt: 2,
  },
]

const tool = () =>
  createVaultTool({
    list: async () => items,
    updateMetadata: async (key, request) => ({
      status: 'updated',
      item: {
        ...items.find((item) => item.key === key)!,
        label: request.title ?? 'Updated',
        version: request.expectedVersion + 1,
      },
    }),
    remove: async () => ({ status: 'deleted' }),
  })

describe('Vault call classification', () => {
  test.each([
    ['list', { action: 'list' }, { effect: 'read' }],
    ['get', { action: 'get', key: 'OPENAI_KEY' }, { effect: 'read' }],
    ['update', { action: 'update', key: 'OPENAI_KEY' }, { effect: 'host' }],
    ['create', { action: 'create', key: 'NEW_KEY' }, { effect: 'host', needsHuman: true }],
    ['rotate', { action: 'rotate', key: 'OPENAI_KEY' }, { effect: 'host', needsHuman: true }],
    [
      'delete',
      { action: 'delete', key: 'OPENAI_KEY' },
      { effect: 'host', needsHuman: true, irreversible: true },
    ],
    ['an unknown action', { action: 'export' }, { effect: 'external' }],
    ['no input', undefined, { effect: 'external' }],
  ] as const)('%s', (_label, input, expected) => {
    expect(classifyVaultCall(input)).toEqual(expected)
    expect(tool().classify?.(input)).toEqual(expected)
  })

  test('the static flag is truthful: the tool can write', () => {
    expect(tool().mutates).toBe(true)
  })
})

describe('unified Vault agent tool', () => {
  test('strictly rejects model-supplied values for every write path', () => {
    // Every write action is `.strict()`, so a plaintext value cannot ride the tool
    // input on ANY of them — the value only ever arrives through the masked HITL leg.
    const writes = [
      { action: 'create', key: 'NEW_KEY', reason: 'Needed by integration' },
      { action: 'update', key: 'OPENAI_KEY', expected_version: 3, title: 'Renamed' },
      { action: 'rotate', key: 'OPENAI_KEY', expected_version: 3, reason: 'Scheduled rotation' },
      { action: 'delete', key: 'WALLET_SEED', expected_version: 1, reason: 'Retired' },
    ]
    // Both layers refuse it: the flat wire schema the model sees, and the per-action contract.
    for (const schema of [vaultInputSchema, vaultActionSchema]) {
      for (const write of writes) {
        expect(() => schema.parse(write)).not.toThrow()
        expect(() => schema.parse({ ...write, value: 'must-not-enter-tool-input' })).toThrow()
      }
    }
  })

  test('the wire schema carries each field once, not once per action', () => {
    // A discriminated union renders one JSON object per branch; the vault's used to repeat the
    // 27-value item-type enum three times and cost ~960 tokens on every request.
    const wire = JSON.stringify(z.toJSONSchema(vaultInputSchema))
    expect(wire.split('"secure_note"').length - 1).toBe(1)
    expect(wire).not.toContain('oneOf')
  })

  test('requires optimistic concurrency for rotation', () => {
    // Without expected_version a stale rotation could overwrite a newer value, so the
    // field is structurally required rather than merely recommended.
    expect(() =>
      vaultActionSchema.parse({
        action: 'rotate',
        key: 'WALLET_SEED',
        reason: 'Rotate compromised wallet',
      }),
    ).toThrow()
  })

  test('lists and gets title, description and reference without values', async () => {
    const list = await tool().execute('list-1', {
      action: 'list',
      query: 'provider',
      type: 'api_key',
    })
    expect(list.content).toContain('OpenAI production')
    expect(list.content).toContain('Provider key')
    expect(list.content).toContain('secret:OPENAI_KEY')

    const get = await tool().execute('get-1', { action: 'get', key: 'WALLET_SEED' })
    expect(get.content).toContain('Cold wallet')

    // Assert the SHAPE, not the absence of a sentinel string. `not.toContain('sk-sentinel')`
    // used to stand here, but no such value is planted anywhere — nor could it be, since
    // SecretMeta carries no value field — so it could never fail. Pinning the exact key set
    // DOES fail the moment `metadataForModel` starts emitting a value-bearing field.
    const projected = [
      'description',
      'key',
      'reference',
      'source',
      'tags',
      'title',
      'type',
      'version',
    ]
    expect(Object.keys(JSON.parse(get.content).item).sort()).toEqual(projected)
    for (const item of JSON.parse(list.content).items as Array<Record<string, unknown>>) {
      expect(Object.keys(item).sort()).toEqual(projected)
    }
  })

  test('updates metadata through the same tool and advances the public version', async () => {
    const result = await tool().execute('update-1', {
      action: 'update',
      key: 'OPENAI_KEY',
      expected_version: 3,
      title: 'Primary OpenAI key',
      description: 'Used by production agents',
      tags: ['production', 'agents'],
    })
    expect(result.details).toMatchObject({ action: 'update', status: 'updated' })
    expect(result.content).toContain('Primary OpenAI key')
    expect(result.content).toContain('"version":4')
  })

  test('create uses the isolated masked request and resumes with metadata only', async () => {
    const controller = createHumanInLoopController()
    const execution = tool().execute(
      'create-1',
      {
        action: 'create',
        key: 'NEW_KEY',
        reason: 'Needed by integration',
        type: 'api_key',
        title: 'Integration key',
        description: 'Created for the deployment agent',
        tags: ['agent'],
      },
      undefined,
      undefined,
      { humanInLoop: controller },
    )
    await Promise.resolve()
    const pending = controller.getPending('create-1')
    expect(pending?.request.kind).toBe('request_secret')
    // Again a shape assertion: the request payload may carry ONLY these value-free keys.
    // A new field that could hold a credential fails here instead of shipping.
    expect(Object.keys(pending!.request.payload as Record<string, unknown>).sort()).toEqual([
      'action',
      'description',
      'key',
      'label',
      'reason',
      'tags',
      'type',
    ])
    controller.respond({
      requestId: 'create-1',
      kind: 'request_secret',
      payload: { answers: { stored: true, outcome: 'created' } },
      respondedAt: Date.now(),
    })
    const result = await execution
    expect(result.details).toEqual({
      action: 'create',
      key: 'NEW_KEY',
      stored: true,
      outcome: 'created',
    })
  })

  test('rotate preserves the existing item type and metadata in the masked prompt', async () => {
    const controller = createHumanInLoopController()
    const execution = tool().execute(
      'rotate-1',
      {
        action: 'rotate',
        key: 'OPENAI_KEY',
        expected_version: 3,
        reason: 'Scheduled rotation',
      },
      undefined,
      undefined,
      { humanInLoop: controller },
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.getPending('rotate-1')?.request).toMatchObject({
      kind: 'request_secret',
      payload: {
        action: 'rotate',
        key: 'OPENAI_KEY',
        type: 'api_key',
        label: 'OpenAI production',
        description: 'Provider key',
        tags: ['production'],
        expectedVersion: 3,
      },
    })
    controller.respond({
      requestId: 'rotate-1',
      kind: 'request_secret',
      payload: { answers: { stored: true, outcome: 'rotated' } },
      respondedAt: Date.now(),
    })
    const rotated = await execution
    // `toEqual`, not `toMatchObject`, so a leaked extra field in `details` fails — the
    // create case next door already did this and rotate should not be laxer.
    expect(rotated.details).toEqual({
      action: 'rotate',
      key: 'OPENAI_KEY',
      stored: true,
      outcome: 'rotated',
    })
    // The success STRING the model reads. Asserted nowhere else in the repo.
    expect(rotated.content).toBe(
      'Vault item "OPENAI_KEY" rotated securely. Use only its reference secret:OPENAI_KEY; the value remains hidden.',
    )
  })

  test('a refused or dismissed write reports the outcome without a value', async () => {
    // The `stored: false` and abort/timeout contents had zero assertions anywhere.
    const refused = createHumanInLoopController()
    const refusedRun = tool().execute(
      'refuse-1',
      vaultInputSchema.parse({ action: 'create', key: 'NEW_KEY', reason: 'needed' }),
      undefined,
      undefined,
      { humanInLoop: refused },
    )
    refused.respond({
      requestId: 'refuse-1',
      kind: 'request_secret',
      payload: { answers: { stored: false, outcome: 'exists' } },
      respondedAt: Date.now(),
    })
    const refusedResult = await refusedRun
    expect(refusedResult.content).toBe('Vault item "NEW_KEY" was not changed (exists).')
    expect(refusedResult.details).toEqual({
      action: 'create',
      key: 'NEW_KEY',
      stored: false,
      outcome: 'exists',
    })

    const dismissed = createHumanInLoopController()
    const dismissedRun = tool().execute(
      'dismiss-1',
      vaultInputSchema.parse({ action: 'create', key: 'NEW_KEY', reason: 'needed' }),
      undefined,
      undefined,
      { humanInLoop: dismissed },
    )
    dismissed.reject('dismiss-1', new Error('dismissed'))
    const dismissedResult = await dismissedRun
    expect(dismissedResult.content).toBe('No Vault value was provided for "NEW_KEY".')
    expect(dismissedResult.details).toEqual({ action: 'create', key: 'NEW_KEY', stored: false })
  })

  test('declines only the human-answered actions when no human can see the prompt', async () => {
    // `interactive: false` means the host will REFUSE to surface a HITL request for this
    // run (no chat root). Before this gate the tool raised one anyway and the host threw
    // "invalid ancestry", killing the whole run instead of returning a usable error.
    const controller = createHumanInLoopController()
    const ctx = { humanInLoop: controller, interactive: false }

    // Through `parse` so the inputs carry the schema's defaults, exactly as a real
    // model call arrives at `execute`.
    for (const input of [
      { action: 'create', key: 'NEW_KEY', reason: 'needed' },
      { action: 'rotate', key: 'OPENAI_KEY', expected_version: 3, reason: 'rotation' },
      { action: 'delete', key: 'WALLET_SEED', expected_version: 1, reason: 'retired' },
    ].map((raw) => vaultInputSchema.parse(raw))) {
      const result = await tool().execute(
        `no-human-${input.action}`,
        input,
        undefined,
        undefined,
        ctx,
      )
      expect(result.isError).toBe(true)
      expect(result.content).toContain('no chat surface')
      // Crucially it must not have parked a prompt nobody will answer.
      expect(controller.getPending(`no-human-${input.action}`)).toBeUndefined()
      expect(controller.listPending()).toHaveLength(0)
    }

    // The value-free actions still work — this is why the tool is not `interactiveOnly`.
    const list = await tool().execute('nh-list', { action: 'list' }, undefined, undefined, ctx)
    expect(list.isError).toBeUndefined()
    expect(list.content).toContain('OPENAI_KEY')
    const get = await tool().execute(
      'nh-get',
      { action: 'get', key: 'OPENAI_KEY' },
      undefined,
      undefined,
      ctx,
    )
    expect(get.isError).toBeUndefined()
    const update = await tool().execute(
      'nh-update',
      { action: 'update', key: 'OPENAI_KEY', expected_version: 3, title: 'Renamed' },
      undefined,
      undefined,
      ctx,
    )
    expect(update.details).toMatchObject({ action: 'update', status: 'updated' })
  })

  test('an absent `interactive` flag keeps the human-answered actions available', async () => {
    // Hosts that do not wire the signal must behave exactly as before.
    const controller = createHumanInLoopController()
    void tool().execute(
      'legacy-create',
      vaultInputSchema.parse({ action: 'create', key: 'NEW_KEY', reason: 'needed' }),
      undefined,
      undefined,
      { humanInLoop: controller },
    )
    expect(controller.getPending('legacy-create')?.request.kind).toBe('request_secret')
  })

  test('delete still requires an explicit human approval inside the one tool', async () => {
    const controller = createHumanInLoopController()
    const execution = tool().execute(
      'delete-1',
      { action: 'delete', key: 'WALLET_SEED', expected_version: 1, reason: 'Retired' },
      undefined,
      undefined,
      { humanInLoop: controller },
    )
    await Promise.resolve()
    controller.respond({
      requestId: 'delete-1',
      kind: 'ask',
      payload: {
        answers: [
          {
            id: 'vault_delete',
            question: 'Delete?',
            selectedOptions: ['approve'],
          },
        ],
      },
      respondedAt: Date.now(),
    })
    expect((await execution).details).toMatchObject({
      action: 'delete',
      approved: true,
      status: 'deleted',
    })
  })
})
