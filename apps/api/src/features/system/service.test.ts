import { describe, expect, test } from 'bun:test'
import { createSystemService } from './service'
import type { SystemToggleDef } from './toggle'

// Stub toggle that records enable/disable calls and lets a test control availability.
function stubToggle(id = 'keep-awake', available = true) {
  const calls = { enable: 0, disable: 0 }
  const def: SystemToggleDef = {
    id,
    title: id,
    description: 'd',
    isAvailable: () => available,
    enable: async () => {
      calls.enable++
    },
    disable: async () => {
      calls.disable++
    },
  } as unknown as SystemToggleDef
  return { def, calls }
}

describe('createSystemService', () => {
  test('lists registered toggles with availability + initial off state', () => {
    const { def } = stubToggle()
    const list = createSystemService({ toggles: [def] }).listToggles()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'keep-awake', available: true, enabled: false })
  })

  test('setToggle on an unknown id is a 404', () => {
    const svc = createSystemService({ toggles: [stubToggle().def] })
    expect(svc.setToggle('nope', true)).rejects.toMatchObject({ status: 404 })
  })

  test('enabling an unavailable toggle is a 409', () => {
    const { def } = stubToggle('x', false)
    const svc = createSystemService({ toggles: [def] })
    expect(svc.setToggle('x', true)).rejects.toMatchObject({ status: 409 })
  })

  test('enable/disable are idempotent — no redundant calls when already in state', async () => {
    const { def, calls } = stubToggle()
    const svc = createSystemService({ toggles: [def] })

    expect((await svc.setToggle('keep-awake', true)).enabled).toBe(true)
    expect(calls.enable).toBe(1)
    await svc.setToggle('keep-awake', true) // already on
    expect(calls.enable).toBe(1) // not called again

    expect((await svc.setToggle('keep-awake', false)).enabled).toBe(false)
    expect(calls.disable).toBe(1)
    await svc.setToggle('keep-awake', false) // already off
    expect(calls.disable).toBe(1)
  })

  test('stopAll disables active toggles and resets their state', async () => {
    const { def, calls } = stubToggle()
    const svc = createSystemService({ toggles: [def] })
    await svc.setToggle('keep-awake', true)
    await svc.stopAll()
    expect(calls.disable).toBe(1)
    expect(svc.listToggles()[0].enabled).toBe(false)
  })
})
