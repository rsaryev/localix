import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import type { AgentTool } from '@localixai/agent/agents'
import { wrapToolsWithFailureGuard } from './failure-guard'

/** A tool whose error-ness is dictated per call by a queue, so tests drive streaks. */
function flakyTool(outcomes: boolean[] /* true = isError */) {
  let i = 0
  return defineAgentTool({
    name: 'edit',
    description: 'test',
    activeVerb: 'Editing',
    inputSchema: z.object({ path: z.string() }),
    async execute(_id, input) {
      const isError = outcomes[Math.min(i++, outcomes.length - 1)]
      return { content: `result for ${input.path}`, isError }
    },
  })
}

/**
 * The guard erases the input type — it wraps `readonly AgentTool[]` and hands back
 * `AgentTool[]` (i.e. `AgentTool<unknown>`), so the wrapped tool is deliberately
 * typed at the erased contract the guard actually promises, not at the fixture's.
 */
const run = (tool: AgentTool, input: unknown) => tool.execute('c', input)

describe('wrapToolsWithFailureGuard', () => {
  // Regression: `plugin_build` after each edit failed with a SHORTER to-do list, and the guard
  // called it a verbatim repeat. Stuck is the same call failing the same way.
  test('the same call failing with a different result is progress, not a repeat', async () => {
    let n = 0
    const build = defineAgentTool({
      name: 'plugin_build',
      description: 'test',
      activeVerb: 'Building',
      inputSchema: z.object({ name: z.string() }),
      async execute() {
        n += 1
        return { content: `${5 - n} check(s) failed`, isError: true }
      },
    })
    const [tool] = wrapToolsWithFailureGuard([build])
    for (let i = 0; i < 4; i++) {
      const result = await run(tool, { name: 'calculator' })
      expect(result.content).not.toContain('[guardrail] This exact')
      expect(result.terminate).toBeUndefined()
    }
  })

  test('appends a hint on the 2nd identical failure, not the 1st', async () => {
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true, true])])
    const first = await run(tool, { path: 'a.ts' })
    expect(first.content).not.toContain('[guardrail]')

    const second = await run(tool, { path: 'a.ts' })
    expect(second.content).toContain('[guardrail]')
    expect(second.content).toContain('failed 2×')

    const third = await run(tool, { path: 'a.ts' })
    expect(third.content).toContain('failed 3×')
  })

  test('distinct NESTED-object inputs are not collapsed into one signature (no false hard-stop)', async () => {
    // Before the fix, callSignature's array-replacer blanked nested objects, so
    // these four DIFFERENT inputs shared ONE signature and the 4th falsely
    // hard-stopped. Each is now a distinct first-failure → no hint, no terminate.
    const nested = defineAgentTool({
      name: 'profile',
      description: 'test',
      activeVerb: 'Profiling',
      inputSchema: z.object({ data: z.object({ name: z.string() }) }),
      async execute() {
        return { content: 'nope', isError: true }
      },
    })
    const [tool] = wrapToolsWithFailureGuard([nested])
    // Four DISTINCT nested inputs → four distinct signatures → the IDENTICAL-call
    // hard-stop must NOT fire (with the old replacer bug all four collapsed to one
    // signature and the 4th terminated). The per-TOOL streak hint may still append,
    // but it never terminates — only the per-signature hard-stop does.
    for (const name of ['a', 'b', 'c', 'd']) {
      const res = await tool.execute('c', { data: { name } })
      expect(res.terminate).toBeUndefined()
    }
    // Sanity: the SAME nested input repeated to the threshold DOES hard-stop — so
    // signatures are genuinely content-derived, not collapsed.
    await tool.execute('c', { data: { name: 'z' } })
    await tool.execute('c', { data: { name: 'z' } })
    await tool.execute('c', { data: { name: 'z' } })
    const z4 = await tool.execute('c', { data: { name: 'z' } }) // 4th identical
    expect(z4.terminate).toBe(true)
  })

  test('hard-stops (terminate) on the 4th identical failure after hinting on 2nd/3rd', async () => {
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true, true, true])])
    const first = await run(tool, { path: 'a.ts' })
    expect(first.terminate).toBeUndefined()
    const second = await run(tool, { path: 'a.ts' })
    expect(second.content).toContain('failed 2×')
    expect(second.terminate).toBeUndefined() // hint, not stop
    const third = await run(tool, { path: 'a.ts' })
    expect(third.terminate).toBeUndefined()
    const fourth = await run(tool, { path: 'a.ts' })
    expect(fourth.terminate).toBe(true)
    expect(fourth.content).toContain('being stopped')
  })

  test('after a hard stop, EVERY subsequent call terminates without executing (pi ALL-terminate)', async () => {
    // Pi ends a batch only when ALL results carry terminate — one hard-stopped
    // result among successful siblings no longer stops the run. The latch makes
    // the NEXT batch all-terminate by construction.
    let sideEffects = 0
    const healthy = defineAgentTool({
      name: 'read',
      description: 't',
      activeVerb: 'Reading',
      inputSchema: z.object({ path: z.string() }),
      async execute() {
        sideEffects += 1
        return { content: 'ok' }
      },
    })
    const [stuck, wrappedHealthy] = wrapToolsWithFailureGuard([
      flakyTool([true, true, true, true]),
      healthy,
    ])
    for (let i = 0; i < 4; i++) await run(stuck, { path: 'a.ts' })

    // A different, previously-healthy tool now refuses to execute and terminates.
    const after = await wrappedHealthy.execute('c', { path: 'other.ts' })
    expect(after.terminate).toBe(true)
    expect(after.isError).toBe(true)
    expect(after.content).toContain('NOT executed')
    expect(sideEffects).toBe(0)
    // And the stuck tool itself is latched too.
    const again = await run(stuck, { path: 'b.ts' })
    expect(again.terminate).toBe(true)
  })

  test('hard-stop threshold is configurable and floored above repeatThreshold', async () => {
    // hardStop=2 would be < repeatThreshold+1, so it is floored to 3.
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true, true])], {
      hardStopThreshold: 2,
    })
    expect((await run(tool, { path: 'a.ts' })).terminate).toBeUndefined()
    expect((await run(tool, { path: 'a.ts' })).terminate).toBeUndefined() // 2nd = hint only
    expect((await run(tool, { path: 'a.ts' })).terminate).toBe(true) // 3rd = floored hard stop
  })

  test('a success resets the streak so it never hard-stops a recovering call', async () => {
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true, true, false, true, true])])
    await run(tool, { path: 'a.ts' })
    await run(tool, { path: 'a.ts' })
    await run(tool, { path: 'a.ts' })
    expect((await run(tool, { path: 'a.ts' })).terminate).toBeUndefined() // success reset
    await run(tool, { path: 'a.ts' })
    expect((await run(tool, { path: 'a.ts' })).terminate).toBeUndefined() // only 2 since reset
  })

  test('does NOT exact-repeat-hint when a different input fails (distinct signatures)', async () => {
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true])])
    const a = await run(tool, { path: 'a.ts' })
    const b = await run(tool, { path: 'b.ts' })
    expect(a.content).not.toContain('failed 2×')
    expect(b.content).not.toContain('failed 2×')
  })

  test('no-progress: a tool failing 3× on DIFFERENT inputs (no success) gets the broader hint', async () => {
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true, true])])
    expect((await run(tool, { path: 'a.ts' })).content).not.toContain('[guardrail]')
    expect((await run(tool, { path: 'b.ts' })).content).not.toContain('[guardrail]')
    const third = await run(tool, { path: 'c.ts' })
    expect(third.content).toContain('without a single success') // no-progress hint, not exact-repeat
    expect(third.content).not.toContain('exact')
  })

  test('a success resets the no-progress count', async () => {
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true, false, true, true])])
    await run(tool, { path: 'a.ts' })
    await run(tool, { path: 'b.ts' })
    await run(tool, { path: 'c.ts' }) // success — resets tool failure count
    expect((await run(tool, { path: 'd.ts' })).content).not.toContain('[guardrail]')
    expect((await run(tool, { path: 'e.ts' })).content).not.toContain('[guardrail]') // only 2 since reset
  })

  test('a success clears the streak so a later genuine retry starts fresh', async () => {
    // fail, fail (hint), succeed, fail → the post-success failure is count 1 again
    const [tool] = wrapToolsWithFailureGuard([flakyTool([true, true, false, true])])
    await run(tool, { path: 'a.ts' })
    expect((await run(tool, { path: 'a.ts' })).content).toContain('[guardrail]')
    expect((await run(tool, { path: 'a.ts' })).content).not.toContain('[guardrail]') // success
    expect((await run(tool, { path: 'a.ts' })).content).not.toContain('[guardrail]') // count reset to 1
  })

  test('never touches a successful result', async () => {
    const [tool] = wrapToolsWithFailureGuard([flakyTool([false, false])])
    const r = await run(tool, { path: 'a.ts' })
    expect(r.isError).toBe(false)
    expect(r.content).toBe('result for a.ts') // unchanged — no hint appended
  })

  test('key order in input does not create a distinct signature', async () => {
    // Same logical call, different key order → same signature → 2nd is a repeat.
    const [tool] = wrapToolsWithFailureGuard([
      defineAgentTool({
        name: 'bash',
        description: 't',
        activeVerb: 'Running',
        inputSchema: z.object({ command: z.string(), description: z.string() }),
        async execute() {
          return { content: 'boom', isError: true }
        },
      }),
    ])
    await tool.execute('c', { command: 'x', description: 'd' })
    const second = await tool.execute('c', { description: 'd', command: 'x' })
    expect(second.content).toContain('[guardrail]')
  })
  describe('a tool that THROWS', () => {
    // The agent loop converts a throw into an error result FAR outside this chain, so
    // before the guard did it itself a throwing tool was never counted: no hint, no
    // hard stop, and the thrash this exists to brake ran unbraked.
    const thrower = (make: () => unknown) =>
      defineAgentTool({
        name: 'edit',
        description: 't',
        activeVerb: 'Editing',
        inputSchema: z.object({ path: z.string() }),
        async execute() {
          throw make()
        },
      })

    test('counts toward the repeat hint and the hard stop', async () => {
      const [tool] = wrapToolsWithFailureGuard([thrower(() => new Error('ENOENT: no such file'))])
      const first = await run(tool, { path: 'a.ts' })
      expect(first.isError).toBe(true)
      expect(first.content).toContain('ENOENT: no such file')
      expect(first.content).not.toContain('[guardrail]')

      expect((await run(tool, { path: 'a.ts' })).content).toContain('failed 2×')
      await run(tool, { path: 'a.ts' })
      const fourth = await run(tool, { path: 'a.ts' })
      expect(fourth.terminate).toBe(true)
    })

    test('keeps the cause and the code the loop would have dropped', async () => {
      const err = Object.assign(new Error('write failed'), {
        code: 'EACCES',
        cause: new Error('read-only file system'),
      })
      const [tool] = wrapToolsWithFailureGuard([thrower(() => err)])
      const result = await run(tool, { path: 'a.ts' })
      expect(result.content).toContain('read-only file system')
      expect(result.error?.code).toBe('EACCES')
      expect(result.error?.kind).toBe('execution')
    })

    test('a cancellation is classified, not blamed on the model', async () => {
      const [tool] = wrapToolsWithFailureGuard([
        thrower(() =>
          Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
        ),
      ])
      expect((await run(tool, { path: 'a.ts' })).error?.kind).toBe('aborted')
    })

    test('a hook denial keeps its own kind', async () => {
      const [tool] = wrapToolsWithFailureGuard([
        thrower(() =>
          Object.assign(new Error('Tool call blocked by hook: nope'), {
            name: 'CcHookBlockedError',
          }),
        ),
      ])
      expect((await run(tool, { path: 'a.ts' })).error?.kind).toBe('blocked')
    })
  })
})
