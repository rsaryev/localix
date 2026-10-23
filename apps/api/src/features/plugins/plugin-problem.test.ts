import { describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeContext } from './native'
import type { MiniAppProblem } from './native'

/** A context creates its plugin's state and data roots under this home, never the real one. */
const TEST_HOME = join(tmpdir(), 'localix-plugin-problem-home')

/**
 * The hook-only problem channel. Two facts are worth pinning because both were the
 * point of the design: the plugin NAME is bound by the host (a plugin can only ever
 * speak as itself), and the session is NOT bound — the context is cached per scope and
 * shared by a parent run and its children, so the caller states which chat it means.
 */
describe('ctx.reportProblem', () => {
  const problem: MiniAppProblem = { sessionId: 's1', message: 'It broke', detail: 'raw' }

  it('binds the plugin name and passes the session through untouched', () => {
    const seen: Array<[string, MiniAppProblem]> = []
    const ctx = makeContext(
      'acme-notifier',
      '/plugins/acme-notifier',
      {},
      () => {},
      '/work',
      'u1',
      TEST_HOME,
      undefined,
      (pluginName, p) => seen.push([pluginName, p]),
    )
    ctx.reportProblem?.(problem)
    expect(seen).toEqual([['acme-notifier', problem]])
  })

  it('is absent when the caller binds no reporter', () => {
    const ctx = makeContext('sample', '/plugins/sample', {}, () => {}, '/work', 'u1', TEST_HOME)
    // Only Settings inspection builds a context like this: every load that runs plugin code
    // binds `miniAppProblemReporter` (see `notifications/conditions/plugins.test.ts`).
    expect(ctx.reportProblem).toBeUndefined()
  })
})
