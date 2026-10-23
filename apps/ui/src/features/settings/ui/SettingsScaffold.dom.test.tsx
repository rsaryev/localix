import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('native settings rows', () => {
  test('a section is labelled by its heading', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { SettingsSection, SettingsRows, SettingsRow, SettingsSurface } =
      await import('./SettingsScaffold')
    const html = renderToStaticMarkup(
      <SettingsSection title="Typography">
        <SettingsRows>
          <SettingsRow>Interface font</SettingsRow>
        </SettingsRows>
        <SettingsSurface>Preview</SettingsSurface>
      </SettingsSection>,
    )
    const host = document.createElement('div')
    host.innerHTML = html
    const section = host.querySelector('section')!
    expect(section.getAttribute('aria-labelledby')).toBe(host.querySelector('h3')?.id ?? null)
  })

  test('shortcut search and an icon-only, named reset control are both present', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { KeyboardShortcutsSettings } = await import('./KeyboardShortcutsSettings')
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<KeyboardShortcutsSettings />)
    const search = host.querySelector('input[aria-label="Search shortcuts…"]')!
    const reset = host.querySelector('button[aria-label="Reset all shortcuts"]')!
    expect(search).not.toBeNull()
    expect(reset).not.toBeNull()
    expect(reset.querySelector('svg')).not.toBeNull()
    expect(reset.textContent).toBe('')
  })

  test('one keymap control uses a compact row without a duplicate group heading', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { KeyboardShortcutsSettings } = await import('./KeyboardShortcutsSettings')
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<KeyboardShortcutsSettings />)
    const keymap = host.querySelector('[aria-label="Base keymap"]')!
    const section = keymap.closest('section')!
    expect(section.querySelectorAll('h3')).toHaveLength(1)
    expect(section.querySelector('h3')?.textContent).toBe('Base keymap')
    expect(section.children).toHaveLength(1)
  })

  test('shows shell-command installation with the shared in-row activity signal', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { shellCommandApi } = await import('@/shared/api/shell-command-client')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { SystemSettings } = await import('./SystemSettings')
    const { MemoryRouter } = await import('react-router')
    const installedStatus = {
      state: 'installed' as const,
      targetPath: '/workspace/bin/localix',
      binDir: '/workspace/bin',
      onPath: true,
      available: true,
    }
    const status = spyOn(shellCommandApi, 'status').mockResolvedValue(installedStatus)
    let finishInstall: (() => void) | undefined
    const install = spyOn(shellCommandApi, 'install').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInstall = () => resolve(installedStatus)
        }),
    )

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <WorkItemVisibilityProvider visible>
          <MemoryRouter>
            <SystemSettings />
          </MemoryRouter>
        </WorkItemVisibilityProvider>,
      )
      await settle()
    })

    const reinstall = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reinstall',
    )
    expect(reinstall).toBeDefined()

    await act(async () => {
      reinstall?.click()
      await Promise.resolve()
    })

    expect(install).toHaveBeenCalledTimes(1)
    expect(reinstall?.getAttribute('aria-busy')).toBe('true')
    expect(reinstall?.textContent).toContain('Installing')
    expect(container.textContent).not.toContain('Working…')

    await act(async () => {
      finishInstall?.()
      await Promise.resolve()
    })
    expect(reinstall?.hasAttribute('aria-busy')).toBe(false)

    await act(async () => root.unmount())
    status.mockRestore()
    install.mockRestore()
  })
})
