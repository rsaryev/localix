import { describe, expect, test } from 'bun:test'
import { createModsEngine, type RegisterFunction } from './engine'

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
    pending: () => timers.size,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A `$` call that answers only when the test says so: a person deciding, a model thinking. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

type Api = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>

describe('a hook’s budget and its $ calls', () => {
  test('time inside a $ call is not the hook’s: a guard awaiting $.ui.ask still denies', async () => {
    const clock = manualClock()
    const reports: string[] = []
    const engine = createModsEngine({
      budgetMs: 100,
      clock,
      report: (_p, _e, reason) => reports.push(reason),
    })
    const answer = deferred<string>()
    const seen: number[] = []
    await engine.load(
      'guard',
      (on) =>
        void on('tool.call', async ($, e, next) => {
          const choice = await ($ as unknown as Api).ui!.ask!({ title: 'Run rm?' })
          seen.push(next.budget.remainingMs)
          return choice === 'no' ? { deny: 'refused by the person' } : next(e)
        }),
      {},
      { ui: { ask: () => answer.promise } },
    )
    let ran = false
    const call = engine.dispatch('tool.call', { tool: 'Bash' }, () => (ran = true))
    await tick()
    clock.advance(60_000) // a minute waiting on the person costs the hook nothing
    answer.resolve('no')
    expect(await call).toEqual({ deny: 'refused by the person' })
    expect(ran).toBe(false)
    expect(seen).toEqual([100])
    expect(reports).toEqual([])
    expect(clock.pending()).toBe(0)
  })

  test('$.clock.sleep counts against the budget, as Claude Code’s does', async () => {
    const clock = manualClock()
    const engine = createModsEngine({ budgetMs: 100, clock })
    const wake = deferred<void>()
    await engine.load(
      'sleeper',
      (on) =>
        void on('tool.call', async ($) => {
          await ($ as unknown as Api).clock!.sleep!(500)
          return { deny: 'too late' }
        }),
      {},
      { clock: { sleep: () => wake.promise } },
    )
    const call = engine.dispatch('tool.call', {}, () => 'core ran')
    await tick()
    clock.advance(100)
    expect(await call).toBe('core ran')
  })

  test('concurrent $ calls stop the clock once and a late call after the hook is free', async () => {
    const clock = manualClock()
    const engine = createModsEngine({ budgetMs: 100, clock })
    const a = deferred<string>()
    const b = deferred<string>()
    let stashed: Api | undefined
    await engine.load(
      'm',
      (on) =>
        void on('tool.call', async ($) => {
          stashed = $ as unknown as Api
          const both = await Promise.all([stashed.fs!.read!('a'), stashed.fs!.read!('b')])
          return { result: both.join('+') }
        }),
      {},
      { fs: { read: (path: unknown) => (path === 'a' ? a.promise : b.promise) } },
    )
    const call = engine.dispatch('tool.call', {}, () => 'core')
    await tick()
    a.resolve('A')
    await tick()
    clock.advance(1_000) // b still in flight: the clock is still stopped
    b.resolve('B')
    expect(await call).toEqual({ result: 'A+B' })
    const late = stashed!.fs!.read!('a')
    expect(clock.pending()).toBe(0)
    expect(await late).toBe('A')
  })
})

describe('next runs what is beneath afresh', () => {
  const counting = (register: RegisterFunction) => {
    const engine = createModsEngine()
    let runs = 0
    const core = () => ({ attempt: ++runs })
    return { engine, core, runs: () => runs, load: () => engine.load('m', register, {}, {}) }
  }

  test('a hook that calls next twice retries: the chain beneath runs twice', async () => {
    const site = counting((on) => {
      on('tool.call', async (_$, e, next) => {
        const first = (await next(e)) as { attempt: number }
        return first.attempt === 1 ? next(e) : first
      })
    })
    await site.load()
    expect(await site.engine.dispatch('tool.call', {}, site.core)).toEqual({ attempt: 2 })
    expect(site.runs()).toBe(2)
  })

  test('a hook that fails after two calls leaves the result of its last one', async () => {
    const site = counting((on) => {
      on('tool.call', async (_$, e, next) => {
        await next(e)
        await next(e)
        throw new Error('late')
      })
    })
    await site.load()
    expect(await site.engine.dispatch('tool.call', {}, site.core)).toEqual({ attempt: 2 })
    expect(site.runs()).toBe(2)
  })

  test('a .catch handler’s next replays the hook’s last call, or runs once when none', async () => {
    const replayed = counting((on) => {
      on('tool.call', async (_$, e, next) => {
        await next(e)
        throw new Error('boom')
      }).catch(async (_$, e, next) => {
        const again = await next(e)
        expect(await next(e)).toBe(again)
        return { replayed: again, called: next.called }
      })
    })
    await replayed.load()
    expect(await replayed.engine.dispatch('tool.call', {}, replayed.core)).toEqual({
      replayed: { attempt: 1 },
      called: true,
    })
    expect(replayed.runs()).toBe(1)

    const fresh = counting((on) => {
      on('tool.call', () => {
        throw new Error('boom')
      }).catch(async (_$, e, next) => {
        await next(e)
        return next(e)
      })
    })
    await fresh.load()
    expect(await fresh.engine.dispatch('tool.call', {}, fresh.core)).toEqual({ attempt: 1 })
    expect(fresh.runs()).toBe(1)
  })
})

describe('a hook that has ended never reaches what is beneath again', () => {
  const recording = () => {
    const commands: string[] = []
    const core = (e: unknown) => {
      commands.push((e as { command: string }).command)
      return { ran: (e as { command: string }).command }
    }
    return { commands, core }
  }

  test('a hook that ran out of time, then calls next, runs nothing and sees its signal abort', async () => {
    const clock = manualClock()
    const engine = createModsEngine({ budgetMs: 100, clock, report: () => {} })
    const ownWait = deferred<void>()
    const after = deferred<{ error?: unknown; aborted: boolean }>()
    await engine.load(
      'slow',
      (on) => {
        on('tool.call', async (_$, e, next) => {
          await ownWait.promise // its own wait counts against the budget
          const late = await Promise.resolve(next({ ...(e as object), command: 'rewritten' })).then(
            () => undefined,
            (error: unknown) => error,
          )
          after.resolve({ error: late, aborted: next.signal.aborted })
          return undefined
        })
      },
      {},
      {},
    )
    const site = recording()
    const call = engine.dispatch('tool.call', { command: 'orig' }, site.core)
    await tick()
    clock.advance(100)
    expect(await call).toEqual({ ran: 'orig' })
    ownWait.resolve()
    const seen = await after.promise
    expect(seen.error).toBeInstanceOf(Error)
    expect(seen.aborted).toBe(true)
    expect(site.commands).toEqual(['orig'])
  })

  test('a stashed next from a hook that threw replays its call instead of running again', async () => {
    const engine = createModsEngine({ report: () => {} })
    let stashed: ((e?: unknown) => unknown) | undefined
    await engine.load(
      'thrower',
      (on) => {
        on('tool.call', async (_$, e, next) => {
          await next(e)
          stashed = next
          throw new Error('boom')
        })
      },
      {},
      {},
    )
    const site = recording()
    expect(await engine.dispatch('tool.call', { command: 'orig' }, site.core)).toEqual({
      ran: 'orig',
    })
    expect(await stashed!({ command: 'rewritten' })).toEqual({ ran: 'orig' })
    expect(site.commands).toEqual(['orig'])
  })

  test('a hook that answered without next cannot run the host afterwards', async () => {
    const engine = createModsEngine()
    let stashed: ((e?: unknown) => unknown) | undefined
    await engine.load(
      'answerer',
      (on) => {
        on('tool.call', async (_$, _e, next) => {
          stashed = next
          return { deny: 'no' }
        })
      },
      {},
      {},
    )
    const site = recording()
    expect(await engine.dispatch('tool.call', { command: 'orig' }, site.core)).toEqual({
      deny: 'no',
    })
    await expect(Promise.resolve(stashed!({ command: 'rewritten' }))).rejects.toThrow('ended')
    await tick()
    expect(site.commands).toEqual([])
  })
})
