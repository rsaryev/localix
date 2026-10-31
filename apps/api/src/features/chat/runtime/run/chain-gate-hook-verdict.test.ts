import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { AgentTool } from '@localixai/agent/agents'

import type { PermissionRule } from '../../../agent-core/permission-engine'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { PreToolUseResult } from '../../../cc-hooks/runtime-contracts'
import { EMPTY_RUNTIME } from '../../../cc-hooks/runtime-results'
import { createChainGate } from './chain-gate'
import { applyToolWrapperChain } from './tool-wrapper-chain'
import { createPermissionGate } from '../../../agent-core/permission-gate'

/**
 * A PreToolUse hook's allow/ask decides the card at the gate inside the chain: the defect this
 * pins is a verdict the hook wrapper dropped, so an allowed `rm -rf ./build` still showed its card
 * and an `ask` on a call the rules allow showed none.
 */
const ROOT = path.join(os.homedir(), 'proj')
const logger = { warn: () => {}, info: () => {} }
const DANGEROUS: PermissionRule = { permission: 'Bash', pattern: 'dangerous', action: 'ask' }

async function run(command: string, pre: Omit<PreToolUseResult, 'didRewrite'>) {
  const log: string[] = []
  const bash = {
    name: 'Bash',
    description: 'run a command',
    activeVerb: 'Running',
    inputSchema: z.object({ command: z.string() }),
    classify: () => ({ effect: 'external' }),
    execute: async () => {
      log.push('ran')
      return { content: 'ok' }
    },
  } as unknown as AgentTool
  const ccHooks: CcHooksRuntime = {
    ...EMPTY_RUNTIME,
    active: true,
    hasHooks: (event) => event === 'PreToolUse',
    runPreToolUse: async (): Promise<PreToolUseResult> => ({ ...pre, didRewrite: false }),
  }
  const chain = createChainGate(true)
  const [tool] = applyToolWrapperChain([bash], {
    gate: chain,
    miniAppHooks: [],
    miniAppHookOptions: { sessionId: 's1', logger },
    ccHooks,
    logger,
  })
  const cards: (string | undefined)[] = []
  chain.bind(
    createPermissionGate({
      rules: [DANGEROUS],
      toolsByName: new Map([['bash', bash]]),
      root: ROOT,
      requestConfirm: async (args) => {
        cards.push(args.message)
        return { approved: true }
      },
    }),
  )
  await tool.execute('c1', { command })
  return { cards, log }
}

describe('a PreToolUse verdict at the gate inside the chain', () => {
  test('allow skips the card a destructive command would show', async () => {
    expect(await run('rm -rf ./build', { decision: 'allow' })).toEqual({ cards: [], log: ['ran'] })
  })

  test('ask shows a card, with the hook’s reason, for a call the rules allow', async () => {
    const { cards } = await run('ls', { decision: 'ask', reason: 'Check first' })
    expect(cards).toEqual(['Check first'])
  })

  test('no opinion leaves the rules to decide', async () => {
    expect((await run('rm -rf ./build', { decision: 'proceed' })).cards).toHaveLength(1)
  })
})
