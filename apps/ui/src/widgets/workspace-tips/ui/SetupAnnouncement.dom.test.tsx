import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

// The real dialog draws the whole carousel; what is under test here is when it opens.
void mock.module('./SetupDialog', () => ({
  default: () => <div role="dialog">Set up Localix</div>,
}))

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  mock.restore()
  await teardown()
})
afterEach(async () => {
  const { act } = await import('react')
  const { closeSetup } = await import('@/shared/lib/setupDialog')
  await act(async () => closeSetup())
  const { resetSetupLaunchForTest } = await import('./SetupAnnouncement')
  resetSetupLaunchForTest()
  localStorage.clear()
})

const dialog = () => document.querySelector('[role="dialog"]')

async function mountAnnouncement() {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SetupAnnouncement } = await import('./SetupAnnouncement')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(SetupAnnouncement)))
  // The dialog is a lazy chunk: let it resolve.
  await act(async () => {
    await import('./SetupDialog')
  })
  return async () => {
    await act(async () => root.unmount())
    host.remove()
  }
}

describe('SetupAnnouncement', () => {
  test('opens on a first run, and closing it is remembered for later launches', async () => {
    const { act } = await import('react')
    const unmount = await mountAnnouncement()
    expect(dialog()?.textContent).toBe('Set up Localix')

    const { closeSetup, SETUP_DONE_KEY } = await import('@/shared/lib/setupDialog')
    await act(async () => closeSetup())
    expect(dialog()).toBeNull()
    expect(localStorage.getItem(SETUP_DONE_KEY)).toBe('1')
    await unmount()

    const { resetSetupLaunchForTest } = await import('./SetupAnnouncement')
    resetSetupLaunchForTest()
    const again = await mountAnnouncement()
    expect(dialog()).toBeNull()
    await again()
  })

  test('opens from the palette after it was closed', async () => {
    localStorage.setItem('localix.setup.done', '1')
    const unmount = await mountAnnouncement()
    expect(dialog()).toBeNull()

    const { act } = await import('react')
    const { openSetup } = await import('@/shared/lib/setupDialog')
    await act(async () => openSetup())
    expect(dialog()?.textContent).toBe('Set up Localix')
    await unmount()
  })
})
