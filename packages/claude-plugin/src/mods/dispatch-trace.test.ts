import { describe, expect, test } from 'bun:test'
import { createModsEngine } from './engine'

/** `onTrace`: a host learns which links of a chain ran, and so which hook answered without next. */

async function engineOf(hooks: Record<string, 'next' | 'answer' | 'wrap'>) {
  const engine = createModsEngine()
  for (const [mod, kind] of Object.entries(hooks))
    await engine.load(
      mod,
      (on) =>
        void on('ui.render', async (_$, e, next) => {
          if (kind === 'answer') return mod
          if (kind === 'wrap') return `${mod}(${String(await next(e))})`
          return next(e)
        }),
      {},
      {},
    )
  return engine
}

async function traceOf(engine: ReturnType<typeof createModsEngine>) {
  let seen: ReadonlyArray<{ plugin: string; outcome: string }> = []
  let order: readonly string[] = []
  const value = await engine.dispatch('ui.render', {}, () => 'core', {
    onTrace: (trace, chain) => ((seen = trace), (order = chain)),
  })
  return { value, order, links: seen.map(({ plugin, outcome }) => `${plugin}:${outcome}`) }
}

describe('a dispatch’s trace', () => {
  test('a hook that answers without next ends the trace: the hooks after it never ran', async () => {
    const traced = await traceOf(await engineOf({ a: 'wrap', b: 'answer', c: 'answer' }))
    expect(traced.value).toBe('a(b)')
    expect(traced.links).toEqual(['a:returned', 'b:returned'])
    expect(traced.order).toEqual(['a', 'b', 'c'])
  })

  test('a chain that reaches the host ends with the engine’s own link', async () => {
    const { value, links } = await traceOf(await engineOf({ a: 'next', b: 'wrap' }))
    expect(value).toBe('b(core)')
    expect(links).toEqual(['a:passed', 'b:returned', 'engine:returned'])
  })

  test('no hook at all: the trace is the engine’s link alone', async () => {
    expect((await traceOf(createModsEngine())).links).toEqual(['engine:returned'])
  })
})
