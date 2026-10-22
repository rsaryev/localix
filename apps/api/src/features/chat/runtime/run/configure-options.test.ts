import { describe, expect, test } from 'bun:test'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../cc-hooks'
import type { ConfigureHost } from '../../../agent-core/tools/configure/configure-contracts'
import { withConfigChangeHooks } from './configure-options'

function host() {
  const applied: unknown[] = []
  const value = {
    apply: async ({ change }: { change: unknown }) => {
      applied.push(change)
      return { summary: 'done' }
    },
  } as unknown as ConfigureHost
  return { value, applied }
}
const hooks = (blocked: boolean, seen: string[]): CcHooksRuntime => ({
  ...INERT_CC_HOOKS,
  active: true,
  hasHooks: (event) => event === 'ConfigChange',
  runConfigChange: async (source) => {
    seen.push(source)
    return { blocked }
  },
})

describe('ConfigChange on an approved configure proposal', () => {
  test('a block keeps the change from being written', async () => {
    const h = host()
    const seen: string[] = []
    const wrapped = withConfigChangeHooks(h.value, hooks(true, seen), 'project_settings')
    await expect(wrapped.apply({ change: { x: 1 }, proposalId: 'p1' })).rejects.toThrow(
      'ConfigChange hook blocked',
    )
    expect(seen).toEqual(['project_settings'])
    expect(h.applied).toEqual([])
  })

  test('an allowed change is written; no hooks, no wrapper', async () => {
    const h = host()
    const wrapped = withConfigChangeHooks(h.value, hooks(false, []), 'user_settings')
    expect(await wrapped.apply({ change: { x: 1 }, proposalId: 'p1' })).toEqual({ summary: 'done' })
    expect(h.applied).toEqual([{ x: 1 }])
    expect(withConfigChangeHooks(h.value, INERT_CC_HOOKS, 'user_settings')).toBe(h.value)
  })
})
