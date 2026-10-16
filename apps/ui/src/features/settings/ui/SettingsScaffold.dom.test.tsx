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
  test('a section owns one surface even when rows and forms are nested inside it', async () => {
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
    expect(host.querySelector('h3')?.className).toContain('text-base')
    expect(html.match(/rounded-md/g)).toHaveLength(1)
    expect(html.match(/bg-foreground/g)).toHaveLength(1)
    expect(html).not.toContain('border-y')
  })

  test('shortcut search and reset use equal primary control heights', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { KeyboardShortcutsSettings } = await import('./KeyboardShortcutsSettings')
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<KeyboardShortcutsSettings />)
    const search = host.querySelector('input[aria-label="Search shortcuts…"]')!
    const reset = host.querySelector('button[aria-label="Reset all shortcuts"]')!
    expect(search).not.toBeNull()
    expect(reset).not.toBeNull()
    expect(search.parentElement?.className).toContain('h-[var(--chrome-control-xl)]')
    expect(reset.className).toContain('size-[var(--chrome-control-xl)]')
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
    expect(section.querySelector('h3')?.className).toContain('text-sm font-medium')
    expect(section.className).toContain('p-3')
    expect(section.className).not.toContain('space-y-4')
    expect(section.children).toHaveLength(1)
    expect(section.firstElementChild?.className).toContain('@xl:items-center')
    expect(keymap.className).toContain('h-[var(--chrome-control-xl)]')
  })

  test('uses a compact IDE page hierarchy instead of landing-page scale', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { SettingsPage } = await import('./SettingsScaffold')

    const html = renderToStaticMarkup(
      <SettingsPage title="Preferences" description="Configure the workspace">
        Settings
      </SettingsPage>,
    )

    expect(html).toContain('space-y-8')
    expect(html).toContain('text-xl')
    expect(html).not.toContain('text-2xl')
    expect(html).toContain('text-balance')
  })

  test('forms use bounded surfaces while setting rows stay flat', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { SettingsRow, SettingsRows, SettingsSurface } = await import('./SettingsScaffold')

    const html = renderToStaticMarkup(
      <>
        <SettingsSurface>Configuration form</SettingsSurface>
        <SettingsRows>
          <SettingsRow>First setting</SettingsRow>
          <SettingsRow>Second setting</SettingsRow>
        </SettingsRows>
      </>,
    )

    // One outline and rounded corners per group; rows are divided inside it.
    expect(html).toContain('rounded-md')
    expect(html).toContain('border-border-faint')
    expect(html).toContain('divide-y')
    expect(html).toContain('border-y')
    // No permanent card fill: it would compound under the glass theme.
    expect(html).not.toContain('rounded-xl')
    expect(html).not.toContain('bg-muted/10')
    expect(html).not.toContain('bg-card')
  })

  test('shows shell-command installation with the shared in-row activity signal', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { shellCommandApi } = await import('@/shared/api/shell-command-client')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
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
    expect(reinstall?.innerHTML).toContain('lx-activity-orb')
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
