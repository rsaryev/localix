import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { AgentTool } from '@localixai/agent/agents'

import { createPermissionGate } from '../../../agent-core/permission-gate'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { PreToolUseResult } from '../../../cc-hooks/runtime-contracts'
import { EMPTY_RUNTIME } from '../../../cc-hooks/runtime-results'
import { createChainGate } from './chain-gate'
import { applyToolWrapperChain } from './tool-wrapper-chain'

const ROOT = path.join(os.homedir(), 'proj')
const logger = { warn: () => {}, info: () => {} }

/** A PreToolUse hook rewrites the recipient; the send drops the connection both times. */
async function twoCalls(inChain: boolean) {
  const mail = {
    name: 'send_email',
    description: 'send',
    activeVerb: 'Sending',
    inputSchema: z.object({ to: z.string() }),
    mutates: true,
    execute: async () => {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    },
  } as unknown as AgentTool
  const ccHooks: CcHooksRuntime = {
    ...EMPTY_RUNTIME,
    active: true,
    hasHooks: (event) => event === 'PreToolUse',
    runPreToolUse: async (): Promise<PreToolUseResult> => ({
      decision: 'proceed',
      didRewrite: true,
      updatedInput: { to: 'rewritten@b.c' },
    }),
  }
  const chain = createChainGate(inChain)
  const [tool] = applyToolWrapperChain([mail], {
    gate: chain,
    miniAppHooks: [],
    miniAppHookOptions: { sessionId: 's1', logger },
    ccHooks,
    logger,
  })
  const cards: (string | undefined)[] = []
  const gate = chain.bind(
    createPermissionGate({
      rules: [{ permission: '*', pattern: '*', action: 'allow' }],
      toolsByName: new Map([['send_email', mail]]),
      root: ROOT,
      uncertainWrites: chain.uncertainWrites,
      requestConfirm: async (args) => (cards.push(args.message), { approved: true }),
    }),
  )
  const call = async () => {
    const input = { to: 'a@b.c' }
    // Outside the chain the loop's gate checks the model's input before the wrappers run.
    if (!inChain) await gate({ toolCallId: 'c', toolName: 'send_email', input })
    return tool!.execute('c', input, undefined as never, undefined, undefined)
  }
  await call()
  await call()
  return cards
}

describe('the ledger and the gate use the same input when a hook rewrites it', () => {
  test('inside the chain, a repeat of the rewritten call is asked', async () => {
    expect(await twoCalls(true)).toHaveLength(1)
  })

  test('at the loop, a repeat is asked too', async () => {
    expect(await twoCalls(false)).toHaveLength(1)
  })
})
