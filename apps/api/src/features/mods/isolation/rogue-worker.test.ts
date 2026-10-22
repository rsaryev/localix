import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { MAX_PENDING, startModWorker, WIRE_LIMITS, type ModWorkerOptions } from './mod-worker'
import { manualClock } from './testing-mods'

/**
 * The host's side of a mod's worker facing a worker that does not play by the rules — what a
 * module that escaped its lockdown could send. Each worker here is a script of the test's own that
 * speaks the channel's frames.
 */

const scratch = tempDirPerTest('mods-rogue-worker', {})

/** A worker that announces itself, then answers `load` with `answer` (its code's expression). */
function rogue(answer: string, setup = ''): string {
  const file = join(scratch(), 'rogue.js')
  writeTree(join(file, '..'), {
    'rogue.js': `
      const post = (message) => postMessage(message)
      ${setup}
      addEventListener('message', (event) => {
        const message = event.data
        if (message.t === 'req' && message.type === 'load')
          post({ t: 'res', id: message.id, ok: true, value: ${answer} })
      })
      post({ t: 'ready' })
    `,
  })
  return file
}

function start(workerUrl: string, options: Partial<ModWorkerOptions> = {}) {
  const reports: string[] = []
  const deaths: string[] = []
  const worker = startModWorker({
    code: '',
    name: 'rogue',
    workerUrl,
    hangMs: 60_000,
    clock: manualClock(),
    apiOf: () => undefined,
    report: (message) => void reports.push(message),
    onDeath: (reason) => void deaths.push(reason),
    ...options,
  })
  const registered: Array<[unknown, unknown]> = []
  const on = (event: unknown, matcher: unknown) => {
    registered.push([event, matcher])
    return { catch: () => ({}) as never }
  }
  const register = () => worker.register(on as never, {})
  return { worker, reports, deaths, registered, register }
}

describe("a worker's frames, as the host reads them", () => {
  test('the worker starts with an empty environment', async () => {
    const { worker, reports, register } = start(
      rogue(
        '{ hooks: [] }',
        `post({ t: 'note', type: 'report', payload: { message: 'env ' + Object.keys(Bun.env).length } })`,
      ),
    )
    await register()
    expect(reports).toEqual(['env 0'])
    worker.stop()
  })

  test('hooks with an event that is no string, or a RegExp or function matcher, refuse the load', async () => {
    for (const hooks of [
      '[{ id: 1, event: 123, generator: false }]',
      "[{ id: 1, event: 'command.run', generator: false, matcher: { command: /(a+)+$/ } }]",
      "[{ id: 1, event: 'command.run', generator: false, matcher: [1] }]",
      "[{ id: -1, event: 'command.run', generator: false }]",
      "[{ id: 1, event: 'command.run', generator: 'yes' }]",
      "[{ id: 1, event: 'x', generator: false, onError: { id: 'z', generator: false } }]",
      "'not a list'",
    ]) {
      const { worker, registered, register } = start(rogue(`{ hooks: ${hooks} }`))
      await expect(register()).rejects.toThrow()
      expect(registered).toEqual([])
      worker.stop()
    }
    const { worker, registered, register } = start(
      rogue(
        "{ hooks: [{ id: 1, event: 'command.run', generator: false, matcher: { a: [1, 'b'] } }] }",
      ),
    )
    await register()
    expect(registered).toEqual([['command.run', { a: [1, 'b'] }]])
    worker.stop()
  })

  test('a load that never answers fails at the budget, and the worker goes', async () => {
    const clock = manualClock()
    const { worker, deaths, register } = start(rogue('undefined', 'addEventListener = () => {}'), {
      clock,
      hangMs: 500,
    })
    const loading = register()
    await clock.armed(500)
    clock.advance(500)
    await expect(loading).rejects.toThrow('did not finish loading within 500 ms')
    expect(deaths).toEqual(['did not finish loading within 500 ms'])
    expect(worker.alive()).toBe(false)
  })

  test("a flood of reports is cut and capped; a value past the wire's limits fails its frame", async () => {
    const huge = `Array.from({ length: ${WIRE_LIMITS.values + 1} }, () => 0)`
    const { worker, reports, register } = start(
      rogue(
        `{ hooks: ${huge} }`,
        `for (let i = 0; i < 30; i++)
          post({ t: 'note', type: 'report', payload: { message: 'x'.repeat(5000) } })`,
      ),
    )
    await expect(register()).rejects.toThrow(`more than ${WIRE_LIMITS.values} values`)
    expect(reports).toHaveLength(21)
    expect(reports[0]!.length).toBeLessThan(1_100)
    expect(reports[20]).toContain('the rest are dropped')
    worker.stop()
  })

  test('calls past the pending cap are refused while the first wait', async () => {
    const waiting: unknown[] = []
    let refused!: () => void
    const allRefused = new Promise<void>((resolve) => (refused = resolve))
    const { worker, register } = start(
      rogue(
        '{ hooks: [] }',
        `let failed = 0
        addEventListener('message', (event) => {
          const message = event.data
          if (message.t === 'res' && !message.ok && ++failed === 3)
            post({ t: 'note', type: 'report', payload: { message: 'refused 3' } })
        })
        for (let id = 1; id <= ${MAX_PENDING + 3}; id++)
          post({ t: 'req', id, type: 'api', payload: { call: 1, path: ['clock', 'sleep'], args: [] } })`,
      ),
      {
        apiOf: () => ({ clock: { sleep: () => new Promise((resolve) => waiting.push(resolve)) } }),
        report: (message) => message === 'refused 3' && refused(),
      },
    )
    await register()
    await allRefused
    expect(waiting).toHaveLength(MAX_PENDING)
    worker.stop()
  })
})
