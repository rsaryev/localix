import { afterEach, describe, expect, it } from 'bun:test'
import {
  observeDesktopInvoke,
  onDesktopInvokeEvent,
  resetDesktopInvokeEventsForTests,
  type DesktopInvokeEvent,
} from './tauri'

afterEach(() => {
  resetDesktopInvokeEventsForTests()
})

describe('Tauri invoke instrumentation', () => {
  it('observes lifecycle without exposing command arguments or results', async () => {
    const events: DesktopInvokeEvent[] = []
    const invoke = observeDesktopInvoke(async () => ({ token: 'private result' }))
    const off = onDesktopInvokeEvent((event) => events.push(event))

    expect(await invoke('save_file', { contents: 'private bytes' })).toEqual({
      token: 'private result',
    })
    expect(events.map((event) => event.phase)).toEqual(['started', 'succeeded'])
    expect(events[0]).toMatchObject({ traceId: 'native-1', command: 'save_file' })
    expect(JSON.stringify(events)).not.toContain('private bytes')
    expect(JSON.stringify(events)).not.toContain('private result')
    off()
  })

  it('reports a rejection and preserves the original error', async () => {
    const events: DesktopInvokeEvent[] = []
    const failure = Object.assign(new Error('native bridge unavailable'), { code: 'bridge_down' })
    const invoke = observeDesktopInvoke(async () => {
      throw failure
    })
    const off = onDesktopInvokeEvent((event) => events.push(event))

    expect(invoke('restart_app')).rejects.toBe(failure)
    await Promise.resolve()
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      traceId: 'native-1',
      command: 'restart_app',
      phase: 'failed',
      error: failure,
    })
    off()
  })
})
