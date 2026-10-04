import { describe, it, expect } from 'bun:test'
import { createSystemService } from './service'
import type { SystemToggleDef } from './toggle'

/** Build a lightweight mock toggle that records calls without spawning any process. */
function makeMockDef(
  id = 'mock-toggle',
): SystemToggleDef & { enableCalls: number; disableCalls: number } {
  let enableCalls = 0
  let disableCalls = 0
  return {
    id,
    title: 'Mock toggle',
    description: 'A test-only mock',
    isAvailable: () => true,
    enable() {
      enableCalls++
    },
    disable() {
      disableCalls++
    },
    get enableCalls() {
      return enableCalls
    },
    get disableCalls() {
      return disableCalls
    },
  }
}

/** Registry behavior only — never enables a real toggle (that would spawn an OS process). */
describe('system service', () => {
  it('lists registered toggles, keep-awake present and off by default', () => {
    const toggles = createSystemService().listToggles()
    const ka = toggles.find((t) => t.id === 'keep-awake')
    expect(ka).toBeTruthy()
    expect(ka!.enabled).toBe(false)
  })

  it('rejects an unknown toggle id', () => {
    expect(createSystemService().setToggle('nope', true)).rejects.toThrow()
  })

  it('disabling an already-off toggle is a no-op', async () => {
    const s = await createSystemService().setToggle('keep-awake', false)
    expect(s.enabled).toBe(false)
  })

  // ---- mock-def tests (no OS processes spawned) ----------------------------

  it('enable() is called on setToggle(id, true) and state reflects enabled', async () => {
    const def = makeMockDef()
    const svc = createSystemService({ toggles: [def] })
    const state = await svc.setToggle('mock-toggle', true)
    expect(state.enabled).toBe(true)
    expect(def.enableCalls).toBe(1)
    expect(def.disableCalls).toBe(0)
  })

  it('setToggle is idempotent: enabling an already-enabled toggle is a no-op', async () => {
    const def = makeMockDef()
    const svc = createSystemService({ toggles: [def] })
    await svc.setToggle('mock-toggle', true)
    await svc.setToggle('mock-toggle', true) // second call: no-op
    expect(def.enableCalls).toBe(1)
  })

  it('stopAll() calls disable() on every enabled toggle and marks them off', async () => {
    const def = makeMockDef()
    const svc = createSystemService({ toggles: [def] })
    await svc.setToggle('mock-toggle', true)
    expect(svc.listToggles()[0]!.enabled).toBe(true)
    await svc.stopAll()
    expect(def.disableCalls).toBe(1)
    expect(svc.listToggles()[0]!.enabled).toBe(false)
  })

  it('stopAll() skips already-disabled toggles', async () => {
    const def = makeMockDef()
    const svc = createSystemService({ toggles: [def] })
    // Never enabled — stopAll must not call disable().
    await svc.stopAll()
    expect(def.disableCalls).toBe(0)
  })

  it('stopAll() swallows disable() errors (best-effort on shutdown)', async () => {
    const throwing: SystemToggleDef = {
      id: 'bad',
      title: 'Bad toggle',
      isAvailable: () => true,
      enable() {},
      disable() {
        throw new Error('oops')
      },
    }
    const svc = createSystemService({ toggles: [throwing] })
    await svc.setToggle('bad', true)
    // Must not throw even though disable() throws.
    expect(svc.stopAll()).resolves.toBeUndefined()
  })
})
