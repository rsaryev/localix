import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

describe('UI target registry', () => {
  test('waits for an async target and scrolls its registered container', async () => {
    const { __resetUiTargets, registerUiTarget, revealUiTarget } =
      await import('./uiTargetRegistry')
    __resetUiTargets()
    const container = document.createElement('div')
    container.dataset.uiScrollContainer = ''
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 })
    // The reveal clamps its target to the space that actually exists, so a container with no
    // scroll height would legitimately resolve every target to 0.
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 })
    container.getBoundingClientRect = () => ({ top: 100, height: 200 }) as DOMRect
    // `scrollTop` is written directly now, not through `scrollTo`: the reveal owns its own
    // animation so a hop and a ten-screen jump are not given the same duration.
    let scrolledTop = -1
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => (scrolledTop === -1 ? 0 : scrolledTop),
      set: (value: number) => {
        scrolledTop = value
      },
    })
    document.body.append(container)

    const uri = 'localix://ui/settings/plugins/plugin-sample-plugin?scope=PRJ-1'
    const revealed = revealUiTarget(uri, { behavior: 'auto', timeoutMs: 500 })
    const target = document.createElement('div')
    target.tabIndex = -1
    target.getBoundingClientRect = () => ({ top: 600, height: 40 }) as DOMRect
    container.append(target)
    const unregister = registerUiTarget(uri, target)

    expect(await revealed).toBe(true)
    expect(scrolledTop).toBe(420)
    expect(document.activeElement).toBe(target)
    expect(target.dataset.uiTarget).toBe(uri)

    unregister()
    container.remove()
    __resetUiTargets()
  })

  test('times out cleanly when no surface registers the URI', async () => {
    const { __resetUiTargets, revealUiTarget } = await import('./uiTargetRegistry')
    __resetUiTargets()
    expect(
      await revealUiTarget('missing://target', {
        timeoutMs: 10,
      }),
    ).toBe(false)
  })

  test('materializes a virtual target before revealing it', async () => {
    const { __resetUiTargets, registerUiTarget, registerUiTargetMaterializer, revealUiTarget } =
      await import('./uiTargetRegistry')
    __resetUiTargets()
    const uri = 'localix://resource/chat/message/session-a/message-42'
    const target = document.createElement('article')
    target.tabIndex = -1
    document.body.append(target)
    let calls = 0

    registerUiTargetMaterializer({
      id: 'chat-session-a',
      supports: (candidate) => candidate.startsWith('localix://resource/chat/message/session-a/'),
      materialize: (candidate) => {
        calls += 1
        registerUiTarget(candidate, target)
      },
    })

    expect(await revealUiTarget(uri, { behavior: 'auto' })).toBe(true)
    expect(calls).toBe(1)
    expect(document.activeElement).toBe(target)
    target.remove()
    __resetUiTargets()
  })

  test('starts a materializer registered after navigation was requested', async () => {
    const { __resetUiTargets, registerUiTarget, registerUiTargetMaterializer, revealUiTarget } =
      await import('./uiTargetRegistry')
    __resetUiTargets()
    const uri = 'localix://resource/tree/node/lazy'
    const reveal = revealUiTarget(uri, { timeoutMs: 100 })
    const target = document.createElement('button')
    document.body.append(target)

    registerUiTargetMaterializer({
      id: 'lazy-tree',
      supports: (candidate) => candidate === uri,
      materialize: () => {
        registerUiTarget(uri, target)
      },
    })

    expect(await reveal).toBe(true)
    target.remove()
    __resetUiTargets()
  })
})

describe('UI target registry — bounded waiting', () => {
  test('gives up at the deadline when a registered target can never become visible', async () => {
    const { __resetUiTargets, registerUiTarget, revealUiTarget } =
      await import('./uiTargetRegistry')
    __resetUiTargets()

    // Registered and connected, but inside a display:none ancestor — the shape of a work
    // item in an inactive tab or a collapsed panel. `targetFor` filters by visibility, so
    // this lands on the waiting path and must be released by the deadline rather than
    // waiting on a target that can never appear.
    const hidden = document.createElement('div')
    hidden.style.display = 'none'
    const element = document.createElement('div')
    hidden.append(element)
    document.body.append(hidden)
    registerUiTarget('localix://ui/work-item/hidden/open', element)

    const startedAt = Date.now()
    const revealed = await revealUiTarget('localix://ui/work-item/hidden/open', {
      timeoutMs: 60,
    })

    expect(revealed).toBe(false)
    // The assertion that matters is that it settles at all, and near its own timeout
    // rather than the 5s default.
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    hidden.remove()
  })

  test('still reveals a target that becomes visible before the deadline', async () => {
    const { __resetUiTargets, registerUiTarget, revealUiTarget } =
      await import('./uiTargetRegistry')
    __resetUiTargets()

    const wrapper = document.createElement('div')
    wrapper.style.display = 'none'
    const element = document.createElement('div')
    element.scrollIntoView = () => {}
    wrapper.append(element)
    document.body.append(wrapper)
    registerUiTarget('localix://ui/work-item/late/open', element)

    // The panel opens shortly after the click — the retry loop is what makes this work.
    setTimeout(() => {
      wrapper.style.display = 'block'
    }, 20)

    expect(await revealUiTarget('localix://ui/work-item/late/open', { timeoutMs: 1_000 })).toBe(
      true,
    )
    wrapper.remove()
  })
})
