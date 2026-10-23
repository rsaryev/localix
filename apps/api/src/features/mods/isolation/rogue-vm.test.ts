import { describe, expect, test } from 'bun:test'
import { MAX_PENDING, startModVm, WIRE_LIMITS, type ModVmOptions, type ModVmPort } from './mod-vm'
import { manualClock } from './testing/testing-mods'

/**
 * The host's side of a mod's VM facing a runtime that does not play by the rules — what a module
 * that took over its VM's runtime could send. The VM here is the test's own: it answers the host's
 * frames as `respond` says, and sends what the test makes it send.
 */

type Frame = { t: string; id?: number; type?: string; ok?: boolean; payload?: unknown }
type Start = Parameters<ModVmPort['start']>[0]

function rogue(respond: (frame: Frame, send: (frame: unknown) => void) => void) {
  let input!: Start
  let stopped = false
  const send = (frame: unknown) => input.onMessage(JSON.stringify(frame))
  const vms: ModVmPort = {
    start(start) {
      input = start
      return {
        send: (json) => respond(JSON.parse(json) as Frame, send),
        stop: () => void (stopped = true),
      }
    },
  }
  return {
    vms,
    send,
    raw: (json: string) => input.onMessage(json),
    reject: (message: string) => input.onUnhandledRejection?.(message),
    stopped: () => stopped,
  }
}

/** A runtime that answers `load` with `answer`, and nothing else. */
const answering = (answer: unknown) =>
  rogue((frame, send) => {
    if (frame.t === 'req' && frame.type === 'load')
      send({ t: 'res', id: frame.id, ok: true, value: answer })
  })

function start(vms: ModVmPort, options: Partial<ModVmOptions> = {}) {
  const reports: string[] = []
  const printed: string[] = []
  const deaths: string[] = []
  const vm = startModVm({
    vms,
    runtime: '',
    code: '',
    name: 'rogue',
    hangMs: 60_000,
    memoryLimitBytes: 1024,
    clock: manualClock(),
    apiOf: () => undefined,
    report: (message) => void reports.push(message),
    print: (level, line) => void printed.push(`${level} ${line}`),
    onDeath: (reason) => void deaths.push(reason),
    ...options,
  })
  const registered: Array<[unknown, unknown]> = []
  const on = (event: unknown, matcher: unknown) => {
    registered.push([event, matcher])
    return { catch: () => ({}) as never }
  }
  const register = () => vm.register(on as never, {})
  return { vm, reports, printed, deaths, registered, register }
}

describe("a VM's frames, as the host reads them", () => {
  test('hooks with an event that is no string, or a RegExp or function matcher, refuse the load', async () => {
    for (const hooks of [
      [{ id: 1, event: 123, generator: false }],
      [{ id: 1, event: 'command.run', generator: false, matcher: { command: { '\u0000lx': 5 } } }],
      [{ id: 1, event: 'command.run', generator: false, matcher: [1] }],
      [{ id: -1, event: 'command.run', generator: false }],
      [{ id: 1, event: 'command.run', generator: 'yes' }],
      [{ id: 1, event: 'x', generator: false, onError: { id: 'z', generator: false } }],
      'not a list',
    ]) {
      const { vm, registered, register } = start(answering({ hooks }).vms)
      await expect(register()).rejects.toThrow()
      expect(registered).toEqual([])
      vm.stop()
    }
    const { vm, registered, register } = start(
      answering({
        hooks: [{ id: 1, event: 'command.run', generator: false, matcher: { a: [1, 'b'] } }],
      }).vms,
    )
    await register()
    expect(registered).toEqual([['command.run', { a: [1, 'b'] }]])
    vm.stop()
  })

  test('a load that never answers fails at the budget, and the VM goes', async () => {
    const clock = manualClock()
    const quiet = rogue(() => {})
    const { vm, deaths, register } = start(quiet.vms, { clock, hangMs: 500 })
    const loading = register()
    await clock.armed(500)
    clock.advance(500)
    await expect(loading).rejects.toThrow('did not finish loading within 500 ms')
    expect(deaths).toEqual(['did not finish loading within 500 ms'])
    expect(vm.alive()).toBe(false)
    expect(quiet.stopped()).toBe(true)
  })

  test('a frame that is not JSON, or no message of the channel, stops the VM', () => {
    for (const [frame, reason] of [
      ['{', 'sent a frame that is not JSON'],
      ['{"t":"other"}', 'sent a malformed other message'],
    ] as const) {
      const vm = rogue(() => {})
      const { deaths } = start(vm.vms)
      vm.raw(frame)
      expect(deaths).toEqual([reason])
      expect(vm.stopped()).toBe(true)
    }
  })

  test("console lines and rejections are cut and capped; a value past the wire's limits fails its frame", async () => {
    const huge = Array.from({ length: WIRE_LIMITS.values + 1 }, () => 0)
    const vm = answering({ hooks: huge })
    const { vm: running, reports, printed, register } = start(vm.vms)
    for (let index = 0; index < 205; index++)
      vm.send({ t: 'note', type: 'console', payload: { level: 'log', line: 'x'.repeat(5000) } })
    for (let index = 0; index < 30; index++) vm.reject('y'.repeat(5000))
    await expect(register()).rejects.toThrow(`more than ${WIRE_LIMITS.values} values`)
    expect(printed).toHaveLength(201)
    expect(printed[0]!.length).toBeLessThan(4_100)
    expect(printed[200]).toBe('error [mod] console: more than 200 lines; some dropped')
    expect(reports).toHaveLength(21)
    expect(reports[0]!.length).toBeLessThan(1_100)
    expect(reports[20]).toContain('the rest are dropped')
    running.stop()
  })

  test('calls past the pending cap are refused while the first wait', async () => {
    const waiting: unknown[] = []
    let failed = 0
    let refused!: () => void
    const allRefused = new Promise<void>((resolve) => (refused = resolve))
    const vm = rogue((frame, send) => {
      if (frame.t === 'req' && frame.type === 'load') {
        send({ t: 'res', id: frame.id, ok: true, value: { hooks: [] } })
        for (let id = 1; id <= MAX_PENDING + 3; id++)
          send({
            t: 'req',
            id,
            type: 'api',
            payload: { call: 1, path: ['clock', 'sleep'], args: [] },
          })
      }
      if (frame.t === 'res' && !frame.ok && ++failed === 3) refused()
    })
    const { vm: running, register } = start(vm.vms, {
      apiOf: () => ({ clock: { sleep: () => new Promise((resolve) => waiting.push(resolve)) } }),
    })
    await register()
    await allRefused
    expect(waiting).toHaveLength(MAX_PENDING)
    running.stop()
  })
})
