import { describe, expect, test } from 'bun:test'
import { createModsEngine, ModLoadError, type Hook, type RegisterFunction } from './engine'

/** A clock that only moves when a test says so: budgets fire on `advance`, never on wall time. */
function manualClock() {
  let now = 0
  const timers = new Set<{ at: number; fire: () => void }>()
  return {
    now: () => now,
    setTimer(fire: () => void, ms: number) {
      const timer = { at: now + ms, fire }
      timers.add(timer)
      return () => timers.delete(timer)
    },
    advance(ms: number) {
      now += ms
      for (const timer of Array.from(timers))
        if (timer.at <= now) {
          timers.delete(timer)
          timer.fire()
        }
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function load(register: RegisterFunction, name = 'mod', api = {}) {
  const engine = createModsEngine()
  await engine.load(name, register, {}, api)
  return engine
}

describe('the hook chain', () => {
  test('a hook observes, rewrites and answers', async () => {
    const seen: unknown[] = []
    const engine = await load((on) => {
      on('prompt.submit', async (_$, e, next) => {
        seen.push(e)
        return next({ ...(e as object), text: 'trimmed' })
      })
      on('tool.call', { tool: 'Bash' }, () => ({ deny: 'Bash is off' }))
    })
    const core = (e: unknown) => ({ ran: e })
    expect(await engine.dispatch('prompt.submit', { text: '  hi ' }, core)).toEqual({
      ran: { text: 'trimmed' },
    })
    expect(seen).toEqual([{ text: '  hi ' }])
    expect(await engine.dispatch('tool.call', { tool: 'Bash' }, core)).toEqual({
      deny: 'Bash is off',
    })
    expect(await engine.dispatch('tool.call', { tool: 'Read' }, core)).toEqual({
      ran: { tool: 'Read' },
    })
  })

  test('the event is frozen; a hook changes it only through next', async () => {
    let error = ''
    const engine = await load((on) => {
      on('prompt.submit', (_$, e, next) => {
        try {
          ;(e as { text: string }).text = 'x'
        } catch (thrown) {
          error = String(thrown)
        }
        return next(e)
      })
    })
    expect(await engine.dispatch('prompt.submit', { text: 'a' }, (e) => e)).toEqual({ text: 'a' })
    expect(error).toContain('read')
  })

  test('mods run in load order, the first outermost; matchers filter by field', async () => {
    const order: string[] = []
    const engine = createModsEngine()
    const wrap =
      (name: string): Hook =>
      async (_$, e, next) => {
        order.push(`${name}>`)
        const result = await next(e)
        order.push(`<${name}`)
        return result
      }
    await engine.load('a', (on) => void on('tool.call', wrap('a')), {}, {})
    await engine.load(
      'b',
      (on) => void on('tool.call', { tool: ['Edit', 'Write'] }, wrap('b')),
      {},
      {},
    )
    await engine.load('c', (on) => void on('tool.*', { tool: /^mcp__/ }, wrap('c')), {}, {})
    await engine.dispatch('tool.call', { tool: 'Write' }, () => order.push('core'))
    expect(order).toEqual(['a>', 'b>', 'core', '<b', '<a'])
  })

  test('a hook that throws before next is skipped; after next, its result stands', async () => {
    const reports: string[] = []
    const engine = createModsEngine({ report: (_p, _e, reason) => reports.push(reason) })
    let coreRuns = 0
    await engine.load(
      'm',
      (on) => {
        on('a', () => {
          throw new Error('boom')
        })
        on('b', async (_$, e, next) => {
          await next(e)
          throw new Error('late')
        })
      },
      {},
      {},
    )
    expect(await engine.dispatch('a', {}, () => 'core')).toBe('core')
    expect(await engine.dispatch('b', {}, () => ++coreRuns)).toBe(1)
    expect(coreRuns).toBe(1)
    expect(reports).toEqual(['hook skipped: throw boom', 'hook skipped: throw late'])
  })

  test('a .catch handler answers in place of a failed hook, knowing whether next ran', async () => {
    const engine = await load((on) => {
      on('tool.call', () => {
        throw new Error('guard broke')
      }).catch((_$, _e, next) => (next.called ? next() : { deny: `guard ${next.error?.kind}` }))
    })
    expect(await engine.dispatch('tool.call', { tool: 'Bash' }, () => 'ran')).toEqual({
      deny: 'guard throw',
    })
  })

  test('a hook past its budget times out, and time inside next does not count', async () => {
    const clock = manualClock()
    const engine = createModsEngine({ budgetMs: 100, clock })
    let release!: () => void
    const slowCore = new Promise<string>((resolve) => (release = () => resolve('core')))
    await engine.load(
      'm',
      (on) => {
        on('fast', (_$, e, next) => next(e))
        on('stuck', () => new Promise(() => {}))
      },
      {},
      {},
    )
    const fast = engine.dispatch('fast', {}, () => slowCore)
    await tick()
    clock.advance(500) // all of it inside next: no timeout
    release()
    expect(await fast).toBe('core')

    const stuck = engine.dispatch('stuck', {}, () => 'skipped to core')
    await tick()
    clock.advance(100)
    expect(await stuck).toBe('skipped to core')
  })

  test('registering one event twice without a matcher refuses the module', async () => {
    const engine = createModsEngine()
    const register: RegisterFunction = (on) => {
      on('session.start', (_$, e, next) => next(e))
      on('session.start', (_$, e, next) => next(e))
    }
    await expect(engine.load('m', register, {}, {})).rejects.toBeInstanceOf(ModLoadError)
    expect(engine.plugins()).toEqual([])
  })

  test('an event name that is no string refuses the module, and other mods still dispatch', async () => {
    const engine = await load((on) => void on('turn.start', () => 'answered'))
    const register = ((on: (event: unknown, hook: Hook) => void) => {
      on(123, () => 'never')
    }) as unknown as RegisterFunction
    await expect(engine.load('bad', register, {}, {})).rejects.toThrow('takes an event name')
    expect(engine.plugins()).toEqual(['mod'])
    expect(await engine.dispatch('turn.start', {}, () => 'core')).toBe('answered')
  })

  test('a wildcard misses telemetry, and limiting the plugins limits the chain', async () => {
    const engine = await load((on) => void on('*', () => 'answered'))
    expect(await engine.dispatch('telemetry.log', {}, () => 'core')).toBe('core')
    expect(await engine.dispatch('turn.start', {}, () => 'core')).toBe('answered')
    expect(
      await engine.dispatch('turn.start', {}, () => 'core', { plugins: new Set(['other']) }),
    ).toBe('core')
  })
})

describe('mods API calls are events', () => {
  test('another mod intercepts a call as its documented input; a deny rejects the caller', async () => {
    const engine = createModsEngine()
    const reads: string[] = []
    const seen: unknown[] = []
    const api = { fs: { read: (path: string) => `content of ${path}` } }
    await engine.load(
      'guard',
      (on) => {
        on('fs.read', { path: /\.env$/ }, () => ({ deny: 'secrets stay put' }))
        on('fs.read', async ($, e, next) => {
          const answer = await next(e)
          seen.push(e, answer)
          return { value: `${(answer as { value: string }).value}!` }
        })
      },
      {},
      api,
    )
    await engine.load(
      'reader',
      (on) =>
        void on('session.start', async ($, e, next) => {
          const fs = $.fs as { read: (path: string) => Promise<unknown> }
          reads.push(String(await fs.read('notes.md')))
          reads.push(
            String(await fs.read('.env').catch((error: Error) => `refused: ${error.message}`)),
          )
          return next(e)
        }),
      {},
      api,
    )
    await engine.dispatch('session.start', {}, () => ({}), { plugins: new Set(['reader']) })
    expect(reads).toEqual(['content of notes.md!', 'refused: secrets stay put'])
    expect(seen).toEqual([{ path: 'notes.md', as: 'text' }, { value: 'content of notes.md' }])
  })

  test('a synchronous call fires its event without waiting on it', async () => {
    const engine = createModsEngine()
    const toasts: unknown[] = []
    const heard: unknown[] = []
    await engine.load(
      'watcher',
      (on) => void on('ui.toast', (_$, e, next) => (heard.push(e), next(e))),
      {},
      {},
    )
    await engine.load(
      'm',
      () => {},
      {},
      { ui: { toast: (text: unknown) => void toasts.push(text) } },
    )
    const $ = engine.apiOf('m') as unknown as {
      ui: { toast: (text: string, o?: unknown) => unknown }
    }
    expect($.ui.toast('saved', { timeoutMs: 900 })).toBeUndefined()
    await new Promise((resolve) => setImmediate(resolve))
    expect(heard).toEqual([{ text: 'saved', timeoutMs: 900 }])
    expect(toasts).toEqual(['saved'])
  })

  test('a call reaches only the hooks of the mods running where its mod runs', async () => {
    const engine = createModsEngine({
      peersOf: (mod) => new Set(mod.endsWith('@a') ? ['guard@a', 'reader@a'] : [mod]),
    })
    const api = { fs: { read: () => 'content' } }
    const guard = (on: Parameters<Parameters<typeof engine.load>[1]>[0]) =>
      void on('fs.read', () => ({ deny: 'guarded' }))
    await engine.load('guard@a', guard, {}, api)
    await engine.load('reader@a', () => {}, {}, api)
    await engine.load('reader@b', () => {}, {}, api)
    const read = (mod: string) =>
      (engine.apiOf(mod) as unknown as { fs: { read: () => Promise<unknown> } }).fs.read()
    expect(await read('reader@a').catch((error: Error) => error.message)).toBe('guarded')
    expect(await read('reader@b')).toBe('content')
  })

  test('calls answer with a promise, as Claude Code’s do, except the synchronous ui calls', async () => {
    const engine = createModsEngine()
    const api = {
      command: { register: () => undefined },
      fs: {
        read: () => {
          throw new Error('no such file')
        },
      },
      ui: { toast: () => 'shown' },
    }
    await engine.load('m', () => {}, {}, api)
    const $ = engine.apiOf('m') as unknown as {
      command: { register: () => Promise<unknown> }
      fs: { read: () => Promise<unknown> }
      ui: { toast: () => unknown }
    }
    // A mod chains `.catch` on a registration, which a bare `undefined` would crash.
    expect($.command.register()).toBeInstanceOf(Promise)
    await expect($.fs.read()).rejects.toThrow('no such file')
    expect($.ui.toast()).toBe('shown')
  })

  test('engine.create adds a noun every mod’s $ has; its calls are events; a rival is refused', async () => {
    const engine = createModsEngine({ pluginOf: (mod) => mod.split('~')[0]! })
    await engine.load(
      'voice~a',
      (on) => {
        on('engine.create', async ($, e, next) => {
          const beneath = (await next(e)) as Record<string, unknown>
          return { ...beneath, voice: { say: (input: { text: string }) => `said ${input.text}` } }
        })
      },
      {},
      { fs: { read: () => 'x' } },
    )
    await engine.load('caller', () => {}, {}, {})
    const $ = engine.apiOf('caller') as unknown as {
      voice: { say: (input: { text: string }) => Promise<string> }
    }
    expect(await $.voice.say({ text: 'hi' })).toBe('said hi')

    // Another project's load of the same plugin adds it again; another plugin may not.
    await engine.load(
      'voice~b',
      (on) =>
        void on('engine.create', async ($, e, next) => {
          const beneath = (await next(e)) as Record<string, unknown>
          return { ...beneath, voice: { say: () => 'b' } }
        }),
      {},
      {},
    )
    await expect(
      engine.load(
        'rival',
        (on) =>
          void on('engine.create', async ($, e, next) => {
            const beneath = (await next(e)) as Record<string, unknown>
            return { ...beneath, voice: { say: () => 'rival' } }
          }),
        {},
        {},
      ),
    ).rejects.toThrow("voice is voice's noun already")
    expect(engine.plugins()).not.toContain('rival')

    engine.unload('voice~a')
    engine.unload('voice~b')
    expect((engine.apiOf('caller') as Record<string, unknown>).voice).toBeUndefined()
  })

  test('next.to past the user tier skips the other mods and reaches the host', async () => {
    const engine = createModsEngine()
    const seen: string[] = []
    await engine.load(
      'policy',
      (on) => void on('prompt.section', ($, e, next) => next.to(e, 'append')),
      {},
      {},
    )
    await engine.load(
      'later',
      (on) =>
        void on('prompt.section', ($, e, next) => {
          seen.push('later')
          return next(e)
        }),
      {},
      {},
    )
    expect(
      await engine.dispatch('prompt.section', { id: 'intro' }, () => ({ text: 'core' })),
    ).toEqual({
      text: 'core',
    })
    expect(seen).toEqual([])
  })
})
